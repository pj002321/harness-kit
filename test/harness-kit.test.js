import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { detect } from '../src/detect.js';
import { plan, install } from '../src/generate.js';
import { startServer } from '../src/server.js';
import { brokenLinks } from '../templates/harness/check-docs.mjs';
import { decide, globToRe } from '../templates/harness/guard.mjs';
import { I18N } from '../ui/i18n.js';

const project = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    if (!p.endsWith('/')) writeFileSync(join(dir, p), c);
    else mkdirSync(join(dir, p), { recursive: true });
  }
  return dir;
};
const answers = (over = {}) => ({
  name: 'demo', summary: '데모', dirs: [{ name: 'src', note: '코드' }], rules: ['한국어로 커밋'],
  checks: [{ label: '테스트', command: 'node -e "process.exit(0)"' }], run: { command: 'npm run dev', url: 'http://localhost:5173' },
  noRead: ['.env'], noEdit: ['migrations/**'], denyCommands: ['git push --force*'], gate: true, loop: true, maxAttempts: 3, lang: 'ko', kb: false, agents: ['claude'], ...over,
});
const write = (dir, a) => install(dir, plan(dir, a));
const read = (dir, p) => readFileSync(join(dir, p), 'utf8');

test('detect: node 프로젝트의 검증·실행 명령과 보호 경로를 추정한다', () => {
  const dir = project({
    'package.json': JSON.stringify({ name: 'shop', description: '쇼핑몰', scripts: { test: 'echo "Error: no test specified" && exit 1', lint: 'eslint .', dev: 'vite' } }),
    'tsconfig.json': '{}', 'pnpm-lock.yaml': '', 'src/': '', 'node_modules/': '', 'prisma/migrations/': '',
  });
  const d = detect(dir);
  assert.equal(d.name, 'shop');
  assert.deepEqual(d.checks, [{ kind: 'lint', command: 'pnpm lint' }, { kind: 'types', command: 'npx tsc --noEmit' }]); // npm 기본 test 스크립트는 제외
  assert.deepEqual(d.run, { command: 'pnpm dev', url: 'http://localhost:5173' });
  assert.deepEqual(d.dirs.map((x) => [x.name, x.role]), [['prisma', 'db'], ['src', 'source']]);
  assert.equal(d.ruleHints[0], 'noAny'); // TS 프로젝트면 TS 규칙을 먼저 제안
  assert.ok(d.protect.includes('prisma/migrations/**') && d.protect.includes('pnpm-lock.yaml') && d.protect.includes('.env'));
});

test('detect: python / go', () => {
  assert.deepEqual(detect(project({ 'pyproject.toml': 'name = "x"\n[tool.ruff]\n', 'tests/': '' })).checks.map((c) => c.command), ['pytest', 'ruff check .']);
  assert.deepEqual(detect(project({ 'go.mod': 'module x' })).checks.map((c) => c.command), ['go test ./...', 'go vet ./...']);
});

test('plan: 빈 프로젝트에 전부 새로 만들고, 다시 돌리면 바뀌는 것이 없다', () => {
  const dir = project({});
  const files = plan(dir, answers());
  assert.ok(files.every((f) => f.status === 'new'));
  assert.deepEqual(files.map((f) => f.path).sort(), [
    '.claude/agents/harness-evaluator.md', '.claude/agents/harness-generator.md', '.claude/agents/harness-planner.md',
    '.claude/settings.json', '.claude/skills/harness-feature/SKILL.md', '.harness/config.json', '.harness/gate.mjs',
    'AGENTS.md', 'CLAUDE.md', 'docs/exec-plans/active/.gitkeep', 'docs/exec-plans/completed/.gitkeep', 'docs/exec-plans/progress.md',
    'docs/product-specs/index.md',
  ]);
  install(dir, files);
  assert.ok(plan(dir, answers()).every((f) => f.status === 'same'));
  assert.match(read(dir, '.claude/skills/harness-feature/SKILL.md'), /최대 3회/);
  assert.match(read(dir, '.claude/agents/harness-evaluator.md'), /npm run dev/);
  assert.doesNotMatch(read(dir, '.claude/agents/harness-evaluator.md'), /\{\{/);
});

test('plan: 기존 AGENTS.md·CLAUDE.md·settings.json의 사용자 내용은 보존한다', () => {
  const dir = project({
    'AGENTS.md': '# 우리 팀 문서\n손으로 쓴 내용\n',
    'CLAUDE.md': '개인 규칙\n',
    '.claude/settings.json': JSON.stringify({ model: 'opus', permissions: { deny: ['Bash(curl *)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }),
  });
  write(dir, answers());
  const agents = read(dir, 'AGENTS.md');
  assert.ok(agents.startsWith('# 우리 팀 문서\n손으로 쓴 내용'));
  assert.match(agents, /harness-kit:start[\s\S]*npm run dev[\s\S]*harness-kit:end/);
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n\n개인 규칙\n');
  const s = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(s.model, 'opus');
  assert.equal(s.hooks.Stop.length, 2);
  assert.ok(s.permissions.deny.includes('Bash(curl *)') && s.permissions.deny.includes('Read(.env)') && s.permissions.deny.includes('Edit(/migrations/**)'));

  // 다시 실행: 규칙을 빼면 우리가 넣은 것만 빠지고, 블록은 중복되지 않는다
  write(dir, answers({ noEdit: [], gate: false }));
  const s2 = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(s2.hooks.Stop, [{ hooks: [{ type: 'command', command: 'echo mine' }] }]);
  assert.ok(s2.permissions.deny.includes('Bash(curl *)') && !s2.permissions.deny.includes('Edit(/migrations/**)'));
  assert.equal(read(dir, 'AGENTS.md').match(/harness-kit:start/g).length, 1);
  assert.equal(read(dir, 'CLAUDE.md').match(/@AGENTS\.md/g).length, 1);
});

test('완료 게이트: 검사가 실패하면 exit 2로 종료를 막고, 바뀐 게 없으면 통과', () => {
  const dir = project({ 'a.txt': '1' });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const gate = () => spawnSync(process.execPath, [join(dir, '.harness/gate.mjs')], { input: '{"stop_hook_active":false}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

  write(dir, answers({ checks: [{ label: '단위 테스트', command: 'node -e "console.log(\'boom\'); process.exit(3)"' }] }));
  const r = gate();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /단위 테스트[\s\S]*exit 3[\s\S]*boom/);

  write(dir, answers());
  assert.equal(gate().status, 0);

  write(dir, answers({ checks: [{ label: 'x', command: 'node -e "process.exit(1)"' }] }));
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: dir });
  assert.equal(gate().status, 0); // 작업 트리가 깨끗하면 검사 생략
});

test('server: 토큰·Host 없이는 API를 쓸 수 없다', async () => {
  const dir = project({ 'package.json': '{"name":"p"}' });
  const { server, token, url } = await startServer({ dir });
  const base = new URL(url).origin;
  try {
    assert.equal((await fetch(`${base}/api/state`)).status, 403);
    assert.equal((await fetch(`${base}/api/run`, { method: 'POST', body: '{"command":"echo hi"}' })).status, 403);
    // DNS 리바인딩: 토큰이 있어도 Host가 localhost가 아니면 거절 (fetch는 Host를 못 바꿔서 http.request로)
    const rebind = await new Promise((r) => request(`${base}/api/state`, { headers: { 'x-harness-token': token, host: 'evil.com' } }, (res) => r(res.statusCode)).end());
    assert.equal(rebind, 403);
    const ok = await fetch(`${base}/api/state`, { headers: { 'x-harness-token': token } });
    assert.equal((await ok.json()).detected.name, 'p');
    const run = await (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'x-harness-token': token }, body: JSON.stringify({ command: 'node -e "console.log(42)"' }) })).json();
    assert.equal(run.code, 0);
    assert.match(run.output, /42/);
  } finally {
    server.close();
  }
});

test('plan: 지식 베이스 — 없는 문서만 만들고, 링크 검사를 게이트에 붙이고, 기존 아키텍처 문서를 지도에 연결', () => {
  const dir = project({ 'docs/architecture.md': '# mine\n', 'docs/SECURITY.md': 'my rules\n' });
  const files = plan(dir, answers({ kb: true, features: true, lang: 'en' }));
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.ok(!by['ARCHITECTURE.md']);                                   // 이미 있는 docs/architecture.md를 쓴다
  assert.equal(by['docs/SECURITY.md'].status, 'same');                 // 사용자 문서는 그대로
  assert.equal(by['docs/SECURITY.md'].content, 'my rules\n');
  for (const p of ['docs/design-docs/core-beliefs.md', 'docs/QUALITY_SCORE.md', 'docs/features.json', '.harness/check-docs.mjs']) assert.equal(by[p].status, 'new', p);
  assert.match(by['AGENTS.md'].content, /\[docs\/architecture\.md\]\(docs\/architecture\.md\)/);
  assert.match(by['AGENTS.md'].content, /At the start of every session/);
  assert.match(by['.claude/skills/harness-feature/SKILL.md'].content, /docs\/features\.json/);
  assert.ok(JSON.parse(by['.harness/config.json'].content).checks.some((c) => c.command === 'node .harness/check-docs.mjs'));
  // 설치 직후 상태 기준으로 깨진 링크가 없어야 한다
  assert.deepEqual(brokenLinks(dir, Object.fromEntries(files.filter((f) => f.status === 'new' || f.status === 'update').map((f) => [f.path, f.content]))), []);
});

test('check-docs: 깨진 상대 링크만 잡는다 (코드·URL·앵커 제외)', () => {
  const dir = project({ 'AGENTS.md': '[ok](docs/a.md) [bad](docs/nope.md) [web](https://x.y) [anchor](#top) `[code](x.md)`\n', 'docs/a.md': '[up](../AGENTS.md) [b](b.md#sec)\n' });
  assert.deepEqual(brokenLinks(dir), ['AGENTS.md → docs/nope.md', 'docs/a.md → b.md#sec']);
});

test('plan: 언어 — 생성 파일이 고른 언어로 나오고, 옛 버전의 관리 블록을 교체한다', () => {
  const old = '# x\n\n<!-- harness-kit:start — 이 블록은 npx harness-kit 이 관리한다. 바꾸려면 마법사를 다시 실행하라. -->\nold\n<!-- harness-kit:end -->\n';
  for (const [lang, word] of [['en', 'Working rules'], ['ko', '작업 규칙'], ['ja', '作業ルール']]) {
    const dir = project({ 'AGENTS.md': old });
    write(dir, answers({ lang }));
    const agents = read(dir, 'AGENTS.md');
    assert.match(agents, new RegExp(word));
    assert.equal(agents.match(/harness-kit:start/g).length, 1);
    assert.doesNotMatch(agents, /\nold\n/);
    assert.doesNotMatch(read(dir, '.claude/agents/harness-evaluator.md'), /\{\{/);
  }
});

test('i18n: 세 언어의 UI 문구 키가 같다', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(I18N.ko), keys(I18N.en));
  assert.deepEqual(keys(I18N.ja), keys(I18N.en));
});

test('guard: Codex·Cursor 입력에서 보호 경로·금지 명령을 막는다', () => {
  const cfg = { noRead: ['.env', '.env.*'], noEdit: ['migrations/**'], denyCommands: ['git push --force*', 'rm -rf *'] };
  const root = '/repo';
  const codexBash = (command) => decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }, cfg, root);
  const patch = (body) => decide({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch` } }, cfg, root);
  assert.equal(codexBash('npm test'), null);
  assert.deepEqual(codexBash('npm test && git push --force origin main'), ['git push --force origin main', 'git push --force*']);
  assert.equal(codexBash('cat config/.env.local')[1], '.env.*');            // 읽기 금지 파일을 이름으로 언급
  assert.equal(patch('*** Update File: src/app.js'), null);
  assert.equal(patch('*** Add File: migrations/002.sql')[1], 'migrations/**');
  assert.equal(patch('*** Update File: .harness/config.json')[1], '.harness/**'); // 하네스 자기 보호
  assert.equal(patch('*** Update File: src/migrations/x.sql'), null);          // 루트 기준 고정
  assert.equal(decide({ hook_event_name: 'beforeReadFile', file_path: '/repo/app/.env' }, cfg, root)[1], '.env');
  assert.equal(decide({ hook_event_name: 'beforeReadFile', file_path: '/repo/README.md' }, cfg, root), null);
  assert.ok(globToRe('.env').test('a/b/.env') && !globToRe('.env').test('a/.envrc'));
});

test('게이트: Cursor 형식은 종료를 막는 대신 followup_message로 다시 일하게 한다', () => {
  const dir = project({ 'a.txt': '1' });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  write(dir, answers({ agents: ['cursor'], checks: [{ label: 'T', command: 'node -e "process.exit(1)"' }] }));
  const run = (input) => spawnSync(process.execPath, [join(dir, '.harness/gate.mjs'), '--cursor'], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', CURSOR_PROJECT_DIR: dir } });
  const r = run('{"status":"completed","loop_count":0}');
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).followup_message, /T: `node -e/);
  assert.deepEqual(JSON.parse(run('{"status":"aborted"}').stdout), {}); // 사용자가 멈춘 건 건드리지 않는다
});

test('plan: Codex·Cursor 선택 시 각 도구 형식으로 연결 파일을 만든다', () => {
  const dir = project({ '.codex/config.toml': 'model = "x"\n', '.cursor/hooks.json': JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: 'fmt.sh' }] } }) });
  const files = plan(dir, answers({ agents: ['codex', 'cursor'], lang: 'en' }));
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.ok(!by['.claude/settings.json'] && !by['CLAUDE.md']);           // Claude를 안 고르면 Claude 파일도 없다
  const codex = JSON.parse(by['.codex/hooks.json'].content).hooks;
  assert.match(codex.Stop[0].hooks[0].command, /\.harness\/gate\.mjs/);
  assert.equal(codex.PreToolUse[0].matcher, '^(Bash|apply_patch)$');
  assert.equal(by['.codex/config.toml'].content, 'model = "x"\n\n[features]\ncodex_hooks = true\n');
  const ev = by['.codex/agents/harness-evaluator.toml'].content;
  assert.match(ev, /^name = "harness-evaluator"$/m);
  assert.match(ev, /^sandbox_mode = "read-only"$/m);
  assert.doesNotMatch(by['.codex/agents/harness-generator.toml'].content, /sandbox_mode/);
  assert.ok(by['.agents/skills/harness-feature/SKILL.md']);
  const cur = JSON.parse(by['.cursor/hooks.json'].content).hooks;
  assert.deepEqual(cur.afterFileEdit, [{ command: 'fmt.sh' }]);           // 사용자 훅 보존
  assert.equal(cur.stop[0].command, 'node .harness/gate.mjs --cursor');
  const m = new RegExp(cur.beforeShellExecution[0].matcher);            // 금지 명령에만 걸린다
  assert.ok(m.test('git push --force origin') && !m.test('git status'));
  assert.ok(by['.cursor/agents/harness-evaluator.md'].content.includes('readonly: true'));
  assert.doesNotMatch(by['.cursor/commands/harness-feature.md'].content, /^---|\$ARGUMENTS/);
});

test('plan: 예전 버전 설치를 정리하고, 해제한 에이전트에서 우리 항목만 걷어낸다', () => {
  const dir = project({
    '.claude/harness.json': JSON.stringify({ managedDeny: ['Read(.env)', 'Edit(/.claude/harness.json)'] }),
    '.claude/hooks/verify-gate.mjs': 'old', '.claude/hooks/my-own.sh': 'mine',
    '.claude/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/verify-gate.mjs'] }] }] }, permissions: { deny: ['Read(.env)', 'Edit(/.claude/harness.json)', 'Bash(curl *)'] } }),
  });
  write(dir, answers({ agents: ['claude', 'codex'] }));
  assert.ok(!existsSync(join(dir, '.claude/harness.json')) && !existsSync(join(dir, '.claude/hooks/verify-gate.mjs')));
  assert.ok(existsSync(join(dir, '.claude/hooks/my-own.sh')));
  const s = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(s.hooks.Stop.length, 1);
  assert.match(s.hooks.Stop[0].hooks[0].args[0], /\.harness\/gate\.mjs/);
  assert.ok(s.permissions.deny.includes('Bash(curl *)') && !s.permissions.deny.includes('Edit(/.claude/harness.json)'));

  // Codex 해제 → .codex/hooks.json에서 우리 항목이 빠지고, Codex 전용 파일은 지워진다
  write(dir, answers({ agents: ['claude'] }));
  assert.equal(read(dir, '.codex/hooks.json'), '{}\n');
  assert.ok(!existsSync(join(dir, '.codex/agents/harness-evaluator.toml')) && !existsSync(join(dir, '.agents/skills/harness-feature/SKILL.md')));
  assert.ok(existsSync(join(dir, '.claude/agents/harness-evaluator.md')));
});
