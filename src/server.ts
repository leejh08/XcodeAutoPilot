// ============================================================
// XcodeAutoPilot — MCP Server Setup & Tool Routing
// ============================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { logger } from "./utils/logger.js";

// Tool handlers
import { handleAutopilotRun, autopilotRunSchema } from "./tools/autopilot-run.js";
import { handleAutopilotBuild, autopilotBuildSchema } from "./tools/autopilot-build.js";
import { handleAutopilotAnalyze, autopilotAnalyzeSchema } from "./tools/autopilot-analyze.js";
import { handleListSchemes, listSchemesSchema } from "./tools/list-schemes.js";
import { handleClean, cleanSchema } from "./tools/clean.js";
import { handleHistory } from "./tools/history.js";

// ----------------------------------------------------------
// Tool definitions (for ListTools response)
// ----------------------------------------------------------

const TOOLS = [
  {
    name: "autopilot_run",
    description:
      "Run the full autopilot loop: build → analyze errors → auto-fix → rebuild, " +
      "repeating until errors are resolved or max_iterations is reached. " +
      "This is the main tool — use this to automatically fix Xcode build errors.",
    inputSchema: zodToJsonSchema(autopilotRunSchema),
  },
  {
    name: "autopilot_build",
    description:
      "Run xcodebuild and return a list of errors and warnings. No fixes are applied.",
    inputSchema: zodToJsonSchema(autopilotBuildSchema),
  },
  {
    name: "autopilot_analyze",
    description:
      "Build the project and analyze errors with Claude AI, but do NOT apply any fixes (dry-run). " +
      "Returns error analysis and suggested fix directions.",
    inputSchema: zodToJsonSchema(autopilotAnalyzeSchema),
  },
  {
    name: "autopilot_list_schemes",
    description: "List all available build schemes in the Xcode project.",
    inputSchema: zodToJsonSchema(listSchemesSchema),
  },
  {
    name: "autopilot_clean",
    description: "Run xcodebuild clean to remove derived data for the project.",
    inputSchema: zodToJsonSchema(cleanSchema),
  },
  {
    name: "autopilot_history",
    description:
      "Return the history of all autopilot_run sessions in the current server session.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ----------------------------------------------------------
// Zod → JSON Schema converter (minimal)
// ----------------------------------------------------------

function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodField = value as z.ZodTypeAny;
    const fieldSchema = zodFieldToJsonSchema(zodField);
    properties[key] = fieldSchema;

    // A field is required if it's not optional and has no default
    if (!(zodField instanceof z.ZodOptional) && !(zodField instanceof z.ZodDefault)) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  // Unwrap Optional/Default
  if (field instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(field.unwrap());
  }
  if (field instanceof z.ZodDefault) {
    const inner = zodFieldToJsonSchema(field._def.innerType);
    return { ...inner, default: field._def.defaultValue() };
  }
  if (field instanceof z.ZodString) {
    return { type: "string", description: (field.description as string) ?? "" };
  }
  if (field instanceof z.ZodNumber) {
    const schema: Record<string, unknown> = { type: "number" };
    if (field.description) schema["description"] = field.description;
    return schema;
  }
  if (field instanceof z.ZodBoolean) {
    return { type: "boolean", description: (field.description as string) ?? "" };
  }
  if (field instanceof z.ZodEnum) {
    return { type: "string", enum: field.options };
  }
  return { type: "string" };
}

// ----------------------------------------------------------
// Server factory
// ----------------------------------------------------------

export function createServer(): Server {
  const server = new Server(
    {
      name: "xcode-autopilot",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug("ListTools requested");
    return { tools: TOOLS };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.info(`Tool called: ${name}`);

    try {
      let result: string;

      switch (name) {
        case "autopilot_run": {
          const parsed = autopilotRunSchema.parse(args);
          result = await handleAutopilotRun(parsed);
          break;
        }
        case "autopilot_build": {
          const parsed = autopilotBuildSchema.parse(args);
          result = await handleAutopilotBuild(parsed);
          break;
        }
        case "autopilot_analyze": {
          const parsed = autopilotAnalyzeSchema.parse(args);
          result = await handleAutopilotAnalyze(parsed);
          break;
        }
        case "autopilot_list_schemes": {
          const parsed = listSchemesSchema.parse(args);
          result = await handleListSchemes(parsed);
          break;
        }
        case "autopilot_clean": {
          const parsed = cleanSchema.parse(args);
          result = await handleClean(parsed);
          break;
        }
        case "autopilot_history": {
          result = await handleHistory();
          break;
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Tool error (${name}): ${message}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
