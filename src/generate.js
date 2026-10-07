// 마법사 답변 → 설치할 파일 목록. AI를 쓰지 않는다: 같은 답이면 항상 같은 결과.
// 기존 파일은 덮어쓰지 않는다: AGENTS.md/CLAUDE.md는 관리 블록만 교체, settings.json은 우리 항목만 교체,
// 지식 베이스 시작 문서는 없을 때만 만든다.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { CONTENT } from './content.js';

const TEMPLATES = new URL('../templates/', import.meta.url);
const tpl = (name) => readFileSync(new URL(name, TEMPLATES), 'utf8');
const fill = (s, vars) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

const START_TAG = '<!-- harness-kit:start';
const START = `${START_TAG} — managed by npx harness-kit; rerun the wizard to change it -->`;
const END = '<!-- harness-kit:end -->';
const GATE = '.claude/hooks/verify-gate.mjs';
const DOCS_CHECK = '.claude/hooks/check-docs.mjs';
const DOCS_CHECK_CMD = `node ${DOCS_CHECK}`;

export const DEFAULTS = {
  lang: 'en',
  name: '', summary: '', dirs: [], rules: [],
  kb: true, features: false,
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

function mergeSettings(existing, a, previousDeny) {
  const s = existing ? JSON.parse(existing) : {};
  // 우리가 넣었던 Stop 훅과 deny 규칙만 걷어내고 새로 넣는다. 사용자가 직접 넣은 항목은 건드리지 않는다.
  const stop = (s.hooks?.Stop ?? []).filter((g) => !JSON.stringify(g).includes('verify-gate.mjs'));
  if (a.gate) stop.push({ hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/${GATE}`], timeout: 900 }] });
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
  const L = CONTENT[a.lang] ?? CONTENT.en;
  const lang = CONTENT[a.lang] ? a.lang : 'en';
  // 지식 베이스를 켜면 링크 검사가 게이트에 붙는다 (OpenAI: "docs are verified mechanically")
  a.checks = a.checks.filter((c) => c.command && c.command !== DOCS_CHECK_CMD);
  if (a.kb && a.gate) a.checks.push({ kind: 'docs', label: L.block.docsCheck, command: DOCS_CHECK_CMD });
  a.dirs = a.dirs.map(({ name, note }) => ({ name, note })); // 화면용 필드(peek, auto, role)는 저장하지 않는다

  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);
  const previous = JSON.parse(read('.claude/harness.json') ?? '{}');
  const archPath = a.kb ? findArchitecture(dir) : null;
  const checksList = a.checks.length ? a.checks.map((c) => `  - ${c.label}: \`${c.command}\``).join('\n') : '  - (none)';
  const vars = {
    checksList, runCommand: a.run.command || '(none)', runUrl: a.run.url || '(none)', maxAttempts: String(a.maxAttempts),
    featuresStep: a.features ? L.featuresStep : '',
  };

  const block = agentsBlock(a, L, archPath);
  const claudeMd = read('CLAUDE.md');
  const managed = {
    '.claude/harness.json': JSON.stringify({ version: 1, ...a, lang, managedDeny: denyRules(a) }, null, 2) + '\n',
    'AGENTS.md': withBlock(read('AGENTS.md'), block) ?? `# ${a.name}\n\n${a.summary ? `${a.summary}\n\n` : ''}${block}\n`,
    // CLAUDE.md가 있으면 Claude는 AGENTS.md를 읽지 않는다 → import 한 줄로 연결. 옛 버전 Claude Code도 이걸로 읽는다.
    'CLAUDE.md': claudeMd == null ? '@AGENTS.md\n' : /^@AGENTS\.md\s*$/m.test(claudeMd) ? claudeMd : `@AGENTS.md\n\n${claudeMd}`,
    '.claude/settings.json': mergeSettings(read('.claude/settings.json'), a, previous.managedDeny ?? []),
  };
  if (a.gate) managed[GATE] = tpl('verify-gate.mjs');
  if (a.gate && a.kb) managed[DOCS_CHECK] = tpl('check-docs.mjs');
  if (a.loop) {
    for (const r of ['planner', 'generator', 'evaluator']) managed[`.claude/agents/harness-${r}.md`] = fill(tpl(`${lang}/harness-${r}.md`), vars);
    managed['.claude/skills/harness-feature/SKILL.md'] = fill(tpl(`${lang}/harness-feature.md`), vars);
  }

  // 시작 문서: 없을 때만 만든다. 이미 있으면 사용자 것이므로 그대로 둔다.
  const starters = {
    ...(a.kb ? knowledgeBase(a, L, archPath) : {}),
    ...(a.kb || a.loop ? { 'docs/exec-plans/progress.md': L.docs.progress } : {}),
    ...(a.features ? { 'docs/features.json': '[]\n' } : {}),
  };
  if (a.loop && !a.kb) Object.assign(starters, { 'docs/product-specs/index.md': L.docs.specsIndex, 'docs/exec-plans/active/.gitkeep': '', 'docs/exec-plans/completed/.gitkeep': '' });

  return [
    ...Object.entries(managed).map(([path, content]) => {
      const before = read(path);
      return { path, content, status: before == null ? 'new' : before === content ? 'same' : 'update' };
    }),
    ...Object.entries(starters).map(([path, content]) => {
      const before = read(path);
      return before == null ? { path, content, status: 'new' } : { path, content: before, status: 'same' };
    }),
  ];
}

export function install(dir, files) {
  for (const f of files.filter((f) => f.status !== 'same')) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
}
