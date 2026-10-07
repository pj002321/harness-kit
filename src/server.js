// 마법사용 로컬 서버. 127.0.0.1 에만 열고, 이 서버는 사용자 PC에서 명령을 실행할 수 있으므로:
//   - 모든 API는 실행 시 만든 일회용 토큰(x-harness-token 헤더)이 있어야 한다 → 다른 사이트가 몰래 호출 못 함(CSRF)
//   - Host 헤더가 localhost가 아니면 거절 → DNS 리바인딩 차단
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { detect } from './detect.js';
import { plan, install } from './generate.js';
import { brokenLinks } from '../templates/check-docs.mjs';

const UI = new URL('../ui/', import.meta.url);
const STATIC = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/i18n.js': ['i18n.js', 'text/javascript'] };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'";

function runCommand(command, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, { cwd, shell: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    const done = (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - started, output: out.split('\n').slice(-30).join('\n') });
    };
    child.on('error', (e) => { out += e.message; done(-1); });
    child.on('close', done);
  });
}

const body = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (d) => (s += d));
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
});

export function startServer({ dir, port = 0, onInstalled = () => {} }) {
  const token = randomBytes(16).toString('hex');
  const saved = existsSync(join(dir, '.claude/harness.json')) ? JSON.parse(readFileSync(join(dir, '.claude/harness.json'), 'utf8')) : null;

  const server = createServer(async (req, res) => {
    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'content-security-policy': CSP, 'cache-control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return send(403, { error: 'bad host' });
    const { pathname } = new URL(req.url, 'http://x');

    if (req.method === 'GET' && STATIC[pathname]) {
      const [file, type] = STATIC[pathname];
      return send(200, await readFile(new URL(file, UI)), type);
    }
    if (!pathname.startsWith('/api/')) return send(404, { error: 'not found' });
    if (req.headers['x-harness-token'] !== token) return send(403, { error: 'bad token' });

    try {
      if (pathname === '/api/state') return send(200, { dir, detected: detect(dir), saved });
      if (pathname === '/api/run' && req.method === 'POST') return send(200, await runCommand((await body(req)).command, dir));
      if (pathname === '/api/plan' && req.method === 'POST') {
        const a = await body(req);
        const files = plan(dir, a);
        // 게이트에 링크 검사가 붙으면, 설치 직후 상태에서 이미 깨진 링크가 있는지 미리 본다 (있으면 AI가 영원히 못 끝낸다)
        const broken = a.kb && a.gate ? brokenLinks(dir, Object.fromEntries(files.filter((f) => f.status !== 'same').map((f) => [f.path, f.content]))) : [];
        return send(200, { files, broken });
      }
      if (pathname === '/api/install' && req.method === 'POST') {
        const files = plan(dir, await body(req));
        install(dir, files);
        send(200, files.map(({ path, status }) => ({ path, status })));
        return onInstalled(files);
      }
      send(404, { error: 'not found' });
    } catch (e) {
      send(500, { error: e.message });
    }
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, token, url: `http://127.0.0.1:${server.address().port}/#${token}` })));
}
