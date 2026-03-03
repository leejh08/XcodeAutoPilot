// ============================================================
// XcodeAutoPilot — MCP Server Entry Point
// ============================================================

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  logger.section("XcodeAutoPilot MCP Server starting...");

  // Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error("ANTHROPIC_API_KEY is not set. Claude API calls will fail.");
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  logger.info("XcodeAutoPilot MCP server connected via stdio. Ready.");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down...");
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down...");
    await server.close();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[XcodeAutoPilot] Fatal error: ${message}`);
  process.exit(1);
});
