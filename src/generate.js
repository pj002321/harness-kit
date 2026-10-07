// 마법사 답변 → 설치할 파일 목록. AI를 쓰지 않는다: 같은 답이면 항상 같은 결과.
// 기존 파일은 덮어쓰지 않고 병합한다 (AGENTS.md/CLAUDE.md는 관리 블록만 교체, settings.json은 우리 항목만 교체).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const TEMPLATES = new URL('../templates/', import.meta.url);
const tpl = (name) => readFileSync(new URL(name, TEMPLATES), 'utf8');
const fill = (s, vars) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

const START = '<!-- harness-kit:start — 이 블록은 npx harness-kit 이 관리한다. 바꾸려면 마법사를 다시 실행하라. -->';
const END = '<!-- harness-kit:end -->';
const GATE = '.claude/hooks/verify-gate.mjs';

// answers 예시는 test/generate.test.js 참고
export const DEFAULTS = {
  name: '', summary: '', dirs: [], rules: [],
  checks: [], run: { command: '', url: '' },
  noRead: [], noEdit: [], denyCommands: [],
  gate: true, loop: true, maxAttempts: 3,
};

// 프로젝트 루트 기준으로 고정. 슬래시 없는 이름(.env)은 gitignore처럼 어느 깊이든 매칭되게 그대로 둔다.
const anchor = (p) => (p.includes('/') && !p.startsWith('/') ? `/${p}` : p);

export function denyRules(a) {
  return [
    ...a.noRead.map((p) => `Read(${anchor(p)})`),   // 읽기 금지는 수정도 막는다
    ...a.noEdit.map((p) => `Edit(${anchor(p)})`),
    ...a.denyCommands.map((c) => `Bash(${c})`),
    // 하네스가 자기 자신을 지킨다: AI가 게이트 설정을 고쳐 검사를 건너뛰지 못하게
    ...(a.gate ? ['Edit(/.claude/harness.json)', 'Edit(/.claude/hooks/**)', 'Edit(/.claude/settings.json)'] : []),
  ];
}

const list = (items, empty = '- (없음)') => (items.length ? items.join('\n') : empty);

function agentsBlock(a) {
  const rules = [
    ...a.rules.filter(Boolean).map((r) => `- ${r}`),
    ...(a.gate ? ['- 작업을 끝내기 전에 아래 검증 명령이 모두 통과해야 한다. 실패하면 완료 게이트(Stop 훅)가 종료를 막는다.'] : []),
    '- 테스트나 검증 명령을 약화·삭제해서 통과시키지 않는다.',
  ];
  const locked = [...a.noRead.map((p) => `\`${p}\` (읽기·수정 금지)`), ...a.noEdit.map((p) => `\`${p}\` (수정 금지)`)];
  return [
    START,
    '## 구조',
    list(a.dirs.filter((d) => d.name).map((d) => `- \`${d.name}/\`${d.note ? ` — ${d.note}` : ''}`)),
    '',
    '## 작업 규칙',
    rules.join('\n'),
    ...(locked.length ? ['', '권한 규칙으로 차단된 경로: ' + locked.join(', ')] : []),
    '',
    '## 검증 방법',
    a.checks.length ? ['| 검사 | 명령 |', '|---|---|', ...a.checks.map((c) => `| ${c.label} | \`${c.command}\` |`)].join('\n') : '(검증 명령 없음)',
    ...(a.run.command ? ['', '## 앱 실행', `\`${a.run.command}\`${a.run.url ? ` → ${a.run.url}` : ''}`] : []),
    ...(a.loop ? ['', '## 기능 구현 루프', '여러 파일에 걸친 기능은 `/harness-feature <설명>` 으로 진행한다: Planner → 계약 → Generator ⇄ Evaluator. 스펙·계약·판정·진행 기록은 `docs/harness/`에 남는다.'] : []),
    END,
  ].join('\n');
}

// 관리 블록이 있으면 교체, 없으면 끝에 덧붙임
function withBlock(existing, block) {
  if (existing == null) return null;
  const i = existing.indexOf(START), j = existing.indexOf(END);
  if (i !== -1 && j > i) return existing.slice(0, i) + block + existing.slice(j + END.length);
  return `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
}

function mergeSettings(existing, a, previousDeny) {
  const s = existing ? JSON.parse(existing) : {};
  // 우리가 넣었던 Stop 훅과 deny 규칙만 걷어내고 새로 넣는다. 사용자가 직접 넣은 항목은 건드리지 않는다.
  const stop = (s.hooks?.Stop ?? []).filter((g) => !JSON.stringify(g).includes('verify-gate.mjs'));
  if (a.gate) {
    stop.push({ hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/${GATE}`], timeout: 900, statusMessage: '완료 게이트: 검증 명령 실행 중' }] });
  }
  s.hooks = { ...s.hooks, Stop: stop };
  if (!stop.length) delete s.hooks.Stop;
  if (!Object.keys(s.hooks).length) delete s.hooks;

  const keep = (s.permissions?.deny ?? []).filter((r) => !previousDeny.includes(r));
  const deny = [...new Set([...keep, ...denyRules(a)])];
  s.permissions = { ...s.permissions, deny };
  if (!deny.length) delete s.permissions.deny;
  if (!Object.keys(s.permissions).length) delete s.permissions;
  return JSON.stringify(s, null, 2) + '\n';
}

// → [{ path, status: 'new' | 'update' | 'same', content }]
export function plan(dir, input) {
  const a = { ...DEFAULTS, ...input, run: { ...DEFAULTS.run, ...input.run } };
  a.checks = a.checks.filter((c) => c.command);
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  const previous = JSON.parse(read('.claude/harness.json') ?? '{}');
  const checksList = a.checks.length ? a.checks.map((c) => `  - ${c.label}: \`${c.command}\``).join('\n') : '  - (없음)';
  const vars = { checksList, runCommand: a.run.command || '(없음)', runUrl: a.run.url || '(없음)', maxAttempts: String(a.maxAttempts) };

  const block = agentsBlock(a);
  const claudeMd = read('CLAUDE.md');
  const files = {
    '.claude/harness.json': JSON.stringify({ version: 1, ...a, managedDeny: denyRules(a) }, null, 2) + '\n',
    'AGENTS.md': withBlock(read('AGENTS.md'), block) ?? `# ${a.name}\n\n${a.summary}\n\n${block}\n`,
    // CLAUDE.md가 있으면 Claude는 AGENTS.md를 읽지 않는다 → import 한 줄로 연결. 옛 버전 Claude Code도 이걸로 읽는다.
    'CLAUDE.md': claudeMd == null ? '@AGENTS.md\n' : /^@AGENTS\.md\s*$/m.test(claudeMd) ? claudeMd : `@AGENTS.md\n\n${claudeMd}`,
    '.claude/settings.json': mergeSettings(read('.claude/settings.json'), a, previous.managedDeny ?? []),
  };
  if (a.gate) files[GATE] = tpl('verify-gate.mjs');
  if (a.loop) {
    for (const r of ['planner', 'generator', 'evaluator']) files[`.claude/agents/harness-${r}.md`] = fill(tpl(`harness-${r}.md`), vars);
    files['.claude/skills/harness-feature/SKILL.md'] = fill(tpl('harness-feature.md'), vars);
    files['docs/harness/progress.md'] = read('docs/harness/progress.md') ?? '# 하네스 진행 기록\n\n';
  }

  return Object.entries(files).map(([path, content]) => {
    const before = read(path);
    return { path, content, status: before == null ? 'new' : before === content ? 'same' : 'update' };
  });
}

export function install(dir, files) {
  for (const f of files.filter((f) => f.status !== 'same')) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
}
