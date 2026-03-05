---
id: xap-shot
name: xap-shot
description: Build and run the app in a simulator, capture a screenshot, and let Claude visually verify the UI using XcodeAutoPilot MCP tools.
triggers:
  - xshot
  - xap shot
tags:
  - xcode
  - screenshot
  - vision
  - ui
source: manual
---

# xap-shot

Trigger with: **`xshot`** or **`xap shot`**

## What it does

Builds the app, launches it in a simulator, captures a screenshot, and returns it to Claude for visual UI analysis:

1. `autopilot_screenshot` — build + install + launch + screenshot
2. Claude visually analyzes the result
3. Reports whether the UI looks correct or describes any issues

## Required inputs

- `project_path` — absolute path to `.xcodeproj` or `.xcworkspace`
- `scheme` — Xcode build scheme name
- `bundle_id` — app bundle identifier (e.g. `com.example.MyApp`)

## Optional inputs

- `device_name` — simulator device name (default: `iPhone 16`)
- `launch_wait_seconds` — wait after launch before screenshot (default: `2`)

## Tool sequence

```
autopilot_screenshot(project_path, scheme, bundle_id)
  → image returned → Claude analyzes UI visually
  → report: UI looks correct / issues found
```

## Notes

- Simulator.app must be open and the device window must be visible (not minimized)
- Screenshot is saved to `<project>/.xap/screenshots/<timestamp>.png`
- Opens in macOS Preview automatically
- If build fails, run `xbuild` first to fix errors
