import OpenAI from "openai";
import { z } from "zod";
import { McpService } from "./McpService.js";
import { LlmService } from "./LlmService.js";
import fs from "fs";
import path from "path";
import { config } from "../config/env.js";

export class AgentService {
    private tokenStats = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
    };

    constructor(private mcp: McpService, private llm: LlmService) { }

    getTokenStats() {
        return this.tokenStats;
    }

    async runTask(
        task: string,
        systemMessage: string = "You are a helpful assistant that can control a web browser using Microsoft Playwright MCP vision tools.",
        maxTurns: number = 50
    ): Promise<string> {
        console.log(`\n--- Starting Task: ${task} ---\n`);
        let turns = 0;

        const visionInstructions = `
- **STRICTLY** stick to the domain provided in the task: ${config.TARGET_HOST}. 
You have access to the following coordinate-based vision tools:
- **browser_mouse_click_xy**: Click left mouse button at a given position.
- Parameters: element (description), x, y.
- **browser_mouse_drag_xy**: Drag left mouse button to a given position.
- Parameters: element (description), startX, startY, endX, endY.
- **browser_mouse_move_xy**: Move mouse to a given position.
- Parameters: element (description), x, y.
- **CAPTCHA/Bot Detection**: You must NEVER skip or ignore CAPTCHA or bot detection screens. If you encounter anything similar to a CAPTCHA test, you MUST first use \`browser_snapshot\` to get a clear view of the challenge before attempting to solve it using available tools (like \`browser_mouse_click_xy\` for visual elements).
`;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            {
                role: "system",
                content: systemMessage + visionInstructions,
            },
            {
                role: "user",
                content: task,
            },
        ];

        const tools = await this.mcp.getTools();
        const openAiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map(
            (tool) => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema as any,
                },
            })
        );

        while (true) {
            turns++;
            if (turns > maxTurns) {
                throw new Error(`Max turns (${maxTurns}) reached for this task. Terminating to prevent infinite loop.`);
            }
            try {
                // Fetch open tabs to provide context
                let tabContext = "";
                try {
                    const tabsResult = await this.mcp.callTool("browser_tabs", { action: "list" });
                    // @ts-ignore
                    const tabsText = tabsResult.content.map(c => c.text).join("\n");
                    tabContext = `\n\n[Current Browser Tabs]\n${tabsText}`;
                } catch (e) {
                    console.error("Failed to fetch tabs:", e);
                }

                // Inject tab context into the conversation for this turn
                // We append it as a system message at the end so it's fresh in context
                const messagesWithContext = [
                    ...messages,
                    { role: "system", content: `Current Context:${tabContext}` } as OpenAI.Chat.Completions.ChatCompletionMessageParam
                ];

                const response = await this.llm.chat(messagesWithContext, openAiTools);

                // Track token usage
                if (response.usage) {
                    const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
                    this.tokenStats.prompt_tokens += prompt_tokens || 0;
                    this.tokenStats.completion_tokens += completion_tokens || 0;
                    this.tokenStats.total_tokens += total_tokens || 0;

                    console.log(`[Token Usage] Step: ${total_tokens} (Prompt: ${prompt_tokens}, Completion: ${completion_tokens})`);
                }

                const message = response.choices[0].message;
                if (message.content) {
                    console.log(`\n[Agent Thought]: ${message.content}\n`);
                }
                messages.push(message);

                if (message.tool_calls && message.tool_calls.length > 0) {
                    console.log(
                        "Model requested tools:",
                        message.tool_calls.map((tc) => tc.function.name)
                    );

                    for (const toolCall of message.tool_calls) {
                        const toolName = toolCall.function.name;
                        let toolArgs = {};
                        if (toolCall.function.arguments) {
                            try {
                                toolArgs = JSON.parse(toolCall.function.arguments);
                            } catch (e) {
                                console.error(
                                    `Failed to parse arguments for ${toolName}.Raw arguments: `,
                                    toolCall.function.arguments
                                );
                                messages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: `Error: Invalid JSON arguments provided.`,
                                });
                                continue;
                            }
                        }

                        console.log(`Executing ${toolName} with args: `, toolArgs);

                        // Intercept browser_take_screenshot to enforce filename structure
                        if (toolName === "browser_take_screenshot") {
                            const ts = Date.now();
                            const newFilename = `screenshot_${ts}.png`;
                            // @ts-ignore
                            toolArgs.filename = newFilename;
                            console.log(`[AgentService] 📸 Enforcing screenshot filename: ${newFilename}`);
                        }

                        try {
                            const result = await this.mcp.callTool(toolName, toolArgs);

                            // Format result for OpenAI
                            // OpenAI Tool outputs MUST be strings. We cannot send images directly in tool_outputs.
                            // Strategy: If a tool returns an image, we send a placeholder in the tool output,
                            // and then immediately append a NEW User message containing the image.

                            let imageContent: { type: "image_url", image_url: { url: string } } | null = null;

                            // @ts-ignore
                            const content = (result as any).content
                                .map((c: any) => {
                                    if (c.type === "text") return c.text;
                                    if (c.type === "image") {
                                        // Save image to output directory
                                        try {
                                            const outputDir = path.resolve(process.cwd(), "output");
                                            if (!fs.existsSync(outputDir)) {
                                                fs.mkdirSync(outputDir, { recursive: true });
                                            }
                                            const timestamp = Date.now();
                                            const ext = c.mimeType.split("/")[1] || "png";
                                            const filename = `snapshot_${timestamp}.${ext}`;
                                            const filepath = path.join(outputDir, filename);
                                            fs.writeFileSync(filepath, Buffer.from(c.data, "base64"));
                                            console.log(`[AgentService] 📸 Saved snapshot to ${filepath}`);
                                        } catch (e) {
                                            console.error("[AgentService] Failed to save snapshot:", e);
                                        }

                                        imageContent = {
                                            type: "image_url",
                                            image_url: {
                                                url: `data:${c.mimeType};base64,${c.data}`,
                                            },
                                        };
                                        return `[Image captured: ${c.mimeType}]`;
                                    }
                                    return JSON.stringify(c);
                                })
                                .join("\n");

                            messages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: content,
                            });

                            if (imageContent) {
                                console.log("Injecting captured image into conversation...");
                                messages.push({
                                    role: "user",
                                    content: [
                                        { type: "text", text: "Here is the image captured by the tool:" },
                                        imageContent
                                    ],
                                });
                            }

                            console.log(
                                `Tool ${toolName} output: `,
                                content.substring(0, 100) + "..."
                            );
                        } catch (error: any) {
                            console.error(`Error executing ${toolName}: `, error);
                            messages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: `Error: ${error.message} `,
                            });
                        }
                    }
                } else {
                    console.log("Task Completed.");
                    return message.content || "";
                }
            } catch (error: any) {
                console.error("Error calling LLM:", error);
                throw error;
            }
        }
    }

    async checkIfComplete(): Promise<boolean> {
        console.log("Checking if survey is complete...");

        let snapshot = "";
        try {
            const result = await this.mcp.callTool("browser_snapshot", {});
            // @ts-ignore
            snapshot = (result as any).content.map((c) => c.text).join("\n");
        } catch (e) {
            console.error("Failed to get snapshot for completion check:", e);
            return false;
        }

        const completionPrompt = `
    Look at the current page snapshot and determine if the survey is complete.
    
    Check for:
            - "Thank you" messages
                - "Survey complete" text
                    - "Completion" indicators
                        - Being redirected back to the dashboard
    
    Page Snapshot:
    ${snapshot.substring(0, 10000)} // Truncate to avoid token limits if necessary
        `;

        try {
            const response = await this.llm.chat(
                [{ role: "user", content: completionPrompt }],
                [
                    {
                        type: "function",
                        function: {
                            name: "report_status",
                            description: "Report the completion status of the survey",
                            parameters: {
                                type: "object",
                                properties: {
                                    is_complete: {
                                        type: "boolean",
                                        description: "Whether the survey is fully completed",
                                    },
                                    summary: {
                                        type: "string",
                                        description: "Brief summary of the page state",
                                    },
                                },
                                required: ["is_complete", "summary"],
                            },
                        },
                    },
                ],
                { type: "function", function: { name: "report_status" } }
            );

            const toolCall = response.choices[0].message.tool_calls?.[0];
            if (toolCall && toolCall.function.name === "report_status") {
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`Completion Check: ${args.is_complete} - ${args.summary} `);
                return args.is_complete;
            }
        } catch (e) {
            console.error("Error checking completion:", e);
        }

        return false;
    }


}
