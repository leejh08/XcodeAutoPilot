---
id: xap-build
name: xap-build
description: Build an Xcode project and automatically fix all errors in a loop using XcodeAutoPilot MCP tools.
triggers:
  - xbuild
  - xap build
tags:
  - xcode
  - build
  - autopilot
  - fix
source: manual
---

# xap-build

Trigger with: **`xbuild`** or **`xap build`**

## What it does

Runs the full build → analyze → fix loop using XcodeAutoPilot MCP tools:

1. `autopilot_build` — compile and collect structured errors with ±50 line source context
2. Analyze errors using the source context
3. `autopilot_apply_fixes` — apply precise fixes (verified by original line content)
4. Repeat until 0 errors or 5 iterations exhausted

## Required inputs

- `project_path` — absolute path to `.xcodeproj` or `.xcworkspace`
- `scheme` — Xcode build scheme name

## Tool sequence

```
autopilot_build(project_path, scheme)
  → errors > 0 → autopilot_apply_fixes(project_path, fixes[])
  → autopilot_build(project_path, scheme)
  → ... repeat up to 5x
  → report summary
```

## Notes

- Each fix must include `file_path`, `line_number`, `original_line`, `fixed_line`, `explanation`
- `original_line` is verified before patching — must match exactly
- Files are backed up before modification
- Use `autopilot_cache_clean` first if build fails for non-code reasons
