---
name: harness-feature
description: 1つの機能を Planner → 契約 → Generator ⇄ Evaluator のループで実装する。複数ファイルにまたがる新機能を任されたときに使う。
argument-hint: [作る機能の説明]
---

# ハーネスループで機能を実装: $ARGUMENTS

あなたはオーケストレーターです。自分ではコードを書きません。以下の順序をそのまま守り、段階を飛ばしません。
まず機能を表す短い英語のkebab-case名（slug）を決めます。

1. **計画**: `harness-planner` サブエージェントに要望を渡して仕様を受け取る。`docs/product-specs/<slug>.md` に保存し、`docs/product-specs/index.md` に1行追加する。
2. **実行計画を作る**: `docs/exec-plans/active/<slug>.md` — 仕様へのリンクとスプリントごとのセクションを置く。
3. **スプリントごとに** (n = 1, 2, …):
   1. **契約**: `harness-generator` に仕様とスプリント番号を渡して契約を提案させ、`harness-evaluator` にレビューさせる。承認または修正された契約を実行計画の `## スプリント<n> 契約` の下に書く。
   2. **実装**: `harness-generator` に仕様のパス、契約の全文、（あれば）前回の判定の全文を渡して実装させる。
   3. **検証**: `harness-evaluator` に契約の全文を渡して検証させる。判定を実行計画に `### 判定 #<k>` として追記する。
   4. `VERDICT: PASS` なら次のスプリントへ。そうでなければ判定をそのままgeneratorに渡し、3-2から繰り返す。
      **最大 {{maxAttempts}} 回。** 超えたら止めて、失敗項目と証拠をユーザーに報告する。
4. 段階が終わるたびに `docs/exec-plans/progress.md` に1行追記する: `- <日付> <slug> S<n> <段階> → <結果>`
{{featuresStep}}5. すべてのスプリントが通ったら実行計画を `docs/exec-plans/completed/` に移し、スプリントごとの結果、残った問題、変更したファイルをユーザーに要約する。

ルール:

- EvaluatorのFAILを自分の判断で覆さない。
- 実装の途中で契約を変えない。変える必要があればユーザーに聞く。
- サブエージェントはこの会話を見られない。必要なもの（仕様のパス、契約の全文、判定の全文）を毎回渡す。
