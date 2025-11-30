import { spawn } from "bun";
import path from "path";
import fs from "fs";

// Helper to parse env files
function parseEnv(filePath: string) {
    const content = fs.readFileSync(filePath, "utf-8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^["']|["']$/g, ""); // Remove quotes
            env[key] = value;
        }
    }
    return env;
}

// Load environment files
const envPrime = parseEnv(path.join(import.meta.dir, ".env.prime"));
const envStyle = parseEnv(path.join(import.meta.dir, ".env.style"));
const envGrab = parseEnv(path.join(import.meta.dir, ".env.grab"));

interface AppConfig {
    name: string;
    script: string;
    cwd: string;
    env: Record<string, string>;
    instances: number;
    staggerDelay: number;
    autorestart: boolean;
}

const config: { apps: AppConfig[] } = {
    apps: [
        {
            name: "solaris-style",
            script: "dist/index.js",
            cwd: import.meta.dir,
            env: envStyle,
            instances: 2,
            staggerDelay: 10000, // 10 seconds
            autorestart: true,
        },
        // {
        //     name: "solaris-prime",
        //     script: "dist/index.js",
        //     cwd: import.meta.dir,
        //     env: envPrime,
        //     instances: 7,
        //     staggerDelay: 20000, // 20 seconds
        //     autorestart: true,
        // },
        // {
        //     name: "solaris-grab",
        //     script: "dist/index.js",
        //     cwd: import.meta.dir,
        //     env: envGrab,
        //     instances: 4,
        //     staggerDelay: 10000, // 10 seconds
        //     autorestart: true,
        // },
    ],
};

// Track processes
const processes = new Map<string, { proc: any; app: AppConfig; instanceNum: number }>();
let isShuttingDown = false;

function startProcess(app: AppConfig, instanceNum: number) {
    const procId = `${app.name}-${instanceNum}`;

    const proc = spawn(["bun", "run", app.script], {
        cwd: app.cwd,
        env: {
            ...process.env,
            ...app.env,
            INSTANCE_ID: instanceNum.toString(),
            PROCESS_NAME: procId,
        },
        stdout: "pipe",
        stderr: "pipe",
        onExit(subprocess, exitCode, signalCode, error) {
            console.log(`[${procId}] Exited with code ${exitCode} (${signalCode || "normal"})`);
            processes.delete(procId);

            if (app.autorestart && !isShuttingDown) {
                console.log(`[${procId}] Restarting in 5 seconds...`);
                setTimeout(() => {
                    if (!isShuttingDown) {
                        console.log(`[${procId}] Restarting now...`);
                        startProcess(app, instanceNum);
                    }
                }, 5000);
            }
        },
    });

    processes.set(procId, { proc, app, instanceNum });

    // Stream output
    async function streamOutput(stream: ReadableStream, type: "stdout" | "stderr") {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value).trim();
            if (text) {
                const lines = text.split("\n");
                for (const line of lines) {
                    if (type === "stdout") console.log(`[${procId}] ${line}`);
                    else console.error(`[${procId}] ERROR: ${line}`);
                }
            }
        }
    }

    if (proc.stdout) streamOutput(proc.stdout, "stdout");
    if (proc.stderr) streamOutput(proc.stderr, "stderr");

    console.log(`[${procId}] Started (PID: ${proc.pid})`);
    return proc;
}

async function startAppInstances(app: AppConfig) {
    console.log(`\nStarting ${app.instances} ${app.name} instances with ${app.staggerDelay / 1000}s stagger...`);

    for (let i = 1; i <= app.instances; i++) {
        if (isShuttingDown) break;
        startProcess(app, i);

        if (i < app.instances) {
            console.log(`Waiting ${app.staggerDelay / 1000} seconds before starting next instance...`);
            await new Promise((resolve) => setTimeout(resolve, app.staggerDelay));
        }
    }

    console.log(`${app.name} startup complete!`);
}

async function startAllApps() {
    console.log("=== Staggered Process Manager Starting ===\n");

    for (const app of config.apps) {
        if (isShuttingDown) break;
        await startAppInstances(app);
    }

    console.log("\n=== All instances started! ===");
    logStatus();
}

function logStatus() {
    console.log("\n=== Process Status ===");
    const byApp: Record<string, number> = {};

    for (const [_, { app }] of processes.entries()) {
        byApp[app.name] = (byApp[app.name] || 0) + 1;
    }

    for (const [name, count] of Object.entries(byApp)) {
        console.log(`${name}: ${count} instances running`);
    }
    console.log(`Total: ${processes.size} processes\n`);
}

function shutdown() {
    if (isShuttingDown) return;

    isShuttingDown = true;
    console.log("\n=== Shutting down gracefully... ===");

    for (const [procId, { proc }] of processes.entries()) {
        console.log(`Stopping ${procId}...`);
        proc.kill("SIGTERM");
    }

    // Force exit after 10 seconds
    setTimeout(() => {
        console.log("Force killing remaining processes...");
        for (const [_, { proc }] of processes.entries()) {
            proc.kill("SIGKILL");
        }
        process.exit(0);
    }, 10000);

    // Check if all exited
    const checkInterval = setInterval(() => {
        if (processes.size === 0) {
            clearInterval(checkInterval);
            process.exit(0);
        }
    }, 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGUSR2", logStatus);

startAllApps().catch((err) => {
    console.error("Startup error:", err);
    process.exit(1);
});
