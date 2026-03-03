---
name: xcode-autopilot
description: XcodeAutoPilot MCP 서버 개발 — xcodebuild CLI를 직접 래핑하는 독립형 MCP 서버 구현
---

# XcodeAutoPilot MCP 서버 개발

Xcode 프로젝트의 빌드 에러를 자동으로 감지하고 수정하는 MCP 서버를 TypeScript로 구현합니다.
외부 MCP 의존 없이 `xcodebuild` CLI를 직접 호출합니다.

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

## 기술 스택

- Runtime: Node.js (>=18)
- Language: TypeScript (strict mode)
- MCP SDK: @modelcontextprotocol/sdk (최신)
- LLM: Claude API (@anthropic-ai/sdk), 모델: claude-sonnet-4-20250514
- 전송: stdio

## 구현 단계 (순서대로 진행)

### Phase 1: 프로젝트 기반 설정
- package.json (type: module, 모든 dependency 포함)
- tsconfig.json (strict, ES2022, NodeNext)
- src/types.ts (공통 타입 정의)
- src/utils/logger.ts (stderr 로깅)

### Phase 2: 핵심 빌드 엔진
- src/core/xcodebuild.ts — xcodebuild CLI 래핑
- src/core/error-parser.ts — 빌드 출력 파싱
- src/utils/context-extractor.ts — 소스 컨텍스트 추출

### Phase 3: 수정 엔진
- src/core/claude-fixer.ts — Claude API 호출
- src/core/file-patcher.ts — 파일 수정/백업/롤백
- src/core/safety.ts — 안전장치

### Phase 4: 오케스트레이터 & MCP 도구
- src/core/orchestrator.ts — 빌드-수정 루프
- src/tools/ — 6개 MCP 도구 구현
- src/server.ts + src/index.ts — MCP 서버

### Phase 5: 테스트 & 문서
- tests/ — vitest 유닛 테스트
- README.md

## MCP 도구 목록

1. **autopilot_run** — 빌드→에러분석→자동수정→재빌드 루프 (메인)
2. **autopilot_build** — 빌드 실행 + 에러 목록 반환
3. **autopilot_analyze** — 에러 분석만 (dry-run)
4. **autopilot_list_schemes** — 스킴 목록 조회
5. **autopilot_clean** — 빌드 클린
6. **autopilot_history** — 수정 이력 조회

## 안전장치 (필수 구현)

- 파일 백업: `.autofix-backup/{timestamp}/`
- iteration 하드리밋: max 10
- 무한 루프 감지: 동일 에러 반복 시 중단
- 에러 증가 감지: 증가 시 롤백 후 중단
- 스코프 제한: project_path 하위만 수정
- 보호 디렉토리: Pods/, .build/, DerivedData/, Carthage/, .git/ 수정 금지
- 파일 크기 제한: 1MB 초과 스킵
- xcodebuild 타임아웃: 5분
- 동시 실행 방지

## Claude API 에러 수정 프롬프트 (시스템)

You are an expert iOS/macOS Swift developer and Xcode build error specialist.

Rules:
1. MINIMUM change needed to fix each error.
2. Do NOT refactor, rename, or change unrelated code.
3. Preserve original code style, indentation, and conventions.
4. Respond with ONLY valid JSON.

Response format:
```json
{
  "fixes": [
    {
      "file_path": "/absolute/path/to/file.swift",
      "line_number": 42,
      "original_line": "    let x: Int = someString",
      "fixed_line": "    let x: Int = Int(someString) ?? 0",
      "explanation": "..."
    }
  ],
  "unfixable": [...]
}
```

## 환경변수

```bash
ANTHROPIC_API_KEY=sk-ant-...               # 필수
AUTOPILOT_MODEL=claude-sonnet-4-20250514   # 선택
AUTOPILOT_MAX_ITERATIONS=5                  # 선택
AUTOPILOT_BACKUP_DIR=.autofix-backup        # 선택
AUTOPILOT_CONTEXT_LINES=50                  # 선택
AUTOPILOT_FILE_SIZE_LIMIT=1048576           # 선택
```

## 실행 지침

이 스킬이 호출되면 ultrawork 방식으로 Phase 1부터 순서대로 구현합니다.
각 Phase를 완료한 후 다음 Phase로 진행합니다.
모든 파일을 완전하게 구현합니다 (TODO, placeholder, stub 금지).
