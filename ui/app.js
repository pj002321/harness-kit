// 설치 마법사. 상태(a)는 .claude/harness.json 과 같은 모양이다.
import { I18N, LANGS } from '/i18n.js';

const token = location.hash.slice(1);
const api = async (path, data) => {
  const res = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'x-harness-token': token, 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

let lang = localStorage.getItem('hk-lang') || 'en';
let T = I18N[lang];
let step = 0, a, hints = [], files = [], broken = [], openFile = 0, installed = null, error = '';
const results = {}; // command → { code, ms, output } 마지막 실행 결과

const failing = () => a.checks.filter((c) => c.command && results[c.command]?.code !== 0);
const hint = (h) => (h ? ` <span class="hint">— ${h}</span>` : '');
const callout = (title, body) => `<div class="callout"><b>${title}</b>${body}</div>`;

// 지금까지의 답으로 하네스가 실제로 어떻게 도는지 그린다. 꺼진 부품은 흐리게.
function diagram() {
  const V = T.viz;
  const node = (cls, title, sub) => `<div class="node ${cls}"><b>${title}</b><span>${sub}</span></div>`;
  const checks = a.checks.filter((c) => c.command).map((c) => c.label || c.command);
  if (a.kb) checks.push(V.docsCheck); // 지식 베이스를 켜면 링크 검사가 게이트에 붙는다
  const rules = a.noRead.length + a.noEdit.length + a.denyCommands.length + (a.gate ? 3 : 0);
  const work = a.loop
    ? `${node('planner', V.planner, V.plannerSub)}
       <div class="arr">→</div>
       <div class="loop"><span class="tag">↻ ${V.loopTag(a.maxAttempts)}</span>
         ${node('gen', V.generator, V.generatorSub)}
         <div class="arr ex">⇄<small>${V.exchange}</small></div>
         ${node('eval', V.evaluator, V.evaluatorSub)}
       </div>`
    : node('direct', V.direct, V.directSub);
  return `
    <section class="viz" aria-label="${esc(V.title)}">
      <h3>${V.title}</h3>
      <div class="row1">${node('user', V.request, a.loop ? V.requestSub : '')}<div class="arr">→</div>${work}</div>
      <div class="arr down">↓</div>
      <div class="node gate ${a.gate ? '' : 'off'}"><b>${V.gate}${a.gate ? '' : ` · ${V.off}`}</b><span>${a.gate ? `${esc(checks.join(' · '))} — ${V.gateSub}` : V.gateOff}</span></div>
      <div class="guard">🔒 ${rules ? V.guard(rules) : V.guardNone}</div>
    </section>`;
}

// 각 단계: render() → HTML, bind() → 입력을 a에 반영, blocked() → 다음으로 못 가는 이유
// 단계 번호 (에이전트 단계가 맨 앞)
const S = { agents: 0, project: 1, structure: 2, checks: 3, run: 4, guard: 5, parts: 6, review: 7 };
const AGENTS = ['claude', 'codex', 'cursor'];
const VERIFIED = ['claude']; // 실제 세션으로 동작을 확인한 도구 — 나머지는 확인 전까지 '실험적'

const VIEWS = [
  {
    render: () => `
      <h2>${T.pa.title}</h2>
      <p class="lead">${T.pa.lead}</p>
      ${AGENTS.map((k) => {
        const info = T.pa.list[k];
        return `<label class="toggle agent"><input type="checkbox" data-agent="${k}" ${a.agents.includes(k) ? 'checked' : ''}>
          <div><h3>${info.name} <span class="badge ${VERIFIED.includes(k) ? 'new' : 'update'}">${VERIFIED.includes(k) ? T.pa.verified : T.pa.experimental}</span></h3>
          <ul class="caps">${info.items.map(([m, t]) => `<li class="${m}">${t}</li>`).join('')}</ul></div></label>`;
      }).join('')}`,
    bind: () => { a.agents = AGENTS.filter((k) => $(`[data-agent="${k}"]`)?.checked); },
    blocked: () => (a.agents.length ? '' : T.pa.need),
  },
  {
    render: () => `
      <h2>${T.p1.title}</h2>
      <p class="lead">${T.p1.lead}</p>
      <label class="f" for="name">${T.p1.name}</label><input type="text" id="name" value="${esc(a.name)}">
      <label class="f" for="summary">${T.p1.summary}${hint(T.optional)}</label><input type="text" id="summary" value="${esc(a.summary)}" placeholder="${esc(T.p1.summaryPh)}">
      <label class="f">${T.p1.dirs}${hint(T.p1.dirsHint)}</label>
      ${a.dirs.map((d, i) => `<div class="dirrow"><code title="${esc((d.peek ?? []).join('  '))}">${esc(d.name)}/</code><input type="text" data-dir="${i}" value="${esc(d.note)}" placeholder="${esc(T.p1.dirPh)}" class="${d.auto ? 'guessed' : ''}"></div>`).join('')}
      <label class="f" for="rules">${T.p1.rules}${hint(T.p1.rulesHint)}</label>
      <textarea id="rules" placeholder="${esc(T.p1.rulesPh)}">${esc(a.rules.join('\n'))}</textarea>
      <div class="hint">${T.p1.suggest}</div>
      <div class="chips">${hints.filter((k) => !a.rules.includes(T.rules[k])).map((k) => `<button data-rule="${k}">+ ${esc(T.rules[k])}</button>`).join('')}</div>
      <p class="hint blank">${T.blank}</p>`,
    bind: () => {
      a.name = $('#name').value.trim();
      a.summary = $('#summary').value.trim();
      document.querySelectorAll('[data-dir]').forEach((el) => {
        const d = a.dirs[el.dataset.dir];
        if (el.value.trim() !== d.note) Object.assign(d, { note: el.value.trim(), auto: false }); // 손으로 고치면 더 이상 추정값이 아니다
      });
      a.rules = lines($('#rules').value);
    },
    blocked: () => (!a.name ? T.p1.needName : ''),
    events: { rule: (k) => { a.rules.push(T.rules[k]); } },
  },
  {
    render: () => {
      const tree = files.filter((f) => f.path.startsWith('docs/') || f.path === 'ARCHITECTURE.md').map((f) => f.path.replace(/\/\.gitkeep$/, '/'));
      const state = Object.fromEntries(files.map((f) => [f.path.replace(/\/\.gitkeep$/, '/'), f.status]));
      return `
      <h2>${T.ps.title}</h2>
      <p class="lead">${T.ps.lead}</p>
      <label class="toggle"><input type="checkbox" id="kb" ${a.kb ? 'checked' : ''}><div><h3>${T.ps.kbT}</h3><p>${T.ps.kbB}</p></div></label>
      <label class="toggle"><input type="checkbox" id="feat" ${a.features ? 'checked' : ''}><div><h3>${T.ps.featT}</h3><p>${T.ps.featB}</p></div></label>
      ${tree.length ? `<label class="f">${T.ps.tree}</label><ul class="tree">${tree.sort().map((p) => `<li><code>${esc(p)}</code> <span class="badge ${state[p] === 'same' ? 'same' : 'new'}">${state[p] === 'same' ? T.ps.exists : T.ps.created}</span></li>`).join('')}</ul>` : ''}
      <p class="hint">${T.ps.note}</p>`;
    },
    bind: () => { a.kb = $('#kb').checked; a.features = $('#feat').checked; },
    blocked: () => '',
    enter: () => refreshPlan(),
  },
  {
    render: () => `
      <h2>${T.p2.title}</h2>
      <p class="lead">${T.p2.lead}</p>
      ${a.checks.length ? '' : `<p class="hint">${T.p2.none}</p>`}
      ${a.checks.map((c, i) => {
        const r = results[c.command];
        return `<div class="row">
          <input type="text" data-check="${i}" data-k="label" value="${esc(c.label)}" aria-label="${T.p2.labelAria}">
          <input type="text" class="mono" data-check="${i}" data-k="command" value="${esc(c.command)}" aria-label="${T.p2.cmdAria}">
          <button data-run="${i}">${T.p2.run}</button><button class="ghost" data-del="${i}" aria-label="${T.p2.del}">✕</button>
          ${r ? `<div class="result"><span class="${r.code === 0 ? 'ok' : 'bad'}">${r.running ? T.p2.running : r.code === 0 ? T.p2.pass((r.ms / 1000).toFixed(1)) : T.p2.fail(r.code)}</span>${r.code !== 0 && r.output ? `<pre>${esc(r.output)}</pre>` : ''}</div>` : ''}
        </div>`;
      }).join('')}
      <button id="add">${T.p2.add}</button>
      ${callout(T.p2.whyT, T.p2.whyB)}`,
    bind: () => {
      document.querySelectorAll('[data-check]').forEach((el) => (a.checks[el.dataset.check][el.dataset.k] = el.value.trim()));
    },
    blocked: () => '',
    events: {
      add: () => { a.checks.push({ label: '', command: '' }); },
      run: async (i) => {
        const cmd = a.checks[i].command;
        if (!cmd) return;
        results[cmd] = { running: true };
        draw();
        results[cmd] = await api('/api/run', { command: cmd });
      },
      del: (i) => { a.checks.splice(i, 1); },
    },
  },
  {
    render: () => `
      <h2>${T.p3.title}</h2>
      <p class="lead">${T.p3.lead}</p>
      <label class="f" for="run">${T.p3.run}${hint(T.optional)}</label><input type="text" class="mono" id="run" value="${esc(a.run.command)}" placeholder="${esc(T.p3.runPh)}">
      <label class="f" for="url">${T.p3.url}${hint(T.optional)}</label><input type="text" class="mono" id="url" value="${esc(a.run.url)}" placeholder="${esc(T.p3.urlPh)}">
      ${callout(T.p3.whyT, T.p3.whyB)}`,
    bind: () => { a.run = { command: $('#run').value.trim(), url: $('#url').value.trim() }; },
    blocked: () => '',
  },
  {
    render: () => `
      <h2>${T.p4.title}</h2>
      <p class="lead">${T.p4.lead}</p>
      <label class="f" for="noRead">${T.p4.noRead}${hint(T.p4.noReadHint)}</label>
      <textarea id="noRead">${esc(a.noRead.join('\n'))}</textarea>
      <label class="f" for="noEdit">${T.p4.noEdit}${hint(T.p4.noEditHint)}</label>
      <textarea id="noEdit">${esc(a.noEdit.join('\n'))}</textarea>
      <label class="f" for="deny">${T.p4.deny}${hint(T.p4.denyHint)}</label>
      <textarea id="deny" class="mono">${esc(a.denyCommands.join('\n'))}</textarea>
      <div class="chips">${['git push --force*', 'git reset --hard*', 'rm -rf *', 'npm publish*', 'docker system prune*'].filter((c) => !a.denyCommands.includes(c)).map((c) => `<button data-chip="${esc(c)}">+ ${esc(c)}</button>`).join('')}</div>
      ${callout(T.p4.limitT, T.p4.limitB)}`,
    bind: () => {
      a.noRead = lines($('#noRead').value);
      a.noEdit = lines($('#noEdit').value);
      a.denyCommands = lines($('#deny').value);
    },
    blocked: () => '',
    events: { chip: (c) => { a.denyCommands.push(c); } },
  },
  {
    render: () => `
      <h2>${T.p5.title}</h2>
      <p class="lead">${T.p5.lead}</p>
      <label class="toggle"><input type="checkbox" id="gate" ${a.gate ? 'checked' : ''}><div><h3>${T.p5.gateT}</h3><p>${T.p5.gateB}</p></div></label>
      <label class="toggle"><input type="checkbox" id="loop" ${a.loop ? 'checked' : ''}><div><h3>${T.p5.loopT}</h3><p>${T.p5.loopB}</p></div></label>
      <label class="f" for="max">${T.p5.max}${hint(T.p5.maxHint)}</label>
      <input type="number" id="max" min="1" max="10" value="${a.maxAttempts}" style="width:100px">
      ${diagram()}`,
    bind: () => {
      a.gate = $('#gate').checked;
      a.loop = $('#loop').checked;
      a.maxAttempts = Math.max(1, Math.min(10, +$('#max').value || 3));
    },
    blocked: () => '',
  },
  {
    render: () => installed
      ? `<div class="done"><h2>${T.done.title}</h2>
          <p>${installed.filter((f) => f.status !== 'same').map((f) => `<code>${esc(f.path)}</code>`).join(' ')}</p>
          <p>${T.done.next}</p><ol>${a.agents.map((k) => `<li>${T.done.agent[k]}</li>`).join('')}<li>${T.done.s1}</li>${a.loop ? `<li>${T.done.s2}</li>` : ''}${a.gate ? `<li>${T.done.s3}</li>` : ''}<li>${T.done.s4}</li></ol>
          <p class="hint">${T.done.close}</p></div>`
      : `
      <h2>${T.p6.title}</h2>
      <p class="lead">${T.p6.lead}</p>
      <p class="hint">${T.p6.langNote(LANGS[lang])}</p>
      <div class="files">
        <ul>${files.map((f, i) => `<li><button data-open="${i}" class="${i === openFile ? 'sel' : ''}"><span class="badge ${f.status}">${T.p6.status[f.status]}</span>${esc(f.path)}</button></li>`).join('')}</ul>
        <pre>${esc(files[openFile]?.content)}</pre>
      </div>`,
    bind: () => {},
    blocked: () => (a.gate && failing().length ? T.p6.gateBlocked(failing().map((c) => c.label || c.command).join(', ')) : broken.length ? `${T.p6.broken} ${broken.join(', ')}` : ''),
    events: { open: (i) => { openFile = +i; } },
  },
];

async function refreshPlan() {
  a.lang = lang;
  ({ files, broken } = await api('/api/plan', a));
  if (!files[openFile] || files[openFile].status === 'same') openFile = Math.max(0, files.findIndex((f) => f.status !== 'same'));
}

function draw() {
  const v = VIEWS[step];
  document.documentElement.lang = lang;
  $('#lang').innerHTML = Object.entries(LANGS).map(([k, n]) => `<button data-lang="${k}" class="${k === lang ? 'sel' : ''}" aria-pressed="${k === lang}">${n}</button>`).join('');
  $('#steps').innerHTML = T.steps.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}">${s}</li>`).join('');
  $('#main').innerHTML = v.render();
  const why = installed ? '' : error || v.blocked();
  const last = step === VIEWS.length - 1;
  $('#nav').innerHTML = installed ? '' : `
    <button class="ghost" id="prev" ${step === 0 ? 'disabled' : ''}>${T.prev}</button>
    <span class="why">${esc(why)}</span>
    <button class="primary" id="next" ${why && !error ? 'disabled' : ''}>${last ? T.install : T.next}</button>`;
}

// 언어를 바꾸면, 사람이 손대지 않은 기본 문구(검사 이름, 폴더 추정 설명)도 따라 바뀐다
function setLang(next) {
  const prev = T;
  lang = next;
  T = I18N[lang];
  localStorage.setItem('hk-lang', lang);
  for (const c of a.checks) if (c.kind && c.label === prev.p2.kinds[c.kind]) c.label = T.p2.kinds[c.kind];
  for (const d of a.dirs) if (d.auto && d.role) d.note = T.roles[d.role];
  a.rules = a.rules.map((r) => { const k = Object.keys(prev.rules).find((k) => prev.rules[k] === r); return k ? T.rules[k] : r; });
}

// 클릭은 한 곳에서: 입력값을 먼저 a에 반영한 뒤 동작
document.addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el || el.disabled) return;
  const v = VIEWS[step];
  if (!installed) v.bind();
  const [ev, arg] = Object.entries(el.dataset)[0] ?? [];
  error = '';
  try {
    if (ev === 'lang') { setLang(arg); if ((step === S.structure || step === S.review) && !installed) await refreshPlan(); }
    else if (el.id === 'prev') { step--; await VIEWS[step].enter?.(); }
    else if (el.id === 'next') {
      if (step === VIEWS.length - 1) { a.lang = lang; installed = await api('/api/install', a); }
      else { step++; await VIEWS[step].enter?.(); if (step === VIEWS.length - 1) await refreshPlan(); }
    } else if (el.id === 'add') v.events.add();
    else if (v.events?.[ev]) await v.events[ev](arg);
  } catch (err) {
    error = T.error(err.message);
  }
  draw();
});
// 구조 단계: 체크박스를 바꾸면 만들어질 파일 목록을 다시 계산 / 부품 단계: 구조도를 다시 그림
document.addEventListener('change', async (e) => {
  const structure = step === S.structure && ['kb', 'feat'].includes(e.target.id);
  const parts = step === S.parts && ['gate', 'loop', 'max'].includes(e.target.id);
  if (!structure && !parts) return;
  VIEWS[step].bind();
  if (structure) await refreshPlan();
  draw();
});
// 입력 중 '다음' 버튼 상태 갱신 (예: 이름을 지우면 비활성)
document.addEventListener('input', () => {
  VIEWS[step].bind();
  const why = VIEWS[step].blocked();
  $('#next')?.toggleAttribute('disabled', !!why);
  if ($('.why')) $('.why').textContent = why;
});

const { dir, detected: d, saved } = await api('/api/state').catch(() => ({}));
if (!d) {
  $('#main').innerHTML = `<h2>${T.noConnect[0]}</h2><p class="lead">${T.noConnect[1]}</p>`;
} else {
  $('#dir').textContent = dir;
  if (saved?.lang && !localStorage.getItem('hk-lang')) { lang = saved.lang; T = I18N[lang]; }
  hints = d.ruleHints;
  // 폴더: README/package.json 설명 > 이름으로 추정한 역할(auto) > 빈칸(안에 뭐가 있는지 placeholder로)
  const dirs = d.dirs.map((x) => (x.note ? { ...x, auto: false } : x.role ? { ...x, note: T.roles[x.role], auto: true } : { ...x, auto: false }));
  // 다시 실행하면 지난 답을, 처음이면 감지한 값을 기본값으로
  a = saved
    ? { agents: ['claude'], ...saved, checks: saved.checks.filter((c) => c.kind !== 'docs'), dirs: dirs.map((x) => { const s = saved.dirs?.find((s) => s.name === x.name); return s ? { ...x, note: s.note, auto: false } : x; }) }
    : {
        name: d.name, summary: d.summary, dirs, rules: [],
        checks: d.checks.map((c) => ({ ...c, label: T.p2.kinds[c.kind] })), run: d.run,
        noRead: d.protect.filter((p) => p.startsWith('.env')), noEdit: d.protect.filter((p) => !p.startsWith('.env')),
        denyCommands: ['git push --force*', 'git reset --hard*'],
        agents: ['claude'], kb: true, features: false,
        gate: d.checks.length > 0, loop: true, maxAttempts: 3,
      };
  draw();
}
