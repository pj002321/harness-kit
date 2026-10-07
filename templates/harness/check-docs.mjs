#!/usr/bin/env node
// harness-kit knowledge-base check: every relative link in AGENTS.md, ARCHITECTURE.md and docs/**/*.md must point to a file that exists.
// A map with dead links is worse than no map. Runs as one of the completion-gate checks.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MSG = {
  en: ['Broken links in the knowledge base', 'Fix the link or create the file it points to.'],
  ko: ['지식 베이스의 깨진 링크', '링크를 고치거나 가리키는 파일을 만들어라.'],
  ja: ['ナレッジベースのリンク切れ', 'リンクを直すか、リンク先のファイルを作成すること。'],
};

// overrides: { 'relative/path.md': content } — files about to be written (the installer checks the post-install state)
export function brokenLinks(root, overrides = {}) {
  const planned = new Map(Object.entries(overrides).map(([p, c]) => [normalize(join(root, p)), c]));
  // 디렉터리 링크(docs/exec-plans/)는 그 안에 만들어질 파일이 있으면 존재하는 것으로 본다
  const exists = (p) => {
    const n = normalize(p).replace(/[\\/]+$/, '');
    return existsSync(n) || planned.has(n) || [...planned.keys()].some((k) => k.startsWith(n + sep));
  };
  const docsDir = join(root, 'docs');
  const onDisk = existsSync(docsDir)
    ? readdirSync(docsDir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name))
    : [];
  const files = [...new Set([
    ...['AGENTS.md', 'ARCHITECTURE.md'].map((f) => normalize(join(root, f))),
    ...onDisk.map(normalize),
    ...[...planned.keys()].filter((p) => p.startsWith(normalize(docsDir))),
  ])].filter((f) => f.endsWith('.md') && exists(f));

  const broken = [];
  for (const file of files) {
    // Only real markdown links count: skip code and HTML comments.
    const text = (planned.get(file) ?? readFileSync(file, 'utf8')).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#|\/\/)/i.test(target)) continue; // http:, mailto:, #anchor
      const path = decodeURIComponent(target.split('#')[0]);
      if (path && !exists(join(dirname(file), path))) broken.push(`${relative(root, file).replaceAll('\\', '/')} → ${target}`);
    }
  }
  return broken;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let lang = 'en';
  try { lang = JSON.parse(readFileSync(join(root, '.claude', 'harness.json'), 'utf8')).lang ?? 'en'; } catch {}
  const broken = brokenLinks(root);
  if (broken.length) {
    const [title, fix] = MSG[lang] ?? MSG.en;
    console.log(`${title}:\n${broken.map((b) => `  - ${b}`).join('\n')}\n${fix}`);
    process.exit(1);
  }
}
