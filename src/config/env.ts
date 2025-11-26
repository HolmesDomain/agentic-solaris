import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
    LLM_API_KEY: z.string().optional(),
    LLM_BASE_URL: z.string().optional(),
    MODEL_NAME: z.string().default("x-ai/grok-4.1-fast:free"),
    CASHINSTYLE_EMAIL: z.string(),
    CASHINSTYLE_PASSWORD: z.string(),
    TARGET_URL: z.string().default("https://cashinstyle.com"),
    SURVEY_STRATEGY: z.enum(["shortest_available", "highest_payout", "first_available"]).default("first_available"),
    MAX_PAGES: z.coerce.number().int().nonnegative().default(0), // 0 = unlimited
    RESTART_AFTER_PAGES: z.coerce.number().int().nonnegative().default(0),
    PAGE_IDLE_TIMEOUT_MINUTES: z.coerce.number().nonnegative().default(10),
}).transform((data) => {
    const apiKey = data.LLM_API_KEY || data.OPENROUTER_API_KEY || "not-needed";
    const baseUrl = data.LLM_BASE_URL || data.OPENROUTER_BASE_URL;

    return {
        ...data,
        LLM_API_KEY: apiKey,
        LLM_BASE_URL: baseUrl,
        PAGE_IDLE_TIMEOUT_MS: Math.floor(data.PAGE_IDLE_TIMEOUT_MINUTES * 60 * 1000),
    };
});

const processEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    MODEL_NAME: process.env.MODEL_NAME,
    CASHINSTYLE_EMAIL: process.env.CASHINSTYLE_EMAIL,
    CASHINSTYLE_PASSWORD: process.env.CASHINSTYLE_PASSWORD,
    TARGET_URL: process.env.TARGET_URL,
    SURVEY_STRATEGY: process.env.SURVEY_STRATEGY,
    MAX_PAGES: process.env.MAX_PAGES,
    RESTART_AFTER_PAGES: process.env.RESTART_AFTER_PAGES,
    PAGE_IDLE_TIMEOUT_MINUTES: process.env.PAGE_IDLE_TIMEOUT_MINUTES,
};

const parsedEnv = envSchema.safeParse(processEnv);

if (!parsedEnv.success) {
    console.error("❌ Invalid environment variables:", parsedEnv.error.format());
    process.exit(1);
}

export const config = parsedEnv.data;

// Debug: Log configuration values
console.log("📋 Configuration loaded:");
console.log(`  MAX_PAGES: ${config.MAX_PAGES}`);
console.log(`  RESTART_AFTER_PAGES: ${config.RESTART_AFTER_PAGES}`);
console.log(`  PAGE_IDLE_TIMEOUT_MINUTES: ${config.PAGE_IDLE_TIMEOUT_MS / 60000} minutes (${config.PAGE_IDLE_TIMEOUT_MS}ms)`);
