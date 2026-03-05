---
id: xap-test
name: xap-test
description: Run xcodebuild test, extract failing test source context, and loop until all tests pass using XcodeAutoPilot MCP tools.
triggers:
  - xtest
  - xap test
tags:
  - xcode
  - test
  - autopilot
  - fix
source: manual
---

# xap-test

Trigger with: **`xtest`** or **`xap test`**

## What it does

Runs the full test → analyze → fix loop using XcodeAutoPilot MCP tools:

1. `autopilot_test` — run tests and collect structured failures with source context
2. Analyze each failure: failing test method + related implementation code
3. `autopilot_apply_fixes` — fix the implementation (or test expectation if wrong)
4. Repeat until 0 failures or 5 iterations exhausted

## Required inputs

- `project_path` — absolute path to `.xcodeproj` or `.xcworkspace`
- `scheme` — Xcode build scheme name

## Optional inputs

- `only_testing` — run specific tests only, e.g. `["CalculatorTests/testAddition"]`
- `test_plan` — test plan name

## Tool sequence

```
autopilot_test(project_path, scheme)
  → failures > 0 → autopilot_apply_fixes(project_path, fixes[])
  → autopilot_test(project_path, scheme)
  → ... repeat up to 5x
  → report summary
```

## Notes

- Each failure includes the failing test method source + related implementation via grep
- AI decides whether to fix the implementation or the test expectation
- Use `xbuild` first if the project doesn't compile
