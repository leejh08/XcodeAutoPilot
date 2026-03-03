// ============================================================
// XcodeAutoPilot — Claude API Fixer
// Calls Claude API to analyze build errors and generate fixes
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";
import type {
  BuildDiagnostic,
  ClaudeFixResponse,
  Fix,
  UnfixableError,
} from "../types.js";
import type { FileContext } from "../utils/context-extractor.js";

// ----------------------------------------------------------
// Configuration
// ----------------------------------------------------------

const MODEL =
  process.env.AUTOPILOT_MODEL ?? "claude-sonnet-4-6";

const MAX_TOKENS = 8192;

// ----------------------------------------------------------
// Claude client (lazy init)
// ----------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is not set. " +
          "Please set it before running XcodeAutoPilot."
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// ----------------------------------------------------------
// System prompt
// ----------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert iOS/macOS Swift developer and Xcode build error specialist.
You receive Xcode build errors with the relevant source code context.

Rules:
1. Provide the MINIMUM change needed to fix each error.
2. Do NOT refactor, rename, or change unrelated code.
3. Do NOT add features or "improve" the code.
4. Preserve the original code style, indentation, and conventions.
5. If a fix requires adding an import statement, include it as a separate fix entry.
6. If an error cannot be auto-fixed (e.g., missing dependency, architectural issue), put it in "unfixable".

Respond with ONLY valid JSON (no markdown fences, no preamble):
{
  "fixes": [
    {
      "file_path": "/absolute/path/to/file.swift",
      "line_number": 42,
      "original_line": "    let x: Int = someString",
      "fixed_line": "    let x: Int = Int(someString) ?? 0",
      "explanation": "Cannot implicitly convert String to Int; added explicit conversion with default value"
    }
  ],
  "unfixable": [
    {
      "file_path": "/absolute/path/to/file.swift",
      "line_number": 10,
      "error_message": "No such module 'SomeFramework'",
      "reason": "Missing dependency — requires manual SPM/CocoaPods configuration"
    }
  ]
}`;

// ----------------------------------------------------------
// User message builder
// ----------------------------------------------------------

function buildUserMessage(
  diagnostics: BuildDiagnostic[],
  contextMap: Map<string, FileContext>
): string {
  const errors = diagnostics.filter((d) => d.type === "error");
  const lines: string[] = [];

  lines.push(`## Build Errors (${errors.length} total)\n`);

  errors.forEach((err, idx) => {
    lines.push(`### Error ${idx + 1}`);
    lines.push(`- **File**: ${err.file_path}`);
    lines.push(`- **Line**: ${err.line_number}${err.column_number ? `:${err.column_number}` : ""}`);
    lines.push(`- **Message**: ${err.message}`);
    lines.push("");
  });

  if (contextMap.size > 0) {
    lines.push("## Source Code Context\n");

    for (const [filePath, ctx] of contextMap) {
      lines.push(`### ${filePath}`);
      lines.push("```swift");
      lines.push(ctx.context_text);
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("Fix ONLY the listed build errors. Return JSON only.");

  return lines.join("\n");
}

// ----------------------------------------------------------
// Response parser
// ----------------------------------------------------------

function parseClaudeResponse(responseText: string): ClaudeFixResponse {
  // Strip potential markdown fences if Claude ignores instructions
  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.error(`Failed to parse Claude response as JSON: ${cleaned.substring(0, 200)}`);
    return { fixes: [], unfixable: [] };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { fixes: [], unfixable: [] };
  }

  const obj = parsed as Record<string, unknown>;

  const fixes: Fix[] = [];
  if (Array.isArray(obj["fixes"])) {
    for (const item of obj["fixes"]) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>)["file_path"] === "string" &&
        typeof (item as Record<string, unknown>)["line_number"] === "number" &&
        typeof (item as Record<string, unknown>)["original_line"] === "string" &&
        typeof (item as Record<string, unknown>)["fixed_line"] === "string"
      ) {
        const i = item as Record<string, unknown>;
        fixes.push({
          file_path: i["file_path"] as string,
          line_number: i["line_number"] as number,
          original_line: i["original_line"] as string,
          fixed_line: i["fixed_line"] as string,
          explanation: (i["explanation"] as string) ?? "",
        });
      }
    }
  }

  const unfixable: UnfixableError[] = [];
  if (Array.isArray(obj["unfixable"])) {
    for (const item of obj["unfixable"]) {
      if (typeof item === "object" && item !== null) {
        const i = item as Record<string, unknown>;
        unfixable.push({
          file_path: (i["file_path"] as string) ?? "",
          line_number: (i["line_number"] as number) ?? 0,
          error_message: (i["error_message"] as string) ?? "",
          reason: (i["reason"] as string) ?? "",
        });
      }
    }
  }

  return { fixes, unfixable };
}

// ----------------------------------------------------------
// Main API call (with 1 retry)
// ----------------------------------------------------------

export async function generateFixes(
  diagnostics: BuildDiagnostic[],
  contextMap: Map<string, FileContext>
): Promise<ClaudeFixResponse> {
  const client = getClient();
  const userMessage = buildUserMessage(diagnostics, contextMap);

  logger.info(`Calling Claude API (model: ${MODEL}) with ${diagnostics.filter((d) => d.type === "error").length} errors...`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const textContent = response.content.find((c) => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        logger.warn("Claude API returned no text content.");
        return { fixes: [], unfixable: [] };
      }

      const result = parseClaudeResponse(textContent.text);
      logger.info(
        `Claude API: ${result.fixes.length} fix(es) proposed, ` +
          `${result.unfixable.length} unfixable error(s)`
      );
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        logger.warn(`Claude API call failed (attempt ${attempt}): ${msg}. Retrying...`);
      } else {
        logger.error(`Claude API call failed after ${attempt} attempts: ${msg}`);
        return { fixes: [], unfixable: [] };
      }
    }
  }

  return { fixes: [], unfixable: [] };
}
