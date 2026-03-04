---
id: xap-clean
name: xap-clean
description: Clear Xcode caches (DerivedData, ModuleCache, SPM, Index) and verify the project still builds.
triggers:
  - xclean
  - xap clean
tags:
  - xcode
  - cache
  - clean
  - derived-data
source: manual
---

# xap-clean

Trigger with: **`xclean`** or **`xap clean`**

## What it does

Clears Xcode caches that `xcodebuild clean` doesn't touch, then verifies the build:

1. `autopilot_cache_clean` — remove selected cache scope
2. `autopilot_build` — confirm project builds after cleaning

## Scope options

| scope | Clears |
|-------|--------|
| `project` | `DerivedData/<ProjectName>-*` (default) |
| `module_cache` | `DerivedData/ModuleCache.noindex` |
| `spm` | `Caches/org.swift.swiftpm` + `SourcePackages` |
| `index` | `DerivedData/.../Index.noindex` |
| `all` | Everything above |

**Default scope:** `project` (safest, fastest rebuild)

## When to use each scope

- Unexplained build failures → `project`
- "Module not found" after renaming → `module_cache`
- SPM packages broken/stale → `spm`
- Indexing broken or slow → `index`
- Everything is broken → `all`

## Required inputs

- `project_path` — absolute path to `.xcodeproj` or `.xcworkspace`
- `scheme` — needed for the verification build
