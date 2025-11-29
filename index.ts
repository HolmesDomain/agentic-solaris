import { config } from "./src/config/env.js";
import { McpService } from "./src/services/McpService.js";
import { PlaywrightWrapperService } from "./src/services/PlaywrightWrapperService.js";
import { LlmService } from "./src/services/LlmService.js";
import { AgentService } from "./src/services/AgentService.js";
import { PersonaService } from "./src/services/PersonaService.js";

async function main() {
  console.log("Starting Survey Automation Agent...");

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

  try {
    await mcp.connect();

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
    Wait for the survey modal to load.
    Begin the survey and wait for it to load, it will open a new tab.`;
    await agent.runTask(selectSurveyTask);

    console.log("\nWorkflow completed successfully (Steps 1-3). Starting Loop...");

    const MAX_CHUNKS = 35;
    const QUESTIONS_PER_CHUNK = 3;
    let surveyCompleted = false;

    for (let i = 0; i < MAX_CHUNKS; i++) {
      console.log(`\n--- Chunk ${i + 1} / ${MAX_CHUNKS} ---`);

      const answerTask = `
      You are completing a survey. You are a 23-year-old IT Consultant embodying this persona:
      ${personaService.getFormattedPersona()}

      CRITICAL TASK: You MUST answer EXACTLY ${QUESTIONS_PER_CHUNK} survey questions.
      CURRENT PROGRESS: Chunk ${i + 1} of ${MAX_CHUNKS}.

      IMPORTANT CHECKS:
      - **STRICTLY** stick to the domain provided in the task: ${config.TARGET_HOST}. 
      - If you find yourself on an unexpected domain (e.g., google.com, swagbucks.com) without a clear reason, immediately navigate back to the start URL.
      - Did you start a survey and forget it in a separate browser tab? Check your open tabs if you are not on a survey page.
      - ALWAYS verify you are on the correct tab before performing actions.
      - **NEVER SKIP QUESTIONS**: You must NEVER skip a survey question. Always select an answer that aligns with the defined persona. If a question is optional, answer it anyway.
      - **Complete Question BEFORE clicking "Next"**
      - Keep a mental count: "Question 1 of ${QUESTIONS_PER_CHUNK}", "Question 2 of ${QUESTIONS_PER_CHUNK}", etc.
      - For EACH question:
        1. Read the question carefully.
        2. Select/type the answer that this persona would give.
        3. Click the actual answer option OR type in the text field.
        4. Click "Next" or "Continue" (NOT "Skip").
        5. Increment your count.
        6. ALWAYS use VISION CAPABILITES/ TOOLS. Solve them, do not skip. (Spectrum Surveys for example)
      
      - If you see "Welcome back" or "Start Survey", click it and count it as 0 (setup).
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

    if (!surveyCompleted) {
      console.log("\n❌ Max chunks reached without completion. Exiting with error to trigger restart.");

      const stats = agent.getTokenStats();
      console.log("\n=== Token Usage Summary ===");
      console.log(`Total: ${stats.total_tokens}`);
      console.log(`Prompt: ${stats.prompt_tokens}`);
      console.log(`Completion: ${stats.completion_tokens}`);
      console.log("===========================\n");

      process.exit(1);
    } else {
      console.log("\n✅ Workflow completed successfully.");

      const stats = agent.getTokenStats();
      console.log("\n=== Token Usage Summary ===");
      console.log(`Total: ${stats.total_tokens}`);
      console.log(`Prompt: ${stats.prompt_tokens}`);
      console.log(`Completion: ${stats.completion_tokens}`);
      console.log("===========================\n");

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
