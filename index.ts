import { config } from "./src/config/env.js";
import { McpService } from "./src/services/McpService.js";
import { PlaywrightWrapperService } from "./src/services/PlaywrightWrapperService.js";
import { LlmService } from "./src/services/LlmService.js";
import { AgentService } from "./src/services/AgentService.js";
import { PersonaService } from "./src/services/PersonaService.js";

async function main() {
  console.log("Starting Survey Automation Agent...");
  const startTime = Date.now();

  // Timer flag to signal shutdown
  let timerExpired = false;

  // Start Global Restart Timer
  if (config.RESTART_APP_AFTER_MS > 0) {
    console.log(`🕒 App will run for ${(config.RESTART_APP_AFTER_MS / 60000).toFixed(1)} minutes before logout.`);
    setTimeout(() => {
      console.log(`\n⏰ Timer expired after ${(config.RESTART_APP_AFTER_MS / 60000).toFixed(1)} minutes.`);
      timerExpired = true;
    }, config.RESTART_APP_AFTER_MS);
  }

  // Initialize Services
  const mcpRaw = new McpService();
  const mcp = new PlaywrightWrapperService(
    mcpRaw,
    config.MAX_PAGES,
    config.RESTART_AFTER_PAGES,
    config.PAGE_IDLE_TIMEOUT_MS
  );
  const llm = new LlmService();
  const personaService = new PersonaService();
  const agent = new AgentService(mcp as any, llm);

  // Helper function to logout
  async function logout() {
    console.log("\n🚪 Logging out...");
    try {
      await agent.runTask(`
        Navigate to the account settings or profile menu.
        Find and click the "Log Out", "Sign Out", or "Logout" button.
        Wait for the logout to complete (you should see the login page or home page).
      `);
      console.log("✅ Logged out successfully.");
    } catch (e) {
      console.error("⚠️ Logout failed:", e);
    }
  }

  try {
    await mcp.connect();

    // Step 1: Login
    const loginTask = `Visit ${config.TARGET_HOST}. 
    Check if we are logged in. 
    If not, login with email: ${config.TARGET_EMAIL} and password: ${config.TARGET_PASSWORD}.`;

    await agent.runTask(loginTask);

    const surveysTask = "Once logged in, on the left side of the dashboard click Surveys.";

    await agent.runTask(surveysTask);

    let strategyDescription = "that is first available";
    if (config.SURVEY_STRATEGY === "shortest_available") {
      strategyDescription = "that takes the shortest amount of time";
    } else if (config.SURVEY_STRATEGY === "highest_payout") {
      strategyDescription = "that offers the highest payout/reward";
    }

    const selectSurveyTask = `Select the survey ${strategyDescription} and a descriptor of similar format: "Survey (5353051...)". 
    
    AVOID THESE PROVIDERS (they often have no surveys):
    - Prime Surveys (monetize.primeearn.com) - frequently shows "No surveys at the moment"
    - Any provider showing "No surveys", "Come back later", or empty survey lists
    
    IF you click a provider and see "No surveys at the moment" or similar:
    1. Go back to the main surveys page
    2. Try a DIFFERENT survey provider/tile
    3. Do NOT waste time on empty providers
    
    Wait for the survey modal to load.
    Begin the survey and wait for it to load, it will open a new tab.`;
    await agent.runTask(selectSurveyTask);

    console.log("\nWorkflow completed successfully (Steps 1-3). Starting Loop...");

    const MAX_CHUNKS = 35;
    const QUESTIONS_PER_CHUNK = 3;
    let surveyCompleted = false;

    for (let i = 0; i < MAX_CHUNKS; i++) {
      // Check if timer expired
      if (timerExpired) {
        console.log("\n⏰ Timer expired. Breaking out of survey loop...");
        break;
      }

      console.log(`\n--- Chunk ${i + 1} / ${MAX_CHUNKS} ---`);

      const answerTask = `
      You are completing a survey as a 23-year-old IT Consultant with this persona:
      ${personaService.getFormattedPersona()}

      CRITICAL TASK: Answer EXACTLY ${QUESTIONS_PER_CHUNK} survey questions, then STOP.
      CURRENT PROGRESS: Chunk ${i + 1} of ${MAX_CHUNKS}.

      RULES:
      1. Keep count: "Question 1/${QUESTIONS_PER_CHUNK}", "Question 2/${QUESTIONS_PER_CHUNK}", etc.
      2. For EACH question:
         - Read carefully
         - Select/type the persona-appropriate answer
         - Click "Next" or "Continue" (NEVER "Skip")
         - Increment count
      3. After answering question ${QUESTIONS_PER_CHUNK}/${QUESTIONS_PER_CHUNK} and clicking Next, STOP immediately.
      4. If you see "Welcome back" or "Start Survey", click it (counts as setup, not a question).

      IMPORTANT CHECKS:
      - Stay on ${config.TARGET_HOST}. If redirected elsewhere, navigate back immediately.
      - If logged out, re-login with: ${config.TARGET_EMAIL} / ${config.TARGET_PASSWORD}
      - Check open tabs - you may have a survey in another tab.
      - Verify you're on the correct tab before acting.

      TAB MANAGEMENT:
      - If you see "disqualified", "not a match", "survey closed", or similar → CLOSE that tab immediately using browser_tabs with action "close".
      - If you see "Thank you for your participation" or completion message → CLOSE that tab.
      - If you see "No surveys at the moment" or "come back later" → CLOSE that tab and go back to pick a different provider.
      - Keep only 1-2 survey tabs open at a time. Close old/stale tabs.
      - The main dashboard tab (index 0) should stay open.

      NEVER SKIP:
      - Questions (even optional ones - always answer)
      - CAPTCHAs - use browser_take_screenshot to SEE the image, then READ and TYPE the exact text
      - Visual challenges like Spectrum Surveys - use browser_take_screenshot first
      `;

      try {
        await agent.runTask(answerTask);
      } catch (error) {
        console.error(`Error in Chunk ${i + 1}:`, error);
        console.log("Attempting one retry for this chunk...");
        try {
          await agent.runTask(answerTask);
        } catch (retryError) {
          console.error(`Retry failed for Chunk ${i + 1}. Moving to next chunk logic (or exiting if critical).`, retryError);
          // Depending on severity, we might want to break or continue. 
          // For now, we'll let the completion check decide.
        }
      }

      // 2. Check if Complete
      const isComplete = await agent.checkIfComplete();
      if (isComplete) {
        console.log("Survey Completed!");
        surveyCompleted = true;

        // Close all browser tabs
        console.log("Closing browser tabs...");
        const tabs = await mcp.getTabsState();
        for (const tab of tabs) {
          try {
            await mcp.callTool("browser_tabs", { action: "close", index: tab.index });
          } catch (e) {
            console.error(`Failed to close tab ${tab.index}:`, e);
          }
        }

        break;
      } else {
        console.log("Survey not complete, continuing...");
      }
    }

    // Print token stats
    const stats = agent.getTokenStats();
    console.log("\n=== Token Usage Summary ===");
    console.log(`Total: ${stats.total_tokens}`);
    console.log(`Prompt: ${stats.prompt_tokens}`);
    console.log(`Completion: ${stats.completion_tokens}`);
    console.log("===========================\n");

    // Always logout before exiting
    await logout();

    if (timerExpired) {
      console.log("\n⏰ Exiting due to timer expiration.");
      process.exit(0);
    } else if (!surveyCompleted) {
      console.log("\n❌ Max chunks reached without completion. Exiting with error to trigger restart.");
      process.exit(1);
    } else {
      console.log("\n✅ Workflow completed successfully.");
      process.exit(0);
    }

  } catch (error) {
    console.error("Workflow failed:", error);
    process.exit(1);
  } finally {
    await mcpRaw.close();
  }
}

main().catch(console.error);
