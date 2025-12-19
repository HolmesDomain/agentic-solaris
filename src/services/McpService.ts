/**
 * McpService - Wrapper around PuppeteerService
 * 
 * Provides the same interface expected by AgentService but routes to PuppeteerService.
 * Maps browser_* tool names to puppeteer_* equivalents.
 */

import { PuppeteerService, PUPPETEER_TOOLS, ToolResult } from "./PuppeteerService.js";

// Tool name mapping from what LLM might call to what Puppeteer uses
const TOOL_NAME_MAP: Record<string, string> = {
    // Browser tools -> Puppeteer equivalents
    "browser_navigate": "puppeteer_navigate",
    "browser_screenshot": "puppeteer_screenshot",
    "browser_click": "puppeteer_click",
    "browser_fill": "puppeteer_fill",
    "browser_type": "puppeteer_fill", // alias
    "browser_select": "puppeteer_select",
    "browser_hover": "puppeteer_hover",
    "browser_evaluate": "puppeteer_evaluate",
    "browser_snapshot": "puppeteer_get_content", // map snapshot to get_content
    "browser_take_screenshot": "puppeteer_screenshot",
    // Also accept puppeteer_* names directly
    ...Object.fromEntries(PUPPETEER_TOOLS.map(t => [t.name, t.name])),
};

export class McpService {
    private puppeteer: PuppeteerService;
    private isConnected = false;

    constructor() {
        this.puppeteer = new PuppeteerService();
    }

    async connect() {
        if (this.isConnected) return;
        await this.puppeteer.connect();
        this.isConnected = true;
    }

    async getTools() {
        if (!this.isConnected) await this.connect();

        // Return tools with both puppeteer_* and browser_* names for compatibility
        const tools = await this.puppeteer.getTools();

        // Add browser_* aliases
        const browserAliases = [
            {
                name: "browser_navigate",
                description: "Navigate to a URL",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: { type: "string", description: "URL to navigate to" },
                    },
                    required: ["url"],
                },
            },
            // TEMPORARILY DISABLED - vision not supported by current LLM
            // {
            //     name: "browser_screenshot",
            //     description: "Take a screenshot of the current page",
            //     inputSchema: {
            //         type: "object",
            //         properties: {
            //             name: { type: "string", description: "Name for the screenshot" },
            //         },
            //         required: ["name"],
            //     },
            // },
            {
                name: "browser_click",
                description: "Click an element by CSS selector",
                inputSchema: {
                    type: "object",
                    properties: {
                        selector: { type: "string", description: "CSS selector for element to click" },
                    },
                    required: ["selector"],
                },
            },
            {
                name: "browser_fill",
                description: "Fill an input field",
                inputSchema: {
                    type: "object",
                    properties: {
                        selector: { type: "string", description: "CSS selector for input" },
                        value: { type: "string", description: "Value to type" },
                    },
                    required: ["selector", "value"],
                },
            },
            {
                name: "browser_snapshot",
                description: "Get the HTML content of the page for analysis",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
        ];

        return [...tools, ...browserAliases];
    }

    async callTool(name: string, args: any): Promise<ToolResult> {
        if (!this.isConnected) await this.connect();

        // Map tool name
        const mappedName = TOOL_NAME_MAP[name] || name;

        // Handle browser_tabs - not supported in Puppeteer, return stub
        if (name === "browser_tabs") {
            return {
                content: [{ type: "text", text: "Tabs: 1 tab open (current page)" }],
                isError: false,
            };
        }

        // Handle browser_snapshot specially - return page content + interactive elements
        if (name === "browser_snapshot" || mappedName === "puppeteer_get_content") {
            const result = await this.puppeteer.callTool("puppeteer_get_content", { selector: "body" });
            if (!result.isError && result.content[0]?.text) {
                const html = result.content[0].text;

                // Extract text content (stripped of tags)
                const textContent = html
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                    .replace(/<[^>]+>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 8000);

                // Extract interactive elements (links, buttons, inputs, forms)
                const elements: string[] = [];

                // Links with text
                const linkMatches = html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]+)</gi);
                for (const m of linkMatches) {
                    const text = m[2].trim();
                    if (text && text.length > 1 && text.length < 50) {
                        elements.push(`Link: "${text}" -> selector: text=${text}`);
                    }
                }

                // Buttons
                const buttonMatches = html.matchAll(/<button[^>]*>([^<]+)</gi);
                for (const m of buttonMatches) {
                    const text = m[1].trim();
                    if (text && text.length > 1) {
                        elements.push(`Button: "${text}" -> selector: text=${text}`);
                    }
                }

                // Input fields with name attribute
                const inputMatches = html.matchAll(/<input\s+[^>]*name=["']([^"']+)["'][^>]*/gi);
                for (const m of inputMatches) {
                    elements.push(`Input: name="${m[1]}" -> selector: input[name='${m[1]}']`);
                }

                // Forms with submit buttons
                const submitMatches = html.matchAll(/<(input|button)[^>]*type=["']submit["'][^>]*/gi);
                for (const m of submitMatches) {
                    elements.push(`Submit button -> selector: ${m[1]}[type='submit']`);
                }

                const elementList = elements.length > 0
                    ? "\n\nINTERACTIVE ELEMENTS:\n" + elements.slice(0, 30).join("\n")
                    : "";

                return {
                    content: [{ type: "text", text: `Page content:\n${textContent}${elementList}` }],
                    isError: false,
                };
            }
            return result;
        }

        return await this.puppeteer.callTool(mappedName, args);
    }

    async close() {
        await this.puppeteer.close();
        this.isConnected = false;
    }

    async restart() {
        await this.puppeteer.restart();
    }
}
