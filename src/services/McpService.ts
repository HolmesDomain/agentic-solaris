import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export class McpService {
    private client: Client;
    private transport: StdioClientTransport;
    private isConnected: boolean = false;

    constructor() {
        this.transport = new StdioClientTransport({
            command: "npx",
            args: ["-y", "@playwright/mcp@latest", "--isolated", "--caps=vision"],
        });

        this.client = new Client(
            {
                name: "playwright-client",
                version: "1.0.0",
            },
            {
                capabilities: {},
            }
        );
    }

    async connect() {
        if (this.isConnected) return;
        console.log("Starting Playwright MCP Server...");
        await this.client.connect(this.transport);
        this.isConnected = true;
        console.log("Connected to Playwright MCP Server.");
    }

    async getTools() {
        if (!this.isConnected) await this.connect();
        const toolsList = await this.client.listTools();
        return toolsList.tools;
    }

    async callTool(name: string, args: any): Promise<CallToolResult> {
        if (!this.isConnected) await this.connect();
        return await this.client.callTool({
            name,
            arguments: args,
        });
    }

    async close() {
        if (!this.isConnected) return;
        try {
            await this.client.callTool({ name: "browser_close", arguments: {} });
        } catch (e) {
            // Ignore
        }
        await this.client.close();
        this.isConnected = false;
    }

    async restart() {
        console.log("Restarting MCP connection...");
        await this.close();

        // Recreate transport and client
        this.transport = new StdioClientTransport({
            command: "npx",
            args: ["-y", "@playwright/mcp@latest", "--isolated", "--caps=vision"],
        });

        this.client = new Client(
            {
                name: "playwright-client",
                version: "1.0.0",
            },
            {
                capabilities: {},
            }
        );

        await this.connect();
        console.log("✅ MCP connection restarted");
    }
}
