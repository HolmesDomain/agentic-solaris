/**
 * PuppeteerService - Direct in-process Puppeteer browser automation
 * 
 * Extracted from the archived Puppeteer MCP server.
 * Provides tools for navigation, screenshots, clicking, filling forms, etc.
 */

import puppeteer, { Browser, Page } from "puppeteer";

// Tool definitions for LLM
export const PUPPETEER_TOOLS = [
    {
        name: "puppeteer_navigate",
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
    //     name: "puppeteer_screenshot",
    //     description: "Take a screenshot of the current page or a specific element",
    //     inputSchema: {
    //         type: "object",
    //         properties: {
    //             name: { type: "string", description: "Name for the screenshot" },
    //             selector: { type: "string", description: "CSS selector for element to screenshot" },
    //             width: { type: "number", description: "Width in pixels (default: 1280)" },
    //             height: { type: "number", description: "Height in pixels (default: 720)" },
    //         },
    //         required: ["name"],
    //     },
    // },
    {
        name: "puppeteer_click",
        description: "Click an element on the page",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for element to click" },
            },
            required: ["selector"],
        },
    },
    {
        name: "puppeteer_fill",
        description: "Fill out an input field",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for input field" },
                value: { type: "string", description: "Value to fill" },
            },
            required: ["selector", "value"],
        },
    },
    {
        name: "puppeteer_select",
        description: "Select an option in a dropdown",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for select element" },
                value: { type: "string", description: "Value to select" },
            },
            required: ["selector", "value"],
        },
    },
    {
        name: "puppeteer_hover",
        description: "Hover over an element on the page",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for element to hover" },
            },
            required: ["selector"],
        },
    },
    // TEMPORARILY DISABLED - LLMs generate invalid JavaScript
    // {
    //     name: "puppeteer_evaluate",
    //     description: "Execute JavaScript in the browser console",
    //     inputSchema: {
    //         type: "object",
    //         properties: {
    //             script: { type: "string", description: "JavaScript code to execute" },
    //         },
    //         required: ["script"],
    //     },
    // },
    {
        name: "puppeteer_get_content",
        description: "Get the HTML content of the current page or an element",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for element (optional, defaults to body)" },
            },
        },
    },
];

export interface ToolResult {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError: boolean;
}

export class PuppeteerService {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private consoleLogs: string[] = [];
    private isConnected = false;

    async connect() {
        if (this.isConnected) return;

        console.log("Starting Puppeteer browser...");

        this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: { width: 1280, height: 720 },
            args: [
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--disable-default-apps",
                "--disable-sync",
            ],
        });

        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();

        // Capture console logs
        this.page.on("console", (msg) => {
            this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
        });

        this.isConnected = true;
        console.log(`Puppeteer browser launched. ${PUPPETEER_TOOLS.length} tools available.`);
    }

    async getTools() {
        if (!this.isConnected) await this.connect();
        return PUPPETEER_TOOLS;
    }

    async callTool(name: string, args: any): Promise<ToolResult> {
        if (!this.isConnected) await this.connect();
        const page = this.page!;

        try {
            switch (name) {
                case "puppeteer_navigate":
                    await page.goto(args.url, { waitUntil: "networkidle2", timeout: 30000 });
                    // Extra wait for dynamic content
                    await new Promise(r => setTimeout(r, 1000));
                    return {
                        content: [{ type: "text", text: `Navigated to ${args.url}` }],
                        isError: false,
                    };

                case "puppeteer_screenshot": {
                    const width = args.width ?? 1280;
                    const height = args.height ?? 720;
                    await page.setViewport({ width, height });

                    let screenshot: string | undefined;
                    if (args.selector) {
                        const element = await page.$(args.selector);
                        if (element) {
                            screenshot = await element.screenshot({ encoding: "base64" }) as string;
                        }
                    } else {
                        screenshot = await page.screenshot({ encoding: "base64", fullPage: false }) as string;
                    }

                    if (!screenshot) {
                        return {
                            content: [{ type: "text", text: args.selector ? `Element not found: ${args.selector}` : "Screenshot failed" }],
                            isError: true,
                        };
                    }

                    return {
                        content: [
                            { type: "text", text: `Screenshot '${args.name}' taken at ${width}x${height}` },
                            { type: "image", data: screenshot, mimeType: "image/png" },
                        ],
                        isError: false,
                    };
                }

                case "puppeteer_click":
                    await page.waitForSelector(args.selector, { timeout: 5000 });
                    await page.click(args.selector);
                    // Wait for potential navigation or dynamic content
                    await new Promise(r => setTimeout(r, 1000));
                    return {
                        content: [{ type: "text", text: `Clicked: ${args.selector}` }],
                        isError: false,
                    };

                case "puppeteer_fill":
                    await page.waitForSelector(args.selector, { timeout: 5000 });
                    await page.click(args.selector, { clickCount: 3 }); // Select all
                    await page.type(args.selector, args.value);
                    return {
                        content: [{ type: "text", text: `Filled ${args.selector} with: ${args.value}` }],
                        isError: false,
                    };

                case "puppeteer_select":
                    await page.waitForSelector(args.selector, { timeout: 5000 });
                    await page.select(args.selector, args.value);
                    return {
                        content: [{ type: "text", text: `Selected ${args.value} in ${args.selector}` }],
                        isError: false,
                    };

                case "puppeteer_hover":
                    await page.waitForSelector(args.selector, { timeout: 5000 });
                    await page.hover(args.selector);
                    return {
                        content: [{ type: "text", text: `Hovered: ${args.selector}` }],
                        isError: false,
                    };

                case "puppeteer_evaluate": {
                    // If script looks like a function definition, wrap it in IIFE
                    let script = args.script;
                    if (script.trim().startsWith('(') && script.includes('=>')) {
                        script = `(${script})()`;
                    } else if (script.trim().startsWith('function')) {
                        script = `(${script})()`;
                    }
                    const result = await page.evaluate(script);
                    return {
                        content: [{ type: "text", text: `Result: ${JSON.stringify(result, null, 2)}` }],
                        isError: false,
                    };
                }

                case "puppeteer_get_content": {
                    const selector = args.selector || "body";
                    const content = await page.$eval(selector, (el) => el.innerHTML);
                    return {
                        content: [{ type: "text", text: content.slice(0, 50000) }], // Limit size
                        isError: false,
                    };
                }

                default:
                    return {
                        content: [{ type: "text", text: `Unknown tool: ${name}` }],
                        isError: true,
                    };
            }
        } catch (error) {
            return {
                content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
                isError: true,
            };
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isConnected = false;
            console.log("Puppeteer browser closed.");
        }
    }

    async restart() {
        console.log("Restarting Puppeteer browser...");
        await this.close();
        await this.connect();
        console.log("✅ Puppeteer browser restarted.");
    }

    getConsoleLogs() {
        return this.consoleLogs;
    }
}
