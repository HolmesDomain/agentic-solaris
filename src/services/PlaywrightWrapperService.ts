import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpService } from "./McpService.js";

export class PlaywrightWrapperService {
    private mcp: McpService;
    private maxPages: number;
    private restartAfterPages: number;
    private pageIdleTimeoutMs: number;
    private totalPagesCreated: number = 0;
    private browserContext: any = null;
    private tabActivity: Map<number, number> = new Map(); // Index -> Last Active Timestamp

    constructor(mcp: McpService, maxPages: number, restartAfterPages: number = 0, pageIdleTimeoutMs: number = 15000) {
        this.mcp = mcp;
        this.maxPages = maxPages;
        this.restartAfterPages = restartAfterPages;
        this.pageIdleTimeoutMs = pageIdleTimeoutMs;
    }

    private async getBrowserContext(): Promise<any> {
        // Get the browser context by inspecting the MCP connection
        // We'll access it through the client by calling a harmless tool
        if (!this.browserContext) {
            // Access the internal client to get the browser context
            // @ts-ignore - accessing private member
            const client = this.mcp['client'];
            // We can't directly access the context, so we'll track pages through tool responses
        }
        return this.browserContext;
    }

    public async getTabsState(): Promise<{ index: number, active: boolean, url: string }[]> {
        try {
            const result = await this.mcp.callTool("browser_tabs", { action: "list" });
            const tabs: { index: number, active: boolean, url: string }[] = [];

            // Helper to parse text lines
            const parseLine = (line: string) => {
                // Format: "- 0: [Title] (url)" or "- 0: (current) [Title] (url)"
                const match = line.match(/- (\d+): (\(current\) )?\[(.*?)\] \((.*?)\)/);
                if (match) {
                    return {
                        index: parseInt(match[1]),
                        active: !!match[2],
                        url: match[4]
                    };
                }
                return null;
            };

            if (result.content && Array.isArray(result.content)) {
                // Try JSON first
                for (const item of result.content) {
                    if (item.type === "resource" && item.resource?.mimeType === "application/json") {
                        try {
                            const resourceText = 'text' in item.resource ? item.resource.text : null;
                            if (resourceText) {
                                const data = JSON.parse(resourceText);
                                if (Array.isArray(data)) {
                                    // Map JSON structure to our format if possible
                                    // Assuming JSON structure matches what we need or we fallback
                                    // The standard MCP server might not return full JSON details for tabs yet
                                    // So we primarily rely on text parsing for now as seen in tests
                                }
                            }
                        } catch { }
                    }
                }

                // Fallback to text parsing (reliable for standard playwright-mcp)
                const textItem = result.content.find(c => c.type === "text");
                if (textItem && 'text' in textItem) {
                    const lines = textItem.text.split('\n');
                    for (const line of lines) {
                        const tab = parseLine(line);
                        if (tab) tabs.push(tab);
                    }
                }
            }
            return tabs;
        } catch (error) {
            return [];
        }
    }

    private async getPageCount(): Promise<number> {
        const tabs = await this.getTabsState();
        return tabs.length;
    }

    private async cleanupIdleTabs(): Promise<void> {
        if (this.pageIdleTimeoutMs <= 0) return;

        const tabs = await this.getTabsState();
        const now = Date.now();
        const activeTab = tabs.find(t => t.active);

        // Update activity for the currently active tab
        if (activeTab) {
            this.tabActivity.set(activeTab.index, now);
        }

        // Check for idle background tabs
        for (const tab of tabs) {
            // Skip the active tab - never auto-close what the user/agent is looking at
            if (tab.active) continue;

            const lastActive = this.tabActivity.get(tab.index);
            if (lastActive && (now - lastActive > this.pageIdleTimeoutMs)) {
                console.log(`[PlaywrightWrapper] 🕒 Closing idle tab ${tab.index} (Idle for ${Math.round((now - lastActive) / 1000)}s)`);
                try {
                    await this.mcp.callTool("browser_tabs", { action: "close", index: tab.index });
                    this.tabActivity.delete(tab.index);

                    // IMPORTANT: When a tab is closed, indices shift. 
                    // We stop processing this batch to avoid closing wrong tabs.
                    // Next tool call will handle remaining idle tabs.
                    return;
                } catch (e) {
                    console.error(`[PlaywrightWrapper] Failed to close idle tab ${tab.index}:`, e);
                }
            } else if (!lastActive) {
                // If we haven't seen this tab before, initialize it
                this.tabActivity.set(tab.index, now);
            }
        }
    }

    async callTool(name: string, args: any): Promise<CallToolResult> {
        // 1. Lazy Cleanup: Check for idle tabs before executing the tool
        await this.cleanupIdleTabs();

        // Check if this is a tool that creates new pages
        const createsPage =
            (name === "browser_navigate") ||
            (name === "browser_tabs" && args.action === "new");

        if (createsPage) {
            // If maxPages is 0, we treat it as unlimited
            if (this.maxPages === 0) {
                // Skip limit check
            } else {
                const currentPageCount = await this.getPageCount();

                // For browser_navigate, it might create a page or reuse existing
                // We need to check if there are any tabs before allowing
                if (name === "browser_navigate" && currentPageCount === 0) {
                    // First navigate always creates a page, allow it if under limit
                    if (currentPageCount >= this.maxPages) {
                        return {
                            content: [{
                                type: "text",
                                text: `Error: Tab limit reached (${this.maxPages}). Please close a tab first using browser_tabs with action 'close'.`
                            }],
                            isError: true
                        };
                    }
                } else if (name === "browser_tabs" && args.action === "new") {
                    // Explicitly creating a new tab
                    if (currentPageCount >= this.maxPages) {
                        return {
                            content: [{
                                type: "text",
                                text: `Error: Tab limit reached (${this.maxPages}). Cannot create new tab. Please close a tab first using browser_tabs with action 'close'.`
                            }],
                            isError: true
                        };
                    }
                }
            }
        }

        // Execute the tool
        const result = await this.mcp.callTool(name, args);

        // Update activity timestamp for the active tab (after tool execution)
        // We do this because the tool might have changed the active tab (e.g. select, new)
        const tabs = await this.getTabsState();
        const activeTab = tabs.find(t => t.active);
        if (activeTab) {
            this.tabActivity.set(activeTab.index, Date.now());
        }

        // Track page creation and check restart threshold
        if (createsPage && !result.isError) {
            this.totalPagesCreated++;
            console.log(`[PlaywrightWrapper] Total pages created: ${this.totalPagesCreated}/${this.restartAfterPages || '∞'}`);

            // Check if we should restart the browser
            if (this.restartAfterPages > 0 && this.totalPagesCreated >= this.restartAfterPages) {
                console.log(`[PlaywrightWrapper] ⚠️  Restart threshold reached! Restarting browser...`);
                await this.restartBrowser();
            }
        }

        return result;
    }

    private async restartBrowser(): Promise<void> {
        try {
            console.log("[PlaywrightWrapper] Restarting browser...");
            await this.mcp.restart();

            // Reset counter
            this.totalPagesCreated = 0;
            console.log("[PlaywrightWrapper] ✅ Browser restarted successfully");
        } catch (error) {
            console.error("[PlaywrightWrapper] ❌ Failed to restart browser:", error);
            throw error;
        }
    }

    async getTools() {
        return await this.mcp.getTools();
    }

    async connect() {
        return await this.mcp.connect();
    }

    async close() {
        return await this.mcp.close();
    }
}
