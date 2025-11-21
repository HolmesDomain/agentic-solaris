import { config } from "../config/env.js";

async function testConnection() {
    const url = config.LLM_BASE_URL;
    console.log(`Testing connection to: ${url}`);

    try {
        const response = await fetch(`${url}/models`, {
            method: "GET",
        });

        console.log(`Status: ${response.status} ${response.statusText}`);
        if (response.ok) {
            const data = await response.json();
            console.log("Connection successful!");
            console.log("Available models:", JSON.stringify(data, null, 2));
        } else {
            console.error("Connection failed with status:", response.status);
        }
    } catch (error) {
        console.error("Connection failed:", error);
        if (error instanceof Error) {
            console.error("Error name:", error.name);
            console.error("Error message:", error.message);
            if ('cause' in error) {
                console.error("Cause:", error.cause);
            }
        }
    }
}

testConnection();
