---
id: xap-spm
name: xap-spm
description: Resolve SPM dependency issues and verify the build using XcodeAutoPilot MCP tools.
triggers:
  - xspm
  - xap spm
tags:
  - xcode
  - spm
  - swift-package-manager
  - dependencies
source: manual
---

# xap-spm

Trigger with: **`xspm`** or **`xap spm`**

## What it does

Full SPM issue resolution workflow:

1. `autopilot_resolve_spm` — run `xcodebuild -resolvePackageDependencies`
2. If resolution fails → `autopilot_cache_clean(scope: "spm")` → retry resolution
3. `autopilot_build` — verify project builds after SPM is resolved
4. If build errors remain → `autopilot_apply_fixes` as needed

## Common SPM problems this handles

- Version conflicts between packages
- Clone failures (network/cache issues)
- Swift version mismatches
- Stale `Package.resolved` lock causing conflicts
- SourcePackages folder corrupted

## Required inputs

- `project_path` — absolute path to `.xcodeproj` or `.xcworkspace`
- `scheme` — Xcode build scheme name

## Tool sequence

```
autopilot_resolve_spm(project_path, scheme)
  → if failed:
      autopilot_cache_clean(project_path, scope="spm")
      autopilot_resolve_spm(project_path, scheme)  ← retry
  → autopilot_build(project_path, scheme)  ← verify
  → if build errors: autopilot_apply_fixes(...)
  → report final status
```
