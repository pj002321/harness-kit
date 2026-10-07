#!/usr/bin/env node
// harness-kit completion gate (Stop hook).
// When the AI tries to finish, run the checks in .claude/harness.json. If any fails, exit 2 to block finishing and
// hand the failure output back to the AI — it has to fix things and finish again. (Claude Code stops on its own after 8 blocks in a row.)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MSG = {
  en: ['Completion gate failed — these checks must pass before you can finish.', 'Fix the cause and finish again. Never weaken or delete a test or a check to make it pass.'],
  ko: ['완료 게이트 실패 — 아래 검증이 통과해야 작업을 끝낼 수 있다.', '원인을 고친 뒤 다시 끝내라. 테스트나 검증 명령을 약화·삭제해서 통과시키지 마라.'],
  ja: ['完了ゲート失敗 — 以下のチェックが成功しないと作業を終えられない。', '原因を直してからもう一度終えること。テストやチェックを弱めたり削除したりして通さないこと。'],
};

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const { checks = [], lang = 'en' } = JSON.parse(readFileSync(join(root, '.claude', 'harness.json'), 'utf8'));
const [failed, fix] = MSG[lang] ?? MSG.en;

// Nothing changed (the AI only answered a question) → nothing to verify.
// ponytail: if the AI commits mid-session the tree looks clean and the gate skips; compare against the session's start commit if that matters.
const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (git.status === 0 && !git.stdout.trim()) process.exit(0);

const failures = [];
for (const { label, command } of checks) {
  const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', timeout: 10 * 60_000 });
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
    failures.push(`■ ${label}: \`${command}\` → ${r.error ? r.error.message : `exit ${r.status}`}\n${out}`);
  }
}
if (!failures.length) process.exit(0);

process.stderr.write(`${failed}\n\n${failures.join('\n\n')}\n\n${fix}`);
process.exit(2);
