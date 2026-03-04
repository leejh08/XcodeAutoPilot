#!/usr/bin/env node
// ============================================================
// XAP — Keyword Detector Hook
// UserPromptSubmit hook: detects xap keywords and injects
// orchestration instructions into Claude's context.
// ============================================================

import { readFileSync } from "fs";

// ----------------------------------------------------------
// Keyword patterns
// ----------------------------------------------------------

const PATTERNS = [
  {
    key: "xap-build",
    regex: /\b(xbuild|xap[\s-]build)\b/i,
    priority: 1,
  },
  {
    key: "xap-fix",
    regex: /\b(xfix|xap[\s-]fix)\b/i,
    priority: 2,
  },
  {
    key: "xap-clean",
    regex: /\b(xclean|xap[\s-]clean)\b/i,
    priority: 3,
  },
  {
    key: "xap-spm",
    regex: /\b(xspm|xap[\s-]spm)\b/i,
    priority: 4,
  },
];

// ----------------------------------------------------------
// Context messages per keyword
// ----------------------------------------------------------

const CONTEXTS = {
  "xap-build": `
[XAP KEYWORD DETECTED: XBUILD]

You MUST immediately execute the xap-build workflow using the MCP tools:

1. If project_path or scheme are not clear from context, ask the user before proceeding.
2. Call \`autopilot_build\` to get current errors with source context.
3. Analyze all errors using the returned source context (±50 lines).
4. Call \`autopilot_apply_fixes\` with a fix for every fixable error.
5. Repeat steps 2–4 until 0 errors remain or 5 iterations are exhausted.
6. Report a summary: how many errors fixed, which files changed, any unfixable errors.

Do not ask for permission between steps. Execute the full loop autonomously.
`.trim(),

  "xap-fix": `
[XAP KEYWORD DETECTED: XFIX]

You MUST immediately execute the xap-fix workflow using the MCP tools:

1. If project_path or scheme are not clear from context, ask the user before proceeding.
2. Call \`autopilot_build\` to get the current error list with source context.
3. Carefully analyze each error using the ±50 line source context provided.
4. Call \`autopilot_apply_fixes\` with precise fixes for all fixable errors.
5. Call \`autopilot_build\` again to verify — repeat if errors remain (max 5 iterations).
6. Report what was fixed and flag any errors you could not fix with reasons.

Do not ask for permission between steps. Execute the full loop autonomously.
`.trim(),

  "xap-clean": `
[XAP KEYWORD DETECTED: XCLEAN]

You MUST immediately execute the xap-clean workflow using the MCP tools:

1. If project_path is not clear from context, ask the user before proceeding.
2. Ask the user which scope to clean if not specified:
   - \`project\` — DerivedData for this project (most common)
   - \`module_cache\` — Xcode ModuleCache.noindex
   - \`spm\` — SPM fetch cache + SourcePackages
   - \`index\` — Index store
   - \`all\` — everything above
   Default to \`project\` if the user says "clean" without a scope.
3. Call \`autopilot_cache_clean\` with the chosen scope.
4. Call \`autopilot_build\` to confirm the project still builds after cleaning.
5. Report what was deleted, space freed, and build result.

Do not ask for permission between steps. Execute the full workflow autonomously.
`.trim(),

  "xap-spm": `
[XAP KEYWORD DETECTED: XSPM]

You MUST immediately execute the xap-spm workflow using the MCP tools:

1. If project_path or scheme are not clear from context, ask the user before proceeding.
2. Call \`autopilot_resolve_spm\` to resolve package dependencies.
3. If SPM resolution fails or errors remain:
   a. Call \`autopilot_cache_clean\` with scope \`spm\` to nuke the SPM cache.
   b. Call \`autopilot_resolve_spm\` again.
4. Call \`autopilot_build\` to confirm the project builds cleanly after SPM resolution.
5. If build errors remain after SPM is resolved, call \`autopilot_apply_fixes\` as needed.
6. Report SPM resolution result, any packages that changed, and final build status.

Do not ask for permission between steps. Execute the full workflow autonomously.
`.trim(),
};

// ----------------------------------------------------------
// Stdin reading
// ----------------------------------------------------------

function readStdin() {
  try {
    return readFileSync("/dev/stdin", "utf8").trim();
  } catch {
    return "";
  }
}

function extractPrompt(data) {
  if (typeof data.prompt === "string") return data.prompt;
  if (typeof data.message?.content === "string") return data.message.content;
  if (Array.isArray(data.parts)) {
    return data.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

function sanitize(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")  // code blocks
    .replace(/`[^`]*`/g, " ")         // inline code
    .replace(/https?:\/\/\S+/g, " ")  // URLs
    .replace(/<[^>]+>/g, " ");        // XML/HTML tags
}

// ----------------------------------------------------------
// Main
// ----------------------------------------------------------

const raw = readStdin();
if (!raw) process.exit(0);

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const prompt = extractPrompt(data);
if (!prompt) process.exit(0);

const clean = sanitize(prompt);

// Match in priority order, pick first hit
let detected = null;
for (const pattern of PATTERNS) {
  if (pattern.regex.test(clean)) {
    detected = pattern.key;
    break;
  }
}

if (!detected) process.exit(0);

const context = CONTEXTS[detected];
const output = {
  continue: true,
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: context,
  },
};

process.stdout.write(JSON.stringify(output));
