import OpenAI from "openai";
import { z } from "zod";
import { McpService } from "./McpService.js";
import { LlmService } from "./LlmService.js";

export class AgentService {
    constructor(private mcp: McpService, private llm: LlmService) { }

    async runTask(
        task: string,
        systemMessage: string = "You are a helpful assistant that can control a web browser using Playwright tools."
    ): Promise<string> {
        console.log(`\n--- Starting Task: ${task} ---\n`);

        const visionInstructions = `
You have access to the following coordinate-based vision tools (opt-in via --caps=vision):

- **browser_mouse_click_xy**: Click left mouse button at a given position.
  - Parameters: element (description), x, y.
- **browser_mouse_drag_xy**: Drag left mouse button to a given position.
  - Parameters: element (description), startX, startY, endX, endY.
- **browser_mouse_move_xy**: Move mouse to a given position.
  - Parameters: element (description), x, y.

If you need to perform a drag-and-drop operation or interact with elements that are better identified by their visual position, PLEASE USE THESE TOOLS. You can use vision capabilities to determine the coordinates.

**Tab Management:**
- You have access to the list of open tabs.
- If a new tab opens (e.g., after clicking a survey link), check the "Open Tabs" list.
- Use the \`browser_tabs\` tool with \`action: "select"\` and the \`index\` or \`tabId\` to switch to the correct tab.
- ALWAYS verify you are on the correct tab before performing actions.

**Form Interaction:**
- When filling dropdowns, if \`browser_fill_form\` fails with "Element is not a <select> element", it means the dropdown is a custom UI component (div/ul).
- In that case, DO NOT use \`browser_fill_form\`. Instead:
  1. Click the dropdown trigger element.
  2. Click the desired option element.

**Survey Behavior:**
- **Survey Preferences**: Avoid surveys from provider: "Prime Surveys". 
- **NEVER SKIP QUESTIONS**: You must NEVER skip a survey question. Always select an answer that aligns with the defined persona. If a question is optional, answer it anyway.
- **CAPTCHA/Bot Detection**: You must NEVER skip or ignore CAPTCHA or bot detection screens. If you encounter anything similar to a CAPTCHA test, you MUST first use \`browser_snapshot\` to get a clear view of the challenge before attempting to solve it using available tools (like \`browser_mouse_click_xy\` for visual elements).
- **Thoughts/Narration**: Before calling any tool, you must output a brief "thought" or "narration" explaining your reasoning and what you plan to do next. This helps us understand your decision-making process.
- **Complete Current Question**: You must fully answer the current question or fill out the current form BEFORE clicking "Next" or "Continue". Do not attempt to navigate away or skip ahead until the current step is done.
- **Sequential Actions**: Do NOT combine "answering" and "clicking Next" in the same turn if there is any risk of the page changing or the answer not registering. Select the answer, wait for the UI to update if needed, and THEN click Next in a subsequent turn or strictly ordered tool call.
- **Error Handling**:
    - If you see "Ref not found", it means your snapshot is stale. IMMEDIATELY call \`browser_snapshot\` to get the fresh state. Do not retry the same action without a new snapshot.
    - If you see "Execution context was destroyed", it means the page navigated. Call \`browser_snapshot\` to see the new page.
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
