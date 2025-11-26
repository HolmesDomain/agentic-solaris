import { config } from "./src/config/env.js";

console.log("\n🔍 Environment Variable Test\n");
console.log("=".repeat(50));
console.log(`MAX_PAGES: ${config.MAX_PAGES}`);
console.log(`RESTART_AFTER_PAGES: ${config.RESTART_AFTER_PAGES}`);
console.log(`PAGE_IDLE_TIMEOUT_MS: ${config.PAGE_IDLE_TIMEOUT_MS}ms`);
console.log(`MODEL_NAME: ${config.MODEL_NAME}`);
console.log(`SURVEY_STRATEGY: ${config.SURVEY_STRATEGY}`);
console.log("=".repeat(50));
console.log("\n✅ Configuration loaded successfully!\n");
