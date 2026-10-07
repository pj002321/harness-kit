#!/usr/bin/env node
// harness-kit 완료 게이트 (Stop 훅).
// AI가 작업을 끝내려 할 때 .claude/harness.json 의 검증 명령을 돌린다. 하나라도 실패하면 exit 2 로 종료를 막고,
// 실패 출력을 AI에게 돌려준다 → AI는 고치고 다시 끝내야 한다. (Claude Code는 연속 8번 막히면 스스로 멈춘다)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const { checks = [] } = JSON.parse(readFileSync(join(root, '.claude', 'harness.json'), 'utf8'));

// 바뀐 파일이 없으면(질문에 답만 한 경우) 검사할 것이 없다.
// ponytail: 세션 중에 커밋까지 해버리면 깨끗한 상태로 보여 건너뛴다. 문제되면 세션 시작 커밋과 비교하도록.
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

process.stderr.write(
  `완료 게이트 실패 — 아래 검증이 통과해야 작업을 끝낼 수 있다.\n\n${failures.join('\n\n')}\n\n` +
  `원인을 고친 뒤 다시 끝내라. 테스트나 검증 명령을 약화·삭제해서 통과시키지 마라.`,
);
process.exit(2);
