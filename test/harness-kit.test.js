import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { detect } from '../src/detect.js';
import { plan, install } from '../src/generate.js';
import { startServer } from '../src/server.js';
import { brokenLinks } from '../templates/check-docs.mjs';
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
  noRead: ['.env'], noEdit: ['migrations/**'], denyCommands: ['git push --force*'], gate: true, loop: true, maxAttempts: 3, lang: 'ko', kb: false, ...over,
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
    '.claude/harness.json', '.claude/hooks/verify-gate.mjs', '.claude/settings.json', '.claude/skills/harness-feature/SKILL.md',
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
  const gate = () => spawnSync(process.execPath, [join(dir, '.claude/hooks/verify-gate.mjs')], { input: '{"stop_hook_active":false}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

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
  for (const p of ['docs/design-docs/core-beliefs.md', 'docs/QUALITY_SCORE.md', 'docs/features.json', '.claude/hooks/check-docs.mjs']) assert.equal(by[p].status, 'new', p);
  assert.match(by['AGENTS.md'].content, /\[docs\/architecture\.md\]\(docs\/architecture\.md\)/);
  assert.match(by['AGENTS.md'].content, /At the start of every session/);
  assert.match(by['.claude/skills/harness-feature/SKILL.md'].content, /docs\/features\.json/);
  assert.ok(JSON.parse(by['.claude/harness.json'].content).checks.some((c) => c.command === 'node .claude/hooks/check-docs.mjs'));
  // 설치 직후 상태 기준으로 깨진 링크가 없어야 한다
  assert.deepEqual(brokenLinks(dir, Object.fromEntries(files.filter((f) => f.status !== 'same').map((f) => [f.path, f.content]))), []);
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
