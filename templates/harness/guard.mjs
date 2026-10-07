#!/usr/bin/env node
// harness-kit guard — blocks protected paths and commands for agents without native deny rules.
// (Claude Code uses permissions.deny in .claude/settings.json instead.)
//   Codex — PreToolUse on Bash and apply_patch: exit 2 with the reason on stderr blocks the call
//   Cursor (--cursor) — beforeReadFile, and beforeShellExecution only for commands that already match a
//     blocked pattern (the hook matcher), so the guard never answers "allow" for a shell command.
// A useful guardrail, not a sandbox: scripts that open files themselves are not seen.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const MSG = {
  en: (what, rule) => `Blocked by harness-kit: ${what} (rule: ${rule}). This path or command is protected — do not try to work around it; ask the user.`,
  ko: (what, rule) => `harness-kit이 차단함: ${what} (규칙: ${rule}). 보호된 경로나 명령이다 — 우회하려 하지 말고 사용자에게 물어라.`,
  ja: (what, rule) => `harness-kitがブロック: ${what}（ルール: ${rule}）。保護されたパスまたはコマンドです — 回避しようとせず、ユーザーに確認すること。`,
};

// The harness protects itself so an agent cannot switch the gate off.
export const SELF = ['.harness/**', '.codex/hooks.json', '.codex/config.toml', '.cursor/hooks.json', '.claude/settings.json'];

// gitignore-style: a pattern without "/" matches that name at any depth; with "/" it is anchored at the project root
export function globToRe(pattern) {
  const p = pattern.replace(/^\//, '');
  const body = p.split(/(\*\*|\*|\?)/).map((t) => (t === '**' ? '.*' : t === '*' ? '[^/]*' : t === '?' ? '[^/]' : t.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(pattern.includes('/') ? `^${body}$` : `(^|/)${body}$`);
}
// command pattern: "git push --force*" → whole sub-command match
export const cmdToRe = (pattern) => new RegExp(`^${pattern.trim().split('*').map((t) => t.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

const rel = (root, p) => (isAbsolute(p) ? relative(root, p) : p).replaceAll('\\', '/').replace(/^\.\//, '');

// → [what, rule] if blocked, else null
export function decide(input, config, root) {
  const { noRead = [], noEdit = [], denyCommands = [] } = config;
  const hit = (path, patterns) => patterns.find((g) => globToRe(g).test(rel(root, path)));
  const event = input.hook_event_name;
  const tool = input.tool_name;
  const command = [input.tool_input?.command ?? input.command ?? ''].flat().join(' ');

  if (event === 'beforeReadFile' && input.file_path) {
    const r = hit(input.file_path, noRead);
    return r ? [`read ${rel(root, input.file_path)}`, r] : null;
  }
  if (tool === 'apply_patch' || (event === 'PreToolUse' && /\*\*\* (Add|Update|Delete) File:/.test(command))) {
    const paths = [...command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((m) => m[1].trim());
    for (const p of paths) {
      const r = hit(p, [...noRead, ...noEdit, ...SELF]);
      if (r) return [`edit ${rel(root, p)}`, r];
    }
    return null;
  }
  if (command) {
    for (const part of command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean)) {
      const r = denyCommands.find((c) => cmdToRe(c).test(part));
      if (r) return [part, r];
    }
    // a shell command that names a no-read file (cat .env, cp .env x, …)
    for (const token of command.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter(Boolean)) {
      const r = hit(token, noRead);
      if (r) return [`${command.slice(0, 80)}`, r];
    }
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cursor = process.argv.includes('--cursor');
  const root = process.env.CLAUDE_PROJECT_DIR || process.env.CURSOR_PROJECT_DIR
    || spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout?.trim() || process.cwd();
  let input = {}, config = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
  try { config = JSON.parse(readFileSync(join(root, '.harness', 'config.json'), 'utf8')); } catch {}
  const blocked = decide(input, config, root);
  const reason = blocked && (MSG[config.lang] ?? MSG.en)(...blocked);

  if (cursor) {
    process.stdout.write(JSON.stringify(blocked ? { permission: 'deny', user_message: reason, agent_message: reason } : { permission: 'allow' }));
    process.exit(0);
  }
  if (blocked) {
    process.stderr.write(reason);
    process.exit(2);
  }
  process.exit(0);
}
