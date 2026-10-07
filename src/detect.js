// 대상 프로젝트를 읽어서 마법사의 기본값을 추정한다. 추정일 뿐 — 사용자가 마법사에서 확인·수정한다.
// 사람이 읽을 문구는 여기서 만들지 않고 키(kind, role, ruleHints)로 넘긴다 — UI가 고른 언어로 번역한다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const read = (dir, f) => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return null; } };
const json = (dir, f) => { try { return JSON.parse(read(dir, f)); } catch { return null; } };
const has = (dir, f) => existsSync(join(dir, f));
const firstLine = (md) => md?.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l && !/^[!\[<]/.test(l)) ?? null;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__', 'venv']);

// 흔한 폴더 이름 → 역할
const DIR_ROLES = {
  src: 'source', lib: 'library', app: 'app', apps: 'packages', packages: 'packages', components: 'components', pages: 'pages',
  routes: 'routes', api: 'api', server: 'server', client: 'client', public: 'static', static: 'static', assets: 'static',
  test: 'tests', tests: 'tests', __tests__: 'tests', spec: 'tests', e2e: 'e2e', docs: 'docs', doc: 'docs',
  scripts: 'scripts', bin: 'scripts', tools: 'scripts', config: 'config', migrations: 'migrations', prisma: 'db', db: 'db',
  infra: 'infra', deploy: 'infra', terraform: 'infra', examples: 'examples', styles: 'styles', types: 'types',
  utils: 'utils', helpers: 'utils', hooks: 'hooks', models: 'models', prompts: 'prompts', fixtures: 'fixtures',
};

// 폴더 안을 살짝 들여다본다. README 첫 줄이나 package.json 설명이 있으면 그게 가장 좋은 설명이다.
// 아무것도 모르면 안에 무엇이 있는지(peek)라도 보여줘서 사람이 설명을 쓰기 쉽게 한다.
function describeDir(dir, name) {
  const sub = join(dir, name);
  const entries = readdirSync(sub, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const own = json(sub, 'package.json')?.description || firstLine(read(sub, 'README.md'));
  const role = DIR_ROLES[name] ?? (files.length && files.every((f) => /\.(test|spec)\./.test(f)) ? 'tests' : null);
  return { name, note: own ?? '', role, peek: entries.slice(0, 5).map((e) => e.name + (e.isDirectory() ? '/' : '')) };
}

export function detect(dir) {
  const pkg = json(dir, 'package.json');
  const pyproject = read(dir, 'pyproject.toml');
  const stacks = [];
  const checks = []; // [{ kind: 'test' | 'lint' | 'types', command }]
  let run = null;    // { command, url }

  if (pkg) {
    stacks.push(has(dir, 'tsconfig.json') ? 'TypeScript' : 'JavaScript');
    const pm = has(dir, 'pnpm-lock.yaml') ? 'pnpm' : has(dir, 'yarn.lock') ? 'yarn' : has(dir, 'bun.lockb') || has(dir, 'bun.lock') ? 'bun' : 'npm';
    const script = (name) => (pm === 'npm' ? (name === 'test' ? 'npm test' : `npm run ${name}`) : `${pm} ${name}`);
    const s = pkg.scripts ?? {};
    // npm init 기본값 "Error: no test specified" 는 테스트가 아니다
    if (s.test && !/no test specified/.test(s.test)) checks.push({ kind: 'test', command: script('test') });
    if (s.lint) checks.push({ kind: 'lint', command: script('lint') });
    if (s.typecheck) checks.push({ kind: 'types', command: script('typecheck') });
    else if (has(dir, 'tsconfig.json')) checks.push({ kind: 'types', command: 'npx tsc --noEmit' });
    const dev = s.dev ? 'dev' : s.start ? 'start' : null;
    if (dev) {
      const port = /vite/.test(s[dev]) ? 5173 : /next/.test(s[dev]) ? 3000 : /astro/.test(s[dev]) ? 4321 : null;
      run = { command: script(dev), url: port ? `http://localhost:${port}` : '' };
    }
  }
  if (pyproject || has(dir, 'requirements.txt') || has(dir, 'setup.py')) {
    stacks.push('Python');
    if (pyproject?.includes('pytest') || has(dir, 'tests') || has(dir, 'pytest.ini')) checks.push({ kind: 'test', command: 'pytest' });
    if (pyproject?.includes('[tool.ruff') || has(dir, 'ruff.toml')) checks.push({ kind: 'lint', command: 'ruff check .' });
    if (pyproject?.includes('[tool.mypy') || has(dir, 'mypy.ini')) checks.push({ kind: 'types', command: 'mypy .' });
  }
  if (has(dir, 'go.mod')) {
    stacks.push('Go');
    checks.push({ kind: 'test', command: 'go test ./...' }, { kind: 'lint', command: 'go vet ./...' });
  }
  if (has(dir, 'Cargo.toml')) {
    stacks.push('Rust');
    checks.push({ kind: 'test', command: 'cargo test' }, { kind: 'lint', command: 'cargo clippy -- -D warnings' });
  }
  if (!checks.length && /^test:/m.test(read(dir, 'Makefile') ?? '')) checks.push({ kind: 'test', command: 'make test' });

  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
    .map((d) => d.name)
    .sort();

  // AI가 고치면 안 되는 경로 후보: 비밀, 마이그레이션, 잠금 파일
  const protect = ['.env', '.env.*'];
  for (const d of ['migrations', 'db/migrations', 'prisma/migrations', 'alembic/versions']) if (has(dir, d)) protect.push(`${d}/**`);
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'Cargo.lock']) if (has(dir, lock)) protect.push(lock);

  // 팀 규칙 제안 — 스택에 맞는 것을 앞에
  const ruleHints = [
    ...(has(dir, 'tsconfig.json') ? ['noAny'] : []),
    ...(pkg || pyproject ? ['askDeps'] : []),
    'testsWithChange', 'matchStyle', 'smallChanges', 'noSecrets', 'explainWhy',
  ];

  return {
    name: pkg?.name ?? pyproject?.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? basename(dir),
    summary: pkg?.description || firstLine(read(dir, 'README.md')) || '',
    stacks,
    checks,
    run: run ?? { command: '', url: '' },
    dirs: dirs.map((name) => describeDir(dir, name)),
    ruleHints,
    protect,
    git: has(dir, '.git'),
    existing: ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.claude/harness.json'].filter((f) => has(dir, f)),
  };
}
