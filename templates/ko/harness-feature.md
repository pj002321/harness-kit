---
name: harness-feature
description: 기능 하나를 Planner → 계약 → Generator ⇄ Evaluator 루프로 구현한다. 여러 파일에 걸친 새 기능을 맡았을 때 사용.
argument-hint: [만들 기능 설명]
---

# 하네스 루프로 기능 구현: $ARGUMENTS

너는 오케스트레이터다. 직접 코드를 쓰지 않는다. 아래 순서를 그대로 따르고 단계를 건너뛰지 않는다.
먼저 기능을 나타내는 짧은 영문 kebab-case 이름(slug)을 정한다.

1. **계획**: `harness-planner` 서브에이전트에게 요청을 넘겨 스펙을 받는다. `docs/product-specs/<slug>.md`에 저장하고 `docs/product-specs/index.md`에 한 줄 추가한다.
2. **실행 계획 만들기**: `docs/exec-plans/active/<slug>.md` — 스펙 링크와 스프린트별 섹션을 둔다.
3. **스프린트마다** (n = 1, 2, …):
   1. **계약**: `harness-generator`에게 스펙과 스프린트 번호를 주고 계약을 제안받는다. 그 계약을 `harness-evaluator`에게 검토시킨다. 승인되거나 고쳐진 계약을 실행 계획의 `## 스프린트 <n> 계약` 아래에 적는다.
   2. **구현**: `harness-generator`에게 스펙 경로, 계약 전문, (있으면) 직전 판정 전문을 주고 구현하게 한다.
   3. **검증**: `harness-evaluator`에게 계약 전문을 주고 검증하게 한다. 판정을 실행 계획에 `### 판정 #<k>`로 덧붙인다.
   4. `VERDICT: PASS`면 다음 스프린트로 간다. 아니면 판정을 그대로 generator에게 넘겨 3-2부터 반복한다.
      **최대 {{maxAttempts}}회.** 넘으면 멈추고 사용자에게 실패 항목과 증거를 보고한다.
4. 단계가 끝날 때마다 `docs/exec-plans/progress.md`에 한 줄을 덧붙인다: `- <날짜> <slug> S<n> <단계> → <결과>`
{{featuresStep}}5. 모든 스프린트가 통과하면 실행 계획을 `docs/exec-plans/completed/`로 옮기고, 사용자에게 스프린트별 결과, 남은 문제, 바뀐 파일을 요약한다.

규칙:

- Evaluator의 FAIL을 네 판단으로 뒤집지 않는다.
- 구현 도중 계약을 바꾸지 않는다. 바꿔야 하면 사용자에게 묻는다.
- 서브에이전트는 이 대화를 보지 못한다. 필요한 내용(스펙 경로, 계약 전문, 판정 전문)을 매번 넘긴다.
