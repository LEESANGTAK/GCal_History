---
description: 이 프로젝트에서 AI가 작업을 수행할 때 준수해야 하는 공통 규칙
---
# 프로젝트 공통 AI 작업 규칙 (Project AI Rules)

이 프로젝트(GCal_History)에서 코드 작업이나 분석을 수행할 때, AI(Antigravity)는 항상 최우선적으로 다음의 약속된 규칙을 준수해야 합니다. 다른 환경(컴퓨터)에서 이 프로젝트를 클론하여 작업할 때에도 이 규칙사항은 동일하게 적용됩니다.

1. **언어 설정 (Korean Language)**:
   - 모든 대화, 코드의 주석(Comments), 커밋 메시지, 그리고 생성되는 모든 마크다운 아티팩트(`implementation_plan.md`, `task.md`, `walkthrough.md` 등)의 언어는 반드시 **한국어**로 작성해야 합니다.

2. **아티팩트 영구 보존 및 백업 (Artifacts Backup)**:
   - AI 전용 로컬 시스템 폴더(예: `~/.gemini/...`)에만 저장되는 임시 아티팩트 문서들(`implementation_plan.md`, `task.md`, `walkthrough.md`)은 컴퓨터를 옮기면 유실됩니다.
   - 따라서, 새로운 기능 구현이나 디버깅 등 유의미한 작업 세션이 종료될 때마다, 반드시 **최종 작성된 아티팩트 파일들을 프로젝트 루트 디렉토리 내부의 `.ai/` 폴더로 복사(Copy)** 하여 Git 버전 관리에 포함시킬 수 있도록 조치해야 합니다.

3. **기본 동작 방식 (General Behaviors)**:
   - 기존의 구조를 최대한 존중하며, 파괴적인 변경을 할 때는 반드시 사용자에게 먼저 알리고(notify_user) 승인을 받습니다.
