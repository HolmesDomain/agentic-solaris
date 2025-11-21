import { config } from "./src/config/env.js";
import { PERSONA } from "./src/data/persona.js";
import { McpService } from "./src/services/McpService.js";
import { LlmService } from "./src/services/LlmService.js";
import { AgentService } from "./src/services/AgentService.js";

async function main() {
  console.log("Starting Survey Automation Agent...");

  // Initialize Services
  const mcp = new McpService();
  const llm = new LlmService();
  const agent = new AgentService(mcp, llm);

  try {
    await mcp.connect();

    // Step 1: Login
    const loginTask = `Visit ${config.TARGET_URL}. 
    Check if we are logged in. 
    If not, login with email: ${config.CASHINSTYLE_EMAIL} and password: ${config.CASHINSTYLE_PASSWORD}.
    Wait for login to complete.`;

    await agent.runTask(loginTask);

    // Step 2: Go to Surveys
    const surveysTask = "Once logged in, on the left side of the dashboard click Surveys.";
    await agent.runTask(surveysTask);

    // Step 3: Select Survey
    const selectSurveyTask = `Select the survey with the lowest estimated time and a descriptor of similar format: "Survey (5353051...)". 
    Wait for the survey modal to load.
    Begin the survey and wait for it to load, it will open a new tab.`;
    await agent.runTask(selectSurveyTask);

    console.log("\nWorkflow completed successfully (Steps 1-3). Starting Loop...");

    // Step 4: Loop (Chunks)
    const MAX_CHUNKS = 40; // Updated as per user request
    const QUESTIONS_PER_CHUNK = 4;

    for (let i = 0; i < MAX_CHUNKS; i++) {
      console.log(`\n--- Chunk ${i + 1} / ${MAX_CHUNKS} ---`);

      // 1. Answer Questions (Fresh Context)
      const answerTask = `
      You are completing a survey. You are a 23-year-old IT Consultant embodying this persona:
      ${JSON.stringify(PERSONA.persona, null, 2)}

      CRITICAL TASK: You MUST answer EXACTLY ${QUESTIONS_PER_CHUNK} survey questions.

      IMPORTANT RULES:
      - Keep a mental count: "Question 1 of ${QUESTIONS_PER_CHUNK}", "Question 2 of ${QUESTIONS_PER_CHUNK}", etc.
      - For EACH question:
        1. Read the question carefully.
        2. Select/type the answer that this persona would give.
        3. Click the actual answer option OR type in the text field.
        4. Click "Next" or "Continue" (NOT "Skip").
        5. Increment your count.
      
      - After answering question ${QUESTIONS_PER_CHUNK} of ${QUESTIONS_PER_CHUNK} and clicking Next, THEN stop.
      - If you see "Welcome back" or "Start Survey", click it and count it as 0 (setup).
      `;

      await agent.runTask(answerTask);

      // 2. Check if Complete
      const isComplete = await agent.checkIfComplete();
      if (isComplete) {
        console.log("Survey Completed!");
        break;
      } else {
        console.log("Survey not complete, continuing...");
      }
    }

  } catch (error) {
    console.error("Workflow failed:", error);
  } finally {
    await mcp.close();
  }
}

main().catch(console.error);
