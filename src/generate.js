// 마법사 답변 → 설치할 파일 목록. AI를 쓰지 않는다: 같은 답이면 항상 같은 결과.
// 구조: 공통(AGENTS.md, docs/, .harness/ 스크립트·설정) + 고른 에이전트마다 얇은 연결 파일.
// 기존 파일은 덮어쓰지 않는다: AGENTS.md/CLAUDE.md는 관리 블록만 교체, 설정 파일은 우리 항목만 교체,
// 지식 베이스 시작 문서는 없을 때만 만든다.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { CONTENT } from './content.js';
import { cmdToRe } from '../templates/harness/guard.mjs';

const TEMPLATES = new URL('../templates/', import.meta.url);
const tpl = (name) => readFileSync(new URL(name, TEMPLATES), 'utf8');
const fill = (s, vars) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

const START_TAG = '<!-- harness-kit:start';
const START = `${START_TAG} — managed by npx harness-kit; rerun the wizard to change it -->`;
const END = '<!-- harness-kit:end -->';
const CONFIG = '.harness/config.json';
const DOCS_CHECK_CMD = 'node .harness/check-docs.mjs';
// 예전 버전(0.1)이 만들던 파일 — 다시 설치하면 정리한다
const LEGACY = ['.claude/harness.json', '.claude/hooks/verify-gate.mjs', '.claude/hooks/check-docs.mjs'];
const OURS = /verify-gate\.mjs|\.harness\/(gate|guard)\.mjs/; // 설정 파일 안에서 우리 훅을 알아보는 표시

export const AGENTS = ['claude', 'codex', 'cursor'];

export const DEFAULTS = {
  lang: 'en', agents: ['claude'],
  name: '', summary: '', dirs: [], rules: [],
  kb: true, features: false,
  checks: [], run: { command: '', url: '' },
  noRead: [], noEdit: [], denyCommands: [],
  gate: true, loop: true, maxAttempts: 3,
};

// 프로젝트 루트 기준으로 고정. 슬래시 없는 이름(.env)은 gitignore처럼 어느 깊이든 매칭되게 그대로 둔다.
const anchor = (p) => (p.includes('/') && !p.startsWith('/') ? `/${p}` : p);

// Claude Code permissions.deny
export function denyRules(a) {
  return [
    ...a.noRead.map((p) => `Read(${anchor(p)})`),   // 읽기 금지는 수정도 막는다
    ...a.noEdit.map((p) => `Edit(${anchor(p)})`),
    ...a.denyCommands.map((c) => `Bash(${c})`),
    // 하네스가 자기 자신을 지킨다: AI가 게이트 설정을 고쳐 검사를 건너뛰지 못하게
    ...(a.gate ? ['Edit(/.harness/**)', 'Edit(/.claude/settings.json)'] : []),
  ];
}

// 이미 있는 아키텍처 문서(대소문자 무관, 루트 또는 docs/)를 쓴다. 없으면 ARCHITECTURE.md를 새로 만든다.
function findArchitecture(dir) {
  for (const sub of ['', 'docs']) {
    const d = join(dir, sub);
    const hit = existsSync(d) && readdirSync(d).find((f) => /^architecture\.md$/i.test(f));
    if (hit) return sub ? `${sub}/${hit}` : hit;
  }
  return null;
}

// OpenAI "Harness engineering"의 지식 베이스 구조
function knowledgeBase(a, L, archPath) {
  const d = L.docs;
  return {
    ...(archPath ? {} : { 'ARCHITECTURE.md': d.architecture(a.name) }),
    'docs/design-docs/index.md': d.designIndex,
    'docs/design-docs/core-beliefs.md': d.coreBeliefs,
    'docs/product-specs/index.md': d.specsIndex,
    'docs/exec-plans/active/.gitkeep': '',
    'docs/exec-plans/completed/.gitkeep': '',
    'docs/exec-plans/tech-debt-tracker.md': d.techDebt,
    'docs/references/README.md': d.references,
    'docs/generated/README.md': d.generated,
    'docs/QUALITY_SCORE.md': d.quality,
    'docs/RELIABILITY.md': d.reliability,
    'docs/SECURITY.md': d.security,
  };
}

function agentsBlock(a, L, archPath) {
  const B = L.block;
  const rows = a.kb
    ? [
        [B.mapRows.architecture, archPath ?? 'ARCHITECTURE.md'],
        [B.mapRows.designDocs, 'docs/design-docs/index.md'],
        [B.mapRows.specs, 'docs/product-specs/index.md'],
        [B.mapRows.plans, 'docs/exec-plans/'],
        [B.mapRows.quality, 'docs/QUALITY_SCORE.md'],
        [B.mapRows.reliability, 'docs/RELIABILITY.md'],
        [B.mapRows.security, 'docs/SECURITY.md'],
        [B.mapRows.references, 'docs/references/'],
        [B.mapRows.generated, 'docs/generated/'],
        ...(a.features ? [[B.mapRows.features, 'docs/features.json']] : []),
      ]
    : [];
  const rules = [
    ...a.rules.filter(Boolean),
    ...(a.gate ? [B.gateRule] : []),
    B.noWeaken,
    ...(a.features ? [B.featuresRule] : []),
  ];
  const locked = [...a.noRead.map((p) => `\`${p}\` (${B.noRead})`), ...a.noEdit.map((p) => `\`${p}\` (${B.noEdit})`)];
  const userChecks = a.checks.filter((c) => c.command !== DOCS_CHECK_CMD);
  const dirs = a.dirs.filter((d) => d.name);
  return [
    START,
    ...(rows.length ? [`## ${B.map}`, `| ${B.mapCols[0]} | ${B.mapCols[1]} |`, '|---|---|', ...rows.map(([what, where]) => `| ${what} | [${where}](${where}) |`), ''] : []),
    ...(dirs.length ? [`## ${B.structure}`, ...dirs.map((d) => `- \`${d.name}/\`${d.note ? ` — ${d.note}` : ''}`), ''] : []),
    `## ${B.rules}`,
    ...rules.map((r) => `- ${r}`),
    ...(locked.length ? ['', `${B.locked}: ${locked.join(', ')}`] : []),
    '',
    `## ${B.checks}`,
    userChecks.length ? [`| ${B.check} | ${B.command} |`, '|---|---|', ...userChecks.map((c) => `| ${c.label} | \`${c.command}\` |`)].join('\n') : B.none,
    ...(a.run.command ? ['', `## ${B.run}`, `\`${a.run.command}\`${a.run.url ? ` → ${a.run.url}` : ''}`] : []),
    ...(a.kb ? ['', `## ${B.session}`, ...B.sessionSteps.map((s, i) => `${i + 1}. ${s}`)] : []),
    ...(a.loop ? ['', `## ${B.loop}`, B.loopBody] : []),
    END,
  ].join('\n');
}

// 관리 블록이 있으면 교체(옛 버전의 시작 문구도 인식), 없으면 끝에 덧붙임
function withBlock(existing, block) {
  if (existing == null) return null;
  const i = existing.indexOf(START_TAG), j = existing.indexOf(END);
  if (i !== -1 && j > i) return existing.slice(0, i) + block + existing.slice(j + END.length);
  return `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
}

// hooks.{event} 목록에서 우리 항목만 걷어내고 새로 넣는다. 사용자가 직접 넣은 항목은 건드리지 않는다.
function setHooks(hooks, event, mine) {
  const list = (hooks[event] ?? []).filter((g) => !OURS.test(JSON.stringify(g)));
  if (mine) list.push(mine);
  if (list.length) hooks[event] = list;
  else delete hooks[event];
}

// ── Claude Code: .claude/settings.json (Stop 훅 + permissions.deny)
function claudeSettings(existing, a, previousDeny) {
  const s = existing ? JSON.parse(existing) : {};
  s.hooks ??= {};
  setHooks(s.hooks, 'Stop', a.gate && { hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.harness/gate.mjs'], timeout: 900 }] });
  if (!Object.keys(s.hooks).length) delete s.hooks;

  const keep = (s.permissions?.deny ?? []).filter((r) => !previousDeny.includes(r));
  const deny = [...new Set([...keep, ...denyRules(a)])];
  s.permissions = { ...s.permissions, deny };
  if (!deny.length) delete s.permissions.deny;
  if (!Object.keys(s.permissions).length) delete s.permissions;
  return JSON.stringify(s, null, 2) + '\n';
}

// ── Codex: .codex/hooks.json (Stop 게이트 + PreToolUse 가드). Codex는 하위 폴더에서 시작할 수 있어 루트를 git으로 찾는다.
const codexCmd = (script) => `node "$(git rev-parse --show-toplevel)/.harness/${script}"`;
function codexHooks(existing, a) {
  const s = existing ? JSON.parse(existing) : {};
  s.hooks ??= {};
  setHooks(s.hooks, 'Stop', a.gate && { hooks: [{ type: 'command', command: codexCmd('gate.mjs'), timeout: 900 }] });
  const guard = a.gate || a.noRead.length || a.noEdit.length || a.denyCommands.length;
  setHooks(s.hooks, 'PreToolUse', guard && { matcher: '^(Bash|apply_patch)$', hooks: [{ type: 'command', command: codexCmd('guard.mjs'), timeout: 30 }] });
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return JSON.stringify(s, null, 2) + '\n';
}
// 오래된 Codex(0.145 미만)는 훅이 기능 플래그 뒤에 있다. codex_hooks는 새 버전에서도 별칭으로 동작한다.
function codexConfig(existing) {
  if (existing == null) return '[features]\ncodex_hooks = true\n';
  if (/^\s*(codex_hooks|hooks)\s*=/m.test(existing)) return existing;
  if (/^\[features\]\s*$/m.test(existing)) return existing.replace(/^\[features\]\s*$/m, '[features]\ncodex_hooks = true');
  return `${existing.replace(/\s*$/, '')}\n\n[features]\ncodex_hooks = true\n`;
}

// ── Cursor: .cursor/hooks.json
// stop: 게이트 (followup_message로 다시 일하게 함). beforeReadFile: 읽기 금지. beforeShellExecution: 금지 명령에
// "해당할 때만" 실행되도록 matcher를 건다 — 가드가 모든 명령에 allow를 답해 승인 창을 건너뛰게 만들 위험을 피한다.
function cursorHooks(existing, a) {
  const s = existing ? JSON.parse(existing) : {};
  s.version ??= 1;
  s.hooks ??= {};
  setHooks(s.hooks, 'stop', a.gate && { command: 'node .harness/gate.mjs --cursor', timeout: 900, loop_limit: 8 });
  setHooks(s.hooks, 'beforeReadFile', a.noRead.length && { command: 'node .harness/guard.mjs --cursor', timeout: 30 });
  const matcher = a.denyCommands.map((c) => cmdToRe(c).source.replace(/^\^|\$$/g, '')).join('|');
  setHooks(s.hooks, 'beforeShellExecution', matcher && { command: 'node .harness/guard.mjs --cursor', timeout: 30, matcher });
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return JSON.stringify(s, null, 2) + '\n';
}

// 서브에이전트 마크다운 → Codex TOML
function codexAgent(md, readonly) {
  const [, front, body] = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const field = (k) => front.match(new RegExp(`^${k}: (.*)$`, 'm'))?.[1] ?? '';
  return [
    `name = ${JSON.stringify(field('name'))}`,
    `description = ${JSON.stringify(field('description'))}`,
    ...(readonly ? ['sandbox_mode = "read-only"'] : []),
    `developer_instructions = ${JSON.stringify(body.trim())}`,
    '',
  ].join('\n');
}
// 스킬 → Cursor 명령 (frontmatter 없이 본문만; 명령 뒤에 적은 내용이 요청이 된다)
const cursorCommand = (md) => md.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\$ARGUMENTS/g, '(the text typed after this command)');

// → [{ path, status: 'new' | 'update' | 'same' | 'remove', content }]
export function plan(dir, input) {
  const a = { ...DEFAULTS, ...input, run: { ...DEFAULTS.run, ...input.run } };
  a.agents = AGENTS.filter((x) => a.agents.includes(x));
  const L = CONTENT[a.lang] ?? CONTENT.en;
  const lang = CONTENT[a.lang] ? a.lang : 'en';
  const has = (x) => a.agents.includes(x);
  // 지식 베이스를 켜면 링크 검사가 게이트에 붙는다 (OpenAI: "docs are verified mechanically")
  a.checks = a.checks.filter((c) => c.command && c.command !== DOCS_CHECK_CMD && !c.command.includes('check-docs.mjs'));
  if (a.kb && a.gate) a.checks.push({ kind: 'docs', label: L.block.docsCheck, command: DOCS_CHECK_CMD });
  a.dirs = a.dirs.map(({ name, note }) => ({ name, note })); // 화면용 필드(peek, auto, role)는 저장하지 않는다

  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  const previous = JSON.parse(read(CONFIG) ?? read('.claude/harness.json') ?? '{}');
  const archPath = a.kb ? findArchitecture(dir) : null;
  const checksList = a.checks.length ? a.checks.map((c) => `  - ${c.label}: \`${c.command}\``).join('\n') : '  - (none)';
  const vars = {
    checksList, runCommand: a.run.command || '(none)', runUrl: a.run.url || '(none)', maxAttempts: String(a.maxAttempts),
    featuresStep: a.features ? L.featuresStep : '',
  };

  const claudeMd = read('CLAUDE.md');
  const managed = {
    [CONFIG]: JSON.stringify({ version: 2, ...a, lang, managedDeny: denyRules(a) }, null, 2) + '\n',
    'AGENTS.md': withBlock(read('AGENTS.md'), agentsBlock(a, L, archPath)) ?? `# ${a.name}\n\n${a.summary ? `${a.summary}\n\n` : ''}${agentsBlock(a, L, archPath)}\n`,
  };
  if (a.gate) managed['.harness/gate.mjs'] = tpl('harness/gate.mjs');
  if (a.gate && a.kb) managed['.harness/check-docs.mjs'] = tpl('harness/check-docs.mjs');
  if (has('codex') || has('cursor')) managed['.harness/guard.mjs'] = tpl('harness/guard.mjs');

  // 에이전트 파일: 같은 프롬프트를 각 도구의 형식으로
  const agentMd = Object.fromEntries(['planner', 'generator', 'evaluator'].map((r) => [r, fill(tpl(`${lang}/harness-${r}.md`), vars)]));
  const skill = fill(tpl(`${lang}/harness-feature.md`), vars);

  if (has('claude')) {
    // CLAUDE.md가 있으면 Claude는 AGENTS.md를 읽지 않는다 → import 한 줄로 연결. 옛 버전 Claude Code도 이걸로 읽는다.
    managed['CLAUDE.md'] = claudeMd == null ? '@AGENTS.md\n' : /^@AGENTS\.md\s*$/m.test(claudeMd) ? claudeMd : `@AGENTS.md\n\n${claudeMd}`;
    managed['.claude/settings.json'] = claudeSettings(read('.claude/settings.json'), a, previous.managedDeny ?? []);
  }
  if (has('codex')) {
    managed['.codex/hooks.json'] = codexHooks(read('.codex/hooks.json'), a);
    if (a.gate || a.noRead.length || a.noEdit.length || a.denyCommands.length) managed['.codex/config.toml'] = codexConfig(read('.codex/config.toml'));
  }
  if (has('cursor')) managed['.cursor/hooks.json'] = cursorHooks(read('.cursor/hooks.json'), a);
  // 선택을 해제한 에이전트: 그 도구의 설정에서 우리 항목만 걷어낸다 (사용자 항목은 그대로)
  const none = { ...a, gate: false, noRead: [], noEdit: [], denyCommands: [] };
  const cleaned = {
    claude: ['.claude/settings.json', (s) => claudeSettings(s, none, previous.managedDeny ?? [])],
    codex: ['.codex/hooks.json', (s) => codexHooks(s, none)],
    cursor: ['.cursor/hooks.json', (s) => cursorHooks(s, none)],
  };
  for (const [agent, [path, clean]] of Object.entries(cleaned)) {
    if (!has(agent) && read(path) != null && OURS.test(read(path) + (agent === 'claude' ? JSON.stringify(previous.managedDeny ?? []) : ''))) managed[path] = clean(read(path));
  }

  if (a.loop) {
    // Cursor는 .claude/agents/도 읽는다 → Claude와 함께 쓰면 한 벌만 둔다 (readonly 필드는 Claude가 무시)
    const mdDir = has('claude') ? '.claude/agents' : has('cursor') ? '.cursor/agents' : null;
    if (mdDir) for (const [r, md] of Object.entries(agentMd)) managed[`${mdDir}/harness-${r}.md`] = md;
    if (has('codex')) for (const [r, md] of Object.entries(agentMd)) managed[`.codex/agents/harness-${r}.toml`] = codexAgent(md, r !== 'generator');
    if (has('claude')) managed['.claude/skills/harness-feature/SKILL.md'] = skill;
    if (has('codex')) managed['.agents/skills/harness-feature/SKILL.md'] = skill;
    if (has('cursor')) managed['.cursor/commands/harness-feature.md'] = cursorCommand(skill);
  }

  // 시작 문서: 없을 때만 만든다. 이미 있으면 사용자 것이므로 그대로 둔다.
  const starters = {
    ...(a.kb ? knowledgeBase(a, L, archPath) : {}),
    ...(a.kb || a.loop ? { 'docs/exec-plans/progress.md': L.docs.progress } : {}),
    ...(a.features ? { 'docs/features.json': '[]\n' } : {}),
  };
  if (a.loop && !a.kb) Object.assign(starters, { 'docs/product-specs/index.md': L.docs.specsIndex, 'docs/exec-plans/active/.gitkeep': '', 'docs/exec-plans/completed/.gitkeep': '' });

  // 지난번에 우리가 만들었지만 이번엔 필요 없는 파일 (옛 버전 파일, 꺼진 에이전트의 파일)
  const ownedBefore = [...LEGACY, ...(previous.installed ?? [])];
  const removals = [...new Set(ownedBefore)].filter((p) => !(p in managed) && !(p in starters) && read(p) != null && !p.startsWith('docs/'));
  managed[CONFIG] = JSON.stringify({ version: 2, ...a, lang, managedDeny: denyRules(a), installed: Object.keys(managed).filter((p) => p !== CONFIG && !['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.codex/config.toml'].includes(p) && !p.endsWith('hooks.json')) }, null, 2) + '\n';

  return [
    ...Object.entries(managed).map(([path, content]) => {
      const before = read(path);
      return { path, content, status: before == null ? 'new' : before === content ? 'same' : 'update' };
    }),
    ...Object.entries(starters).map(([path, content]) => {
      const before = read(path);
      return before == null ? { path, content, status: 'new' } : { path, content: before, status: 'same' };
    }),
    ...removals.map((path) => ({ path, content: read(path), status: 'remove' })),
  ];
}

export function install(dir, files) {
  for (const f of files) {
    if (f.status === 'same') continue;
    if (f.status === 'remove') { rmSync(join(dir, f.path), { force: true }); continue; }
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
}
