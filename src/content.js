// 설치되는 파일에 들어가는 문구 (언어별). 에이전트 프롬프트처럼 긴 것은 templates/<lang>/ 에 있다.
// 지식 베이스 구조는 OpenAI "Harness engineering"의 docs/ 구성, 기능 목록·진행 기록은 Anthropic
// "Effective harnesses for long-running agents"의 feature list·progress file을 따른다.

export const LANG_NAMES = { en: 'English', ko: '한국어', ja: '日本語' };

const en = {
  block: {
    map: 'Where things are', docsCheck: 'Docs links',
    mapCols: ['To learn about', 'Go to'],
    structure: 'Folders', rules: 'Working rules', checks: 'Checks', check: 'Check', command: 'Command', none: '(no checks)',
    run: 'Running the app', loop: 'Feature loop',
    loopBody: 'For features that span several files, use `/harness-feature <description>`: Planner → contract → Generator ⇄ Evaluator. Specs go to `docs/product-specs/`, contracts and verdicts to `docs/exec-plans/`.',
    gateRule: 'All checks below must pass before you finish. If any fails, the completion gate (Stop hook) blocks you from finishing.',
    noWeaken: 'Never weaken or delete a test or a check to make it pass.',
    locked: 'Blocked by permission rules', noRead: 'no read/edit', noEdit: 'no edit',
    session: 'At the start of every session',
    sessionSteps: [
      'Read `docs/exec-plans/progress.md` and `git log --oneline -20` to see what was done recently.',
      'Run the checks above once; if something is already broken, fix that first.',
      'Work on one thing at a time. When done, commit and append a line to `docs/exec-plans/progress.md`.',
    ],
    featuresRule: '`docs/features.json` is the list of required features. Only flip `passes` to `true` after verifying it end to end. Never remove or rewrite entries.',
    mapRows: {
      architecture: 'How the code is laid out and why', designDocs: 'Design decisions and core beliefs', specs: 'Product specs (what to build)',
      plans: 'Execution plans, active and completed; progress log', quality: 'Quality grade per area', reliability: 'Reliability expectations',
      security: 'Security rules', references: 'External references (llms.txt etc.)', generated: 'Generated docs (do not edit by hand)', features: 'Feature list (pass/fail)',
    },
  },
  docs: {
    architecture: (name) => `# Architecture — ${name}

<!-- What a new engineer (or agent) must understand before changing code. Keep it short; link out for detail. -->

## Overview

## Layers and dependency direction
<!-- e.g. types → config → data → service → api → ui. Which way may imports go? -->

## Key decisions
<!-- One line each, with a link to docs/design-docs/ for the reasoning. -->
`,
    designIndex: `# Design docs

| Doc | Status | Summary |
|---|---|---|
| [core-beliefs.md](core-beliefs.md) | active | Principles every change should respect |
`,
    coreBeliefs: `# Core beliefs

<!-- The few principles that settle arguments. Each should be checkable in review. Examples: -->
<!-- - Prefer boring, well-known libraries over clever ones. -->
<!-- - Validate data at the boundary; trust it inside. -->
`,
    specsIndex: `# Product specs

<!-- One line per spec. /harness-feature adds lines here automatically. -->
`,
    progress: `# Progress log

<!-- Append-only. One line per step: - <date> <what> → <result> -->
`,
    techDebt: `# Tech debt tracker

| Item | Where | Why it matters | Added |
|---|---|---|---|
`,
    quality: `# Quality score

<!-- Grade each area A–D and say why. Agents use this to know where to be careful. -->

| Area | Grade | Notes |
|---|---|---|
`,
    reliability: `# Reliability

<!-- Expectations that code must keep: timeouts, retries, error handling, what must never crash. -->
`,
    security: `# Security

<!-- Rules that are never negotiable: secret handling, input validation, auth checks, data that must not be logged. -->
`,
    references: `# References

Put external reference material here that agents should read instead of guessing — for example \`<library>-llms.txt\` files from the libraries you depend on.
`,
    generated: `# Generated

Machine-generated docs (DB schema, API surface, …). Regenerate them with a script; never edit by hand.
`,
  },
  featuresStep: '   - When the feature is complete, add an entry to `docs/features.json` and set `passes` to `true` only after the Evaluator\'s PASS.\n',
  gate: {
    failed: 'Completion gate failed — these checks must pass before you can finish.',
    fix: 'Fix the cause and finish again. Never weaken or delete a test or a check to make it pass.',
  },
  docsCheck: { broken: 'Broken links in the knowledge base', fix: 'Fix the link or create the file it points to.' },
};

const ko = {
  block: {
    map: '어디에 뭐가', docsCheck: '문서 링크',
    mapCols: ['알고 싶은 것', '가는 곳'],
    structure: '폴더', rules: '작업 규칙', checks: '검증 방법', check: '검사', command: '명령', none: '(검증 명령 없음)',
    run: '앱 실행', loop: '기능 구현 루프',
    loopBody: '여러 파일에 걸친 기능은 `/harness-feature <설명>` 으로 진행한다: Planner → 계약 → Generator ⇄ Evaluator. 스펙은 `docs/product-specs/`, 계약·판정은 `docs/exec-plans/`에 남는다.',
    gateRule: '작업을 끝내기 전에 아래 검증 명령이 모두 통과해야 한다. 실패하면 완료 게이트(Stop 훅)가 종료를 막는다.',
    noWeaken: '테스트나 검증 명령을 약화·삭제해서 통과시키지 않는다.',
    locked: '권한 규칙으로 차단된 경로', noRead: '읽기·수정 금지', noEdit: '수정 금지',
    session: '세션을 시작할 때마다',
    sessionSteps: [
      '`docs/exec-plans/progress.md`와 `git log --oneline -20`을 읽고 최근에 무엇을 했는지 파악한다.',
      '위 검증 명령을 한 번 돌린다. 이미 깨진 것이 있으면 그것부터 고친다.',
      '한 번에 하나씩 작업한다. 끝나면 커밋하고 `docs/exec-plans/progress.md`에 한 줄 덧붙인다.',
    ],
    featuresRule: '`docs/features.json`은 필요한 기능 목록이다. 끝까지 검증한 뒤에만 `passes`를 `true`로 바꾼다. 항목을 지우거나 고쳐 쓰지 않는다.',
    mapRows: {
      architecture: '코드가 어떻게 나뉘어 있고 왜 그런가', designDocs: '설계 결정과 핵심 원칙', specs: '제품 스펙 (무엇을 만드나)',
      plans: '실행 계획 (진행 중·완료), 진행 기록', quality: '영역별 품질 등급', reliability: '안정성 기준',
      security: '보안 규칙', references: '외부 참고 자료 (llms.txt 등)', generated: '자동 생성 문서 (손으로 고치지 않음)', features: '기능 목록 (통과 여부)',
    },
  },
  docs: {
    architecture: (name) => `# 아키텍처 — ${name}

<!-- 새로 온 엔지니어(또는 에이전트)가 코드를 고치기 전에 알아야 할 것. 짧게 쓰고, 자세한 건 링크로. -->

## 개요

## 레이어와 의존 방향
<!-- 예: types → config → data → service → api → ui. import는 어느 방향으로만 가능한가? -->

## 핵심 결정
<!-- 한 줄씩, 근거는 docs/design-docs/ 링크로. -->
`,
    designIndex: `# 설계 문서

| 문서 | 상태 | 요약 |
|---|---|---|
| [core-beliefs.md](core-beliefs.md) | 유효 | 모든 변경이 지켜야 할 원칙 |
`,
    coreBeliefs: `# 핵심 원칙

<!-- 논쟁을 끝내주는 몇 가지 원칙. 리뷰에서 확인 가능해야 한다. 예: -->
<!-- - 영리한 라이브러리보다 지루하고 잘 알려진 라이브러리를 쓴다. -->
<!-- - 데이터는 경계에서 검증하고, 안쪽에서는 믿는다. -->
`,
    specsIndex: `# 제품 스펙

<!-- 스펙 하나에 한 줄. /harness-feature 가 자동으로 추가한다. -->
`,
    progress: `# 진행 기록

<!-- 덧붙이기만 한다. 단계마다 한 줄: - <날짜> <무엇> → <결과> -->
`,
    techDebt: `# 기술 부채

| 항목 | 위치 | 왜 문제인가 | 추가일 |
|---|---|---|---|
`,
    quality: `# 품질 점수

<!-- 영역별로 A–D 등급과 이유. 에이전트가 어디서 조심해야 하는지 알게 한다. -->

| 영역 | 등급 | 메모 |
|---|---|---|
`,
    reliability: `# 안정성

<!-- 코드가 지켜야 할 기준: 타임아웃, 재시도, 오류 처리, 절대 죽으면 안 되는 것. -->
`,
    security: `# 보안

<!-- 타협할 수 없는 규칙: 비밀 값 취급, 입력 검증, 인증 확인, 로그에 남기면 안 되는 데이터. -->
`,
    references: `# 참고 자료

에이전트가 추측하지 않고 읽어야 할 외부 자료를 둔다. 예: 의존하는 라이브러리의 \`<library>-llms.txt\` 파일.
`,
    generated: `# 자동 생성 문서

기계가 만드는 문서(DB 스키마, API 목록 등). 스크립트로 다시 생성하고, 손으로 고치지 않는다.
`,
  },
  featuresStep: '   - 기능이 끝나면 `docs/features.json`에 항목을 추가하고, Evaluator의 PASS 이후에만 `passes`를 `true`로 둔다.\n',
  gate: {
    failed: '완료 게이트 실패 — 아래 검증이 통과해야 작업을 끝낼 수 있다.',
    fix: '원인을 고친 뒤 다시 끝내라. 테스트나 검증 명령을 약화·삭제해서 통과시키지 마라.',
  },
  docsCheck: { broken: '지식 베이스의 깨진 링크', fix: '링크를 고치거나 가리키는 파일을 만들어라.' },
};

const ja = {
  block: {
    map: 'どこに何があるか', docsCheck: 'ドキュメントのリンク',
    mapCols: ['知りたいこと', '場所'],
    structure: 'フォルダ', rules: '作業ルール', checks: 'チェック', check: 'チェック', command: 'コマンド', none: '（チェックなし）',
    run: 'アプリの起動', loop: '機能実装ループ',
    loopBody: '複数ファイルにまたがる機能は `/harness-feature <説明>` で進める: Planner → 契約 → Generator ⇄ Evaluator。仕様は `docs/product-specs/`、契約と判定は `docs/exec-plans/` に残る。',
    gateRule: '作業を終える前に、以下のチェックがすべて成功しなければならない。失敗すると完了ゲート（Stopフック）が終了を止める。',
    noWeaken: 'テストやチェックを弱めたり削除したりして通さない。',
    locked: '権限ルールでブロックされたパス', noRead: '読み取り・編集禁止', noEdit: '編集禁止',
    session: '毎セッションの開始時に',
    sessionSteps: [
      '`docs/exec-plans/progress.md` と `git log --oneline -20` を読み、最近何をしたかを把握する。',
      '上のチェックを一度実行する。すでに壊れているものがあれば先に直す。',
      '一度に1つずつ作業する。終わったらコミットし、`docs/exec-plans/progress.md` に1行追記する。',
    ],
    featuresRule: '`docs/features.json` は必要な機能のリスト。最後まで検証してから `passes` を `true` にする。項目を削除・書き換えしない。',
    mapRows: {
      architecture: 'コードの分け方とその理由', designDocs: '設計判断と基本原則', specs: 'プロダクト仕様（何を作るか）',
      plans: '実行計画（進行中・完了）、進捗ログ', quality: '領域ごとの品質評価', reliability: '信頼性の基準',
      security: 'セキュリティルール', references: '外部参考資料（llms.txt など）', generated: '自動生成ドキュメント（手で編集しない）', features: '機能リスト（合否）',
    },
  },
  docs: {
    architecture: (name) => `# アーキテクチャ — ${name}

<!-- 新しく来たエンジニア（またはエージェント）がコードを変える前に知るべきこと。短く書き、詳細はリンクで。 -->

## 概要

## レイヤーと依存の方向
<!-- 例: types → config → data → service → api → ui。importはどの方向だけ許されるか？ -->

## 主要な判断
<!-- 1行ずつ。理由は docs/design-docs/ へのリンクで。 -->
`,
    designIndex: `# 設計ドキュメント

| ドキュメント | 状態 | 要約 |
|---|---|---|
| [core-beliefs.md](core-beliefs.md) | 有効 | すべての変更が守るべき原則 |
`,
    coreBeliefs: `# 基本原則

<!-- 議論に決着をつける少数の原則。レビューで確認できること。例: -->
<!-- - 凝ったライブラリより、退屈でよく知られたライブラリを使う。 -->
<!-- - データは境界で検証し、内側では信頼する。 -->
`,
    specsIndex: `# プロダクト仕様

<!-- 仕様1つにつき1行。/harness-feature が自動で追加する。 -->
`,
    progress: `# 進捗ログ

<!-- 追記のみ。段階ごとに1行: - <日付> <何を> → <結果> -->
`,
    techDebt: `# 技術的負債

| 項目 | 場所 | なぜ問題か | 追加日 |
|---|---|---|---|
`,
    quality: `# 品質スコア

<!-- 領域ごとにA–Dの評価と理由。エージェントがどこで慎重になるべきかがわかる。 -->

| 領域 | 評価 | メモ |
|---|---|---|
`,
    reliability: `# 信頼性

<!-- コードが守るべき基準: タイムアウト、リトライ、エラー処理、絶対に落ちてはいけないもの。 -->
`,
    security: `# セキュリティ

<!-- 妥協できないルール: シークレットの扱い、入力検証、認証チェック、ログに残してはいけないデータ。 -->
`,
    references: `# 参考資料

エージェントが推測せずに読むべき外部資料を置く。例: 依存しているライブラリの \`<library>-llms.txt\` ファイル。
`,
    generated: `# 自動生成

機械が生成するドキュメント（DBスキーマ、APIの一覧など）。スクリプトで再生成し、手で編集しない。
`,
  },
  featuresStep: '   - 機能が完成したら `docs/features.json` に項目を追加し、EvaluatorのPASSの後でのみ `passes` を `true` にする。\n',
  gate: {
    failed: '完了ゲート失敗 — 以下のチェックが成功しないと作業を終えられない。',
    fix: '原因を直してからもう一度終えること。テストやチェックを弱めたり削除したりして通さないこと。',
  },
  docsCheck: { broken: 'ナレッジベースのリンク切れ', fix: 'リンクを直すか、リンク先のファイルを作成すること。' },
};

export const CONTENT = { en, ko, ja };
