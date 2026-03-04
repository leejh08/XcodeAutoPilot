---
id: xap-fix
name: xap-fix
description: Fix current Xcode build errors using XcodeAutoPilot MCP tools with deep source context analysis.
triggers:
  - xfix
  - xap fix
tags:
  - xcode
  - fix
  - autopilot
source: manual
---

# xap-fix

Trigger with: **`xfix`** or **`xap fix`**

## What it does

Focuses on fixing errors with careful analysis of source context:

1. `autopilot_build` — get errors with full ±50 line context
2. Read and understand the surrounding code before generating fixes
3. `autopilot_apply_fixes` — apply fixes verified against original line content
4. Verify with another `autopilot_build` — repeat if needed (max 5 iterations)

## Difference from xap-build

`xap-fix` emphasizes careful error analysis over speed. Use when:
- Errors are complex (type mismatches, API changes, protocol conformance)
- Previous fix attempts introduced new errors
- You want higher confidence fixes before applying

## Required inputs

- `project_path` — absolute path to `.xcodeproj` or `.xcworkspace`
- `scheme` — Xcode build scheme name

## Tool sequence

```
autopilot_build(project_path, scheme)
  → analyze each error + source context carefully
  → autopilot_apply_fixes(project_path, fixes[])
  → autopilot_build(project_path, scheme)  ← verify
  → repeat if errors remain (max 5x)
  → report: fixed / unfixable / remaining
```
