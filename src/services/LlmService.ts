import OpenAI from "openai";
import { config } from "../config/env.js";

export class LlmService {
    private openai: OpenAI;
    private model: string;

    constructor() {
        this.openai = new OpenAI({
            baseURL: config.LLM_BASE_URL,
            apiKey: config.LLM_API_KEY,
            maxRetries: 5, // Increase default retries for 429/5xx
        });
        this.model = config.MODEL_NAME;
    }

    async chat(
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
        toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption
    ) {
        const maxRetries = 5;
        let attempt = 0;
        let lastError: any;

        while (attempt < maxRetries) {
            try {
                return await this.openai.chat.completions.create({
                    model: this.model,
                    messages,
                    tools,
                    tool_choice: toolChoice,
                });
            } catch (error: any) {
                lastError = error;

                // Check if it's a retryable error (network, stream, or server error)
                // The SDK handles some retries, but we want to catch lower-level stream errors specifically
                const isRetryable =
                    error.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
                    error.type === 'system' ||
                    (error.message && (
                        error.message.includes('FetchError') ||
                        error.message.includes('network') ||
                        error.message.includes('connection')
                    ));

                if (!isRetryable && error.status !== 429 && error.status < 500) {
                    // Don't retry client errors (except rate limits which SDK handles, but we double check)
                    throw error;
                }

                console.warn(`LLM Chat attempt ${attempt + 1} failed:`, error.message);

                attempt++;
                if (attempt >= maxRetries) break;

                // Exponential backoff: 1s, 2s, 4s, 8s...
                const delay = Math.pow(2, attempt - 1) * 1000;
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }
}
