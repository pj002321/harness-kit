#!/usr/bin/env node
// npx harness-kit [프로젝트 경로]  — 브라우저에 설치 마법사를 띄운다.
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server.js';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
if (!existsSync(dir)) {
  console.error(`경로가 없습니다: ${dir}`);
  process.exit(1);
}

const { server, url } = await startServer({
  dir,
  onInstalled: (files) => {
    console.log('\n설치 완료:');
    for (const f of files) if (f.status !== 'same') console.log(`  ${f.status === 'new' ? '+' : '~'} ${f.path}`);
    console.log('\n다음: 이 폴더에서 `claude` 를 실행하고, 기능 구현은 `/harness-feature <설명>`');
    setTimeout(() => server.close(() => process.exit(0)), 500);
  },
});

console.log(`harness-kit — ${dir}`);
console.log(`마법사: ${url}`);
console.log('(창이 안 뜨면 위 주소를 브라우저에 붙여넣기 · 끝내려면 Ctrl+C)');

if (!args.includes('--no-open')) {
  // 토큰은 #fragment 로 전달 — 서버 로그·Referer에 남지 않는다
  const [cmd, a] = process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, a, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}
