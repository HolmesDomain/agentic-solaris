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

    // Number of recent turns to keep full tool results for
    private static readonly KEEP_RECENT_TURNS = 8;
    // Max characters to keep for truncated tool results
    private static readonly TRUNCATED_LENGTH = 150;

    constructor(private mcp: McpService, private llm: LlmService) { }

    getTokenStats() {
        return this.tokenStats;
    }

    /**
     * Aggressively prunes old messages to keep context window small.
     * Keeps: system message (0), initial task (1), and last N turns.
     * REMOVES everything in between to prevent token bloat.
     */
    private truncateOldToolResults(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): void {
        // Count assistant messages (each represents a turn)
        let turnCount = 0;
        for (const msg of messages) {
            if (msg.role === "assistant") turnCount++;
        }

        // If we have more turns than threshold, REMOVE old messages (not just truncate)
        if (turnCount > AgentService.KEEP_RECENT_TURNS) {
            // Find index where we should start keeping messages
            // We want to keep: [0] system, [1] task, then last KEEP_RECENT_TURNS*3 messages (assistant + tool responses + possible user)
            const keepFromEnd = AgentService.KEEP_RECENT_TURNS * 3; // ~3 messages per turn
            const removeCount = messages.length - 2 - keepFromEnd; // Keep first 2, remove middle, keep last N
            
            if (removeCount > 0) {
                // Splice out the middle messages, keep system (0), task (1), and recent turns
                messages.splice(2, removeCount, {
                    role: "system",
                    content: `[Context pruned: ${removeCount} older messages removed to manage tokens]`
                } as any);
                
                console.log(`[Context Management] Pruned ${removeCount} old messages. Now: ${messages.length} messages.`);
            }
        }
    }

    async runTask(
        task: string,
        systemMessage: string = `You are an efficient web automation agent. Your goal is to complete tasks quickly and accurately.

CORE PRINCIPLES:
1. **Be Direct**: Take the most direct path to complete the task. Don't explore unnecessarily.
2. **One Action at a Time**: Execute one action, observe the result, then decide the next action.
3. **Verify Before Acting**: Always check the current page state before clicking or typing.
4. **Handle Errors Gracefully**: If something fails, try an alternative approach before giving up.
5. **Stay Focused**: Only interact with elements relevant to the current task.

WHEN YOU'RE DONE:
- If the task is complete, stop calling tools and provide a brief summary.
- Don't perform extra actions "just to be sure."`,
        maxTurns: number = 50
    ): Promise<string> {
        console.log(`\n--- Starting Task: ${task} ---\n`);
        let turns = 0;

        const visionInstructions = `
DOMAIN RESTRICTION: You must STRICTLY stay on ${config.TARGET_HOST}. If redirected elsewhere unexpectedly, navigate back immediately.

VISION TOOLS (coordinate-based):
- browser_mouse_click_xy: Click at (x, y) coordinates
- browser_mouse_drag_xy: Drag from (startX, startY) to (endX, endY)  
- browser_mouse_move_xy: Move mouse to (x, y)

IMPORTANT: Do NOT use page.dragAndDrop or locator.dragAndDrop inside browser_run_code - they are unreliable. ALWAYS use browser_mouse_drag_xy for dragging.

TAB MANAGEMENT:
- You have access to the list of open tabs in the context.
- If a new tab opens (e.g., after clicking a survey link), check the "Open Tabs" list.
- Use browser_tabs tool with action: "select" and the index to switch to the correct tab.
- ALWAYS verify you are on the correct tab before performing actions.

FORM INTERACTION:
- When filling dropdowns, if browser_fill_form fails with "Element is not a <select> element", it means the dropdown is a custom UI component (div/ul).
- In that case, DO NOT use browser_fill_form. Instead:
  1. Click the dropdown trigger element.
  2. Click the desired option element.

SURVEY BEHAVIOR:
- **NEVER SKIP QUESTIONS**: Always select an answer that aligns with the persona. If optional, answer anyway.
- **Complete Question BEFORE clicking Next**: Fully answer the current question before navigating.
- **Sequential Actions**: Do NOT combine "answering" and "clicking Next" in the same turn if there's risk of the page changing. Select answer, wait for UI update if needed, THEN click Next.

CAPTCHA/BOT DETECTION:
- NEVER skip or ignore CAPTCHA or bot detection screens.
- For TEXT CAPTCHAs (distorted text images like "Enter the text you see"):
  1. Use browser_take_screenshot to capture the page visually
  2. LOOK at the image carefully - read the distorted letters/numbers
  3. Type EXACTLY what you see in the image (case-sensitive)
  4. Common confusions: I vs l vs 1, O vs 0, S vs 5, Z vs 2
- For CLICK CAPTCHAs (select images, puzzles):
  1. Use browser_take_screenshot to see the visual challenge
  2. Use browser_mouse_click_xy with coordinates to click the correct areas
- For DRAG CAPTCHAs (sliders, drag-and-drop):
  1. Use browser_take_screenshot to see the puzzle
  2. Use browser_mouse_drag_xy to perform the drag action
- ALWAYS verify your CAPTCHA solution before submitting.

THINKING OUT LOUD:
- Before calling any tool, output a brief "thought" explaining your reasoning and what you plan to do next.

ERROR HANDLING:
- "Ref not found": Your snapshot is stale. IMMEDIATELY call browser_snapshot to get fresh state. Do not retry without a new snapshot.
- "Execution context was destroyed": The page navigated. Call browser_snapshot to see the new page.
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

                    // Truncate old tool results to reduce context size
                    this.truncateOldToolResults(messages);
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

        const completionPrompt = `Analyze this page snapshot and determine if the survey is complete.

COMPLETION INDICATORS (any of these = complete):
- "Thank you" or "Thanks for completing" messages
- "Survey complete" or "You're done" text
- Reward/points credited confirmation
- Redirected back to survey dashboard/wall
- "Return to surveys" or similar buttons

NOT COMPLETE indicators:
- Still on a survey question page
- "Next" or "Continue" buttons visible
- Progress bar not at 100%
- Error messages about survey

Page Snapshot:
${snapshot.substring(0, 8000)}`;

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
