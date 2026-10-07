// 대상 프로젝트를 읽어서 마법사의 기본값을 추정한다. 추정일 뿐 — 사용자가 마법사에서 확인·수정한다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const read = (dir, f) => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return null; } };
const json = (dir, f) => { try { return JSON.parse(read(dir, f)); } catch { return null; } };
const has = (dir, f) => existsSync(join(dir, f));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__', 'venv']);

export function detect(dir) {
  const pkg = json(dir, 'package.json');
  const pyproject = read(dir, 'pyproject.toml');
  const stacks = [];
  const checks = [];          // [{ label, command }]
  let run = null;             // { command, url }

  if (pkg) {
    stacks.push(has(dir, 'tsconfig.json') ? 'TypeScript' : 'JavaScript');
    const pm = has(dir, 'pnpm-lock.yaml') ? 'pnpm' : has(dir, 'yarn.lock') ? 'yarn' : has(dir, 'bun.lockb') || has(dir, 'bun.lock') ? 'bun' : 'npm';
    const script = (name) => (pm === 'npm' ? (name === 'test' ? 'npm test' : `npm run ${name}`) : `${pm} ${name}`);
    const s = pkg.scripts ?? {};
    // npm init 기본값 "Error: no test specified" 는 테스트가 아니다
    if (s.test && !/no test specified/.test(s.test)) checks.push({ label: '테스트', command: script('test') });
    if (s.lint) checks.push({ label: '린트', command: script('lint') });
    if (s.typecheck) checks.push({ label: '타입 검사', command: script('typecheck') });
    else if (has(dir, 'tsconfig.json')) checks.push({ label: '타입 검사', command: 'npx tsc --noEmit' });
    const dev = s.dev ? 'dev' : s.start ? 'start' : null;
    if (dev) {
      const port = /vite/.test(s[dev]) ? 5173 : /next/.test(s[dev]) ? 3000 : /astro/.test(s[dev]) ? 4321 : null;
      run = { command: script(dev), url: port ? `http://localhost:${port}` : '' };
    }
  }
  if (pyproject || has(dir, 'requirements.txt') || has(dir, 'setup.py')) {
    stacks.push('Python');
    if (pyproject?.includes('pytest') || has(dir, 'tests') || has(dir, 'pytest.ini')) checks.push({ label: '테스트', command: 'pytest' });
    if (pyproject?.includes('[tool.ruff') || has(dir, 'ruff.toml')) checks.push({ label: '린트', command: 'ruff check .' });
    if (pyproject?.includes('[tool.mypy') || has(dir, 'mypy.ini')) checks.push({ label: '타입 검사', command: 'mypy .' });
  }
  if (has(dir, 'go.mod')) {
    stacks.push('Go');
    checks.push({ label: '테스트', command: 'go test ./...' }, { label: '정적 검사', command: 'go vet ./...' });
  }
  if (has(dir, 'Cargo.toml')) {
    stacks.push('Rust');
    checks.push({ label: '테스트', command: 'cargo test' }, { label: '린트', command: 'cargo clippy -- -D warnings' });
  }
  if (!checks.length && /^test:/m.test(read(dir, 'Makefile') ?? '')) checks.push({ label: '테스트', command: 'make test' });

  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
    .map((d) => d.name)
    .sort();

  // AI가 고치면 안 되는 경로 후보: 비밀, 마이그레이션, 생성물
  const protect = ['.env', '.env.*'];
  for (const d of ['migrations', 'db/migrations', 'prisma/migrations', 'alembic/versions']) if (has(dir, d)) protect.push(`${d}/**`);
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'Cargo.lock']) if (has(dir, lock)) protect.push(lock);

  const readmeLine = read(dir, 'README.md')?.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l && !/^[!\[<]/.test(l));

  return {
    name: pkg?.name ?? pyproject?.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? basename(dir),
    summary: pkg?.description || readmeLine || '',
    stacks,
    checks,
    run: run ?? { command: '', url: '' },
    dirs: dirs.map((name) => ({ name, note: '' })),
    protect,
    git: has(dir, '.git'),
    existing: ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.claude/harness.json'].filter((f) => has(dir, f)),
  };
}
