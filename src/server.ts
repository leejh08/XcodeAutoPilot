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
import { handleAutopilotBuild, autopilotBuildSchema } from "./tools/autopilot-build.js";
import { handleAutopilotApplyFixes, autopilotApplyFixesSchema } from "./tools/autopilot-apply-fixes.js";
import { handleAutopilotResolveSpm, autopilotResolveSpmSchema } from "./tools/autopilot-resolve-spm.js";
import { handleListSchemes, listSchemesSchema } from "./tools/list-schemes.js";
import { handleClean, cleanSchema } from "./tools/clean.js";
import { handleHistory } from "./tools/history.js";
import { handleCacheClean, cacheClearSchema } from "./tools/cache-clean.js";

// ----------------------------------------------------------
// Tool definitions (for ListTools response)
// ----------------------------------------------------------

const TOOLS = [
  {
    name: "autopilot_build",
    description:
      "Run xcodebuild and return structured errors and warnings WITH source code context " +
      "(±50 lines around each error). Use this to get all the information needed to generate fixes. " +
      "After calling this tool, analyze the errors and call autopilot_apply_fixes with your fixes.",
    inputSchema: zodToJsonSchema(autopilotBuildSchema),
  },
  {
    name: "autopilot_apply_fixes",
    description:
      "Apply a list of fixes to source files safely. Each fix specifies a file path, line number, " +
      "the original line content (for verification), and the replacement. Files are backed up before " +
      "modification and scope-checked against the project path.",
    inputSchema: zodToJsonSchema(autopilotApplyFixesSchema),
  },
  {
    name: "autopilot_resolve_spm",
    description:
      "Run xcodebuild -resolvePackageDependencies and return structured SPM errors " +
      "(version conflicts, clone failures, Swift version mismatches). " +
      "Use this when a build fails due to missing or unresolvable packages.",
    inputSchema: zodToJsonSchema(autopilotResolveSpmSchema),
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
    name: "autopilot_cache_clean",
    description:
      "Selectively clear Xcode caches that xcodebuild clean does not cover. " +
      "Use 'project' to remove DerivedData for this project, 'module_cache' for ModuleCache.noindex, " +
      "'spm' for SPM fetch cache and SourcePackages, 'index' for the Index store, or 'all' for everything.",
    inputSchema: zodToJsonSchema(cacheClearSchema),
  },
  {
    name: "autopilot_history",
    description:
      "Return the history of all autopilot_apply_fixes sessions in the current server session.",
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

    if (!(zodField instanceof z.ZodOptional) && !(zodField instanceof z.ZodDefault)) {
      required.push(key);
    }
  }

  return { type: "object", properties, required };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodOptional) return zodFieldToJsonSchema(field.unwrap());
  if (field instanceof z.ZodDefault) {
    const inner = zodFieldToJsonSchema(field._def.innerType);
    return { ...inner, default: field._def.defaultValue() };
  }
  if (field instanceof z.ZodString) return { type: "string", description: (field.description as string) ?? "" };
  if (field instanceof z.ZodNumber) {
    const s: Record<string, unknown> = { type: "number" };
    if (field.description) s["description"] = field.description;
    return s;
  }
  if (field instanceof z.ZodBoolean) return { type: "boolean", description: (field.description as string) ?? "" };
  if (field instanceof z.ZodEnum) return { type: "string", enum: field.options };
  if (field instanceof z.ZodArray) {
    return { type: "array", items: zodFieldToJsonSchema(field.element), description: (field.description as string) ?? "" };
  }
  if (field instanceof z.ZodObject) return zodToJsonSchema(field);
  return { type: "string" };
}

// ----------------------------------------------------------
// Server factory
// ----------------------------------------------------------

export function createServer(): Server {
  const server = new Server(
    { name: "xcode-autopilot", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug("ListTools requested");
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info(`Tool called: ${name}`);

    try {
      let result: string;

      switch (name) {
        case "autopilot_build": {
          const parsed = autopilotBuildSchema.parse(args);
          result = await handleAutopilotBuild(parsed);
          break;
        }
        case "autopilot_apply_fixes": {
          const parsed = autopilotApplyFixesSchema.parse(args);
          result = await handleAutopilotApplyFixes(parsed);
          break;
        }
        case "autopilot_resolve_spm": {
          const parsed = autopilotResolveSpmSchema.parse(args);
          result = await handleAutopilotResolveSpm(parsed);
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
        case "autopilot_cache_clean": {
          const parsed = cacheClearSchema.parse(args);
          result = await handleCacheClean(parsed);
          break;
        }
        case "autopilot_history": {
          result = await handleHistory();
          break;
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Tool error (${name}): ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  return server;
}
