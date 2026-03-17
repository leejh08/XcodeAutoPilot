# XcodeAutoPilot — Development Guide

## Git Flow Strategy

```
feature/* ──→ develop ──→ release/vX.X.X ──→ main (tag + release notes)
hotfix/*  ──→ main + develop
```

### Branches
| Branch | Purpose |
|--------|---------|
| `main` | Production only. Never commit directly. |
| `develop` | Default branch. All feature PRs target here. |
| `release/vX.X.X` | Release prep. Branched from develop, merged into main + tag. |
| `feature/*` | New features. Branched from develop. |
| `fix/*` | Bug fixes. Branched from develop. |
| `hotfix/*` | Critical production fixes. Branched from main, merged into main + develop. |

### Release Flow
1. Branch `release/vX.X.X` from `develop`
2. Bump version, finalize changelog
3. PR → `main` (squash merge)
4. Tag `vX.X.X` on main → GitHub creates release notes automatically
5. Back-merge `main` → `develop`

---

## Workflow Rules

### Before every PR
1. Test on `~/XcodeAutoPilotTest` using MCP tools in Claude Code
2. Call `autopilot_build` → confirm errors detected with source context
3. Generate fixes, call `autopilot_apply_fixes` → confirm fixes applied
4. Call `autopilot_build` again → confirm 0 errors
5. Only open a PR after the full loop passes

### Issue → Branch → PR flow
1. Create a GitHub issue describing the change
2. Branch off `develop` with a descriptive name (e.g. `feat/apply-fixes-tool`, `fix/error-parser`)
3. Develop and commit with conventional commit messages
4. Test on XcodeAutoPilotTest (see above)
5. Open PR targeting `develop` — assign `leejh08`, add appropriate label, add `leejh08` as reviewer
6. User approves and merges

### Commit message format
Follow Conventional Commits:
- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance, config, tooling
- `docs:` — documentation
- `refactor:` — code restructuring without behavior change
- `test:` — tests

Always append:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Labels
Use exactly one of the five repo labels per issue/PR:
- `fix` — bug fixes
- `feature` — new features
- `chore` — maintenance
- `docs` — documentation
- `ci` — CI/CD and build pipeline

### Assignees & Reviewers
- Assignee: always `leejh08`
- Reviewer: always `leejh08`

## Architecture

### MCP Tool Pattern
MCP servers expose **tools only** — no internal LLM calls.
Claude Code handles all reasoning. The server handles build execution, context extraction, and safe file patching.

### Tool Responsibilities
| Tool | Responsibility |
|------|---------------|
| `autopilot_build` | Run xcodebuild, return structured errors + source context |
| `autopilot_apply_fixes` | Safely apply fixes from Claude Code (backup + rollback) |
| `autopilot_list_schemes` | List available Xcode schemes |
| `autopilot_clean` | Run xcodebuild clean |
| `autopilot_history` | Return session fix history |

### Fix Loop (orchestrated by Claude Code)
```
autopilot_build → analyze errors + context → autopilot_apply_fixes → autopilot_build → ... → 0 errors
```

### No API Keys in Source
- `.mcp.json` is gitignored — copy from `.mcp.json.example`
- Never commit secrets; GitHub push protection is enabled

## Build

```bash
npm install
npm run build   # tsc
npm test        # vitest
```
