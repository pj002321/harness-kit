#!/usr/bin/env node
// harness-kit completion gate. Each agent calls it from its "about to finish" hook:
//   Claude Code / Codex — Stop hook: exit 2 with the reason on stderr blocks finishing
//   Cursor (--cursor)   — stop hook: {"followup_message": reason} sends the agent back to work
// Checks come from .harness/config.json. (Claude Code stops after 8 blocks in a row, Cursor after loop_limit.)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MSG = {
  en: ['Completion gate failed — these checks must pass before you can finish.', 'Fix the cause and finish again. Never weaken or delete a test or a check to make it pass.'],
  ko: ['완료 게이트 실패 — 아래 검증이 통과해야 작업을 끝낼 수 있다.', '원인을 고친 뒤 다시 끝내라. 테스트나 검증 명령을 약화·삭제해서 통과시키지 마라.'],
  ja: ['完了ゲート失敗 — 以下のチェックが成功しないと作業を終えられない。', '原因を直してからもう一度終えること。テストやチェックを弱めたり削除したりして通さないこと。'],
};

const cursor = process.argv.includes('--cursor');
const root = process.env.CLAUDE_PROJECT_DIR || process.env.CURSOR_PROJECT_DIR
  || spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout?.trim() || process.cwd();
const pass = () => { process.stdout.write('{}'); process.exit(0); }; // Codex wants JSON on stdout when exiting 0

if (cursor) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
  if (input.status && input.status !== 'completed') pass(); // aborted / error: leave it to the human
}

const { checks = [], lang = 'en' } = JSON.parse(readFileSync(join(root, '.harness', 'config.json'), 'utf8'));
const [failed, fix] = MSG[lang] ?? MSG.en;

// Nothing changed (the agent only answered a question) → nothing to verify.
// ponytail: if the agent commits mid-session the tree looks clean and the gate skips; compare against the session's start commit if that matters.
const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (git.status === 0 && !git.stdout.trim()) pass();

const failures = [];
for (const { label, command } of checks) {
  const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', timeout: 10 * 60_000 });
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
    failures.push(`■ ${label}: \`${command}\` → ${r.error ? r.error.message : `exit ${r.status}`}\n${out}`);
  }
}
if (!failures.length) pass();

const reason = `${failed}\n\n${failures.join('\n\n')}\n\n${fix}`;
if (cursor) {
  process.stdout.write(JSON.stringify({ followup_message: reason }));
  process.exit(0);
}
process.stderr.write(reason);
process.exit(2);
