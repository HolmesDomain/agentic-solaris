import OpenAI from "openai";
import { config } from "../config/env.js";

export class LlmService {
    private openai: OpenAI;
    private model: string;

    constructor() {
        this.openai = new OpenAI({
            baseURL: config.OPENROUTER_BASE_URL,
            apiKey: config.OPENROUTER_API_KEY,
        });
        this.model = config.MODEL_NAME;
    }

    async chat(
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
        toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption
    ) {
        return await this.openai.chat.completions.create({
            model: this.model,
            messages,
            tools,
            tool_choice: toolChoice,
        });
    }
}
