# XcodeAutoPilot

Xcode 프로젝트의 빌드 에러를 자동으로 감지하고 수정하는 MCP 서버입니다.
외부 MCP 의존 없이 `xcodebuild` CLI를 직접 호출하여 빌드→에러분석→수정→재빌드 루프를 자율적으로 수행합니다.

## 아키텍처

```
[Claude Code / MCP 클라이언트]
        ↕ MCP 프로토콜 (stdio)
[XcodeAutoPilot MCP 서버]
        ↕ child_process.exec
[xcodebuild CLI]
        ↕
[Xcode 프로젝트]
```

## 요구사항

- Node.js >= 18
- Xcode (xcodebuild CLI 포함)
- Anthropic API Key

## 설치

```bash
npm install
npm run build
```

## 환경변수

```bash
# 필수
export ANTHROPIC_API_KEY="sk-ant-..."

# 선택 (기본값 있음)
export AUTOPILOT_MODEL="claude-sonnet-4-20250514"
export AUTOPILOT_MAX_ITERATIONS=5
export AUTOPILOT_BACKUP_DIR=".autofix-backup"
export AUTOPILOT_CONTEXT_LINES=50
export AUTOPILOT_FILE_SIZE_LIMIT=1048576
```

## Claude Desktop / Claude Code 등록

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xcode-autopilot": {
      "command": "node",
      "args": ["/path/to/xcode-autopilot/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## MCP 도구

### `autopilot_run` ⭐ 메인 도구

빌드→에러분석→자동수정→재빌드 루프를 자동 실행합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `project_path` | string | ✅ | .xcodeproj 또는 .xcworkspace 절대 경로 |
| `scheme` | string | ✅ | 빌드 스킴 이름 |
| `max_iterations` | number | — | 최대 수정 반복 횟수 (기본: 5, 최대: 10) |
| `configuration` | string | — | Debug / Release (기본: Debug) |
| `destination` | string | — | 빌드 대상 (자동 탐지) |
| `fix_warnings` | boolean | — | 워닝도 수정 (기본: false) |

### `autopilot_build`

빌드만 실행하고 에러/워닝 목록을 반환합니다 (수정 없음).

### `autopilot_analyze`

빌드 에러를 Claude AI로 분석만 합니다 (수정 없음, dry-run).

### `autopilot_list_schemes`

프로젝트의 사용 가능한 스킴 목록을 반환합니다.

### `autopilot_clean`

xcodebuild clean을 실행합니다.

### `autopilot_history`

현재 세션의 자동 수정 이력을 반환합니다.

## 안전장치

| 기능 | 설명 |
|------|------|
| 파일 백업 | 수정 전 `.autofix-backup/{timestamp}/`에 자동 백업 |
| 반복 제한 | 최대 10회 (기본 5회) |
| 무한루프 감지 | 동일 에러 반복 시 자동 중단 |
| 에러 증가 감지 | 에러 수 증가 시 롤백 후 중단 |
| 스코프 제한 | `project_path` 하위 파일만 수정 허용 |
| 보호 디렉토리 | `Pods/`, `.build/`, `DerivedData/`, `Carthage/`, `.git/` 수정 금지 |
| 파일 크기 제한 | 1MB 초과 파일 스킵 |
| xcodebuild 타임아웃 | 5분 초과 시 프로세스 종료 |
| 동시 실행 방지 | 같은 프로젝트에 autopilot_run 중복 실행 거부 |

## 결과 리포트

```json
{
  "status": "success",
  "summary": "12 errors → 0 errors in 3 iterations (45.2s)",
  "iterations": [
    { "iteration": 1, "errors_before": 12, "errors_after": 5, "fixes_applied": 7 },
    { "iteration": 2, "errors_before": 5,  "errors_after": 1, "fixes_applied": 4 },
    { "iteration": 3, "errors_before": 1,  "errors_after": 0, "fixes_applied": 1 }
  ],
  "all_fixes": [...],
  "remaining_errors": [],
  "backup_path": ".autofix-backup/20250303-141523/"
}
```

## 테스트

```bash
npm test
```

## 사용 예시

```
autopilot_list_schemes로 내 프로젝트 스킴 확인해줘
  project_path: /Users/me/MyApp/MyApp.xcodeproj

autopilot_run으로 빌드 에러 자동으로 고쳐줘
  project_path: /Users/me/MyApp/MyApp.xcodeproj
  scheme: MyApp
  max_iterations: 5
```

## 프로젝트 구조

```
src/
├── index.ts                   # MCP 서버 진입점
├── server.ts                  # MCP 서버 설정 + 핸들러 라우팅
├── types.ts                   # 공통 타입 정의
├── core/
│   ├── xcodebuild.ts          # xcodebuild CLI 래핑
│   ├── error-parser.ts        # 빌드 출력 파싱
│   ├── claude-fixer.ts        # Claude API 호출
│   ├── file-patcher.ts        # 파일 수정/백업/롤백
│   ├── orchestrator.ts        # 빌드-수정 루프
│   └── safety.ts              # 안전장치
└── utils/
    ├── logger.ts              # stderr 로깅
    └── context-extractor.ts   # 소스 컨텍스트 추출
```
