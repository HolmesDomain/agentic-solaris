/**
 * Environment configuration
 */

export const config = {
    // Target website
    TARGET_HOST: process.env.TARGET_HOST || "https://cashinstyle.com",
    TARGET_EMAIL: process.env.TARGET_EMAIL || "",
    TARGET_PASSWORD: process.env.TARGET_PASSWORD || "",

    // LLM Configuration
    MODEL_NAME: process.env.MODEL_NAME || "google/gemini-2.0-flash-exp:free",
    LLM_BASE_URL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
    LLM_API_KEY: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || "",

    // Survey Configuration  
    SURVEY_STRATEGY: process.env.SURVEY_STRATEGY || "first_available",
    PERSONA: process.env.PERSONA || "default",

    // Browser limits
    MAX_PAGES: parseInt(process.env.MAX_PAGES || "10"),
    RESTART_AFTER_PAGES: parseInt(process.env.RESTART_AFTER_PAGES || "0"),

    // Timeouts (in milliseconds)
    PAGE_IDLE_TIMEOUT_MS: parseInt(process.env.PAGE_IDLE_TIMEOUT_MINUTES || "6") * 60 * 1000,
    RESTART_APP_AFTER_MS: parseInt(process.env.RESTART_APP_AFTER_MINUTES || "0") * 60 * 1000,
};

// Log config on startup
console.log("📋 Configuration loaded:");
console.log(`  PERSONA: ${config.PERSONA}`);
console.log(`  MAX_PAGES: ${config.MAX_PAGES}`);
console.log(`  RESTART_AFTER_PAGES: ${config.RESTART_AFTER_PAGES}`);
console.log(`  PAGE_IDLE_TIMEOUT_MINUTES: ${config.PAGE_IDLE_TIMEOUT_MS / 60000} minutes`);
console.log(`  RESTART_APP_AFTER_MINUTES: ${config.RESTART_APP_AFTER_MS / 60000} minutes`);
