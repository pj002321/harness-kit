// 설치 마법사. 상태(a)는 .claude/harness.json 과 같은 모양이다.
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

const STEPS = ['프로젝트', '검증', '실행·확인', '금지 규칙', '부품', '미리보기'];
let step = 0, a, files = [], openFile = 0, installed = null, error = '';
const results = {}; // command → { code, ms, output } 마지막 실행 결과

const failing = () => a.checks.filter((c) => c.command && results[c.command]?.code !== 0);

// 각 단계: render() → HTML, bind() → 입력을 a에 반영, blocked() → 다음으로 못 가는 이유
const VIEWS = [
  {
    render: () => `
      <h2>이 프로젝트는 무엇인가요?</h2>
      <p class="lead">AI가 매 세션 처음 읽는 지도(AGENTS.md)가 됩니다. 짧고 정확할수록 잘 따릅니다.</p>
      <label class="f" for="name">이름</label><input type="text" id="name" value="${esc(a.name)}">
      <label class="f" for="summary">한 줄 소개</label><input type="text" id="summary" value="${esc(a.summary)}" placeholder="예: 소상공인용 예약 관리 웹 서비스">
      <label class="f">폴더 설명 <span class="hint">— 비워두면 이름만 실립니다</span></label>
      ${a.dirs.map((d, i) => `<div class="dirrow"><code>${esc(d.name)}/</code><input type="text" data-dir="${i}" value="${esc(d.note)}" placeholder="무엇이 있는 곳인가요?"></div>`).join('') || '<p class="hint">하위 폴더가 없습니다.</p>'}
      <label class="f" for="rules">팀 규칙 <span class="hint">— 한 줄에 하나</span></label>
      <textarea id="rules" placeholder="예: API 응답은 항상 { data, error } 형태로&#10;새 의존성은 추가 전에 물어볼 것">${esc(a.rules.join('\n'))}</textarea>`,
    bind: () => {
      a.name = $('#name').value.trim();
      a.summary = $('#summary').value.trim();
      document.querySelectorAll('[data-dir]').forEach((el) => (a.dirs[el.dataset.dir].note = el.value.trim()));
      a.rules = lines($('#rules').value);
    },
    blocked: () => (!a.name ? '이름을 적어주세요.' : ''),
  },
  {
    render: () => `
      <h2>"완료"는 무엇으로 판정하나요?</h2>
      <p class="lead">여기 적은 명령이 <b>완료 게이트</b>가 됩니다. AI가 작업을 끝내려 할 때 자동으로 실행되고, 하나라도 실패하면 끝낼 수 없습니다.</p>
      ${a.checks.map((c, i) => {
        const r = results[c.command];
        return `<div class="row">
          <input type="text" data-check="${i}" data-k="label" value="${esc(c.label)}" aria-label="검사 이름">
          <input type="text" class="mono" data-check="${i}" data-k="command" value="${esc(c.command)}" aria-label="명령">
          <button data-run="${i}">▶ 실행</button><button class="ghost" data-del="${i}" aria-label="삭제">✕</button>
          ${r ? `<div class="result"><span class="${r.code === 0 ? 'ok' : 'bad'}">${r.running ? '실행 중…' : r.code === 0 ? `✓ 통과 (${(r.ms / 1000).toFixed(1)}s)` : `✗ 실패 (exit ${r.code})`}</span>${r.code !== 0 && r.output ? `<pre>${esc(r.output)}</pre>` : ''}</div>` : ''}
        </div>`;
      }).join('')}
      <button id="add">+ 검사 추가</button>
      <div class="callout"><b>왜 여기서 실행해보나요?</b>깨진 명령을 게이트로 걸면 AI는 영원히 작업을 끝낼 수 없습니다. 설치 전에 지금 통과하는지 확인해야 합니다.</div>`,
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
      <h2>앱은 어떻게 띄우고 확인하나요?</h2>
      <p class="lead">Evaluator가 코드만 읽지 않고 <b>실제로 띄워서 두드려보는</b> 방법입니다. 라이브러리처럼 띄울 것이 없으면 비워두세요.</p>
      <label class="f" for="run">실행 명령</label><input type="text" class="mono" id="run" value="${esc(a.run.command)}" placeholder="예: npm run dev">
      <label class="f" for="url">확인 주소</label><input type="text" class="mono" id="url" value="${esc(a.run.url)}" placeholder="예: http://localhost:3000">
      <div class="callout"><b>원문에서</b>Anthropic의 Evaluator는 Playwright로 실행 중인 앱을 직접 클릭해 보고 채점했습니다. 코드를 읽는 것만으로는 "되는 것처럼 보이는" 기능을 걸러내지 못했기 때문입니다.</div>`,
    bind: () => { a.run = { command: $('#run').value.trim(), url: $('#url').value.trim() }; },
    blocked: () => '',
  },
  {
    render: () => `
      <h2>AI가 하면 안 되는 것</h2>
      <p class="lead">프롬프트로 부탁하는 대신 <b>권한 규칙으로 막습니다</b>. 경로는 .gitignore 형식, 한 줄에 하나.</p>
      <label class="f" for="noRead">읽기·수정 금지 <span class="hint">— 비밀이 담긴 파일</span></label>
      <textarea id="noRead">${esc(a.noRead.join('\n'))}</textarea>
      <label class="f" for="noEdit">수정 금지 <span class="hint">— 마이그레이션, 생성된 파일, 잠금 파일</span></label>
      <textarea id="noEdit">${esc(a.noEdit.join('\n'))}</textarea>
      <label class="f" for="deny">금지 명령 <span class="hint">— * 는 와일드카드</span></label>
      <textarea id="deny" class="mono">${esc(a.denyCommands.join('\n'))}</textarea>
      <div class="chips">${['git push --force*', 'git reset --hard*', 'rm -rf *', 'npm publish*', 'docker system prune*'].map((c) => `<button data-chip="${esc(c)}">+ ${esc(c)}</button>`).join('')}</div>
      <div class="callout"><b>한계</b>이 규칙은 Claude Code의 파일 도구와 셸 리다이렉트(<code>&gt; file</code>)까지 막지만, 스크립트가 내부에서 파일을 여는 것까지는 막지 못합니다. 완전 차단이 필요하면 Claude Code 샌드박스를 함께 켜세요.</div>`,
    bind: () => {
      a.noRead = lines($('#noRead').value);
      a.noEdit = lines($('#noEdit').value);
      a.denyCommands = lines($('#deny').value);
    },
    blocked: () => '',
    events: { chip: (c) => { if (!a.denyCommands.includes(c)) a.denyCommands.push(c); } },
  },
  {
    render: () => `
      <h2>어떤 부품을 켤까요?</h2>
      <p class="lead">작게 시작해도 됩니다. 원문의 교훈: 모든 부품은 "모델이 혼자 못 하는 것"에 대한 가정이니, 필요한 것만 켜고 효과를 확인하세요.</p>
      <label class="toggle"><input type="checkbox" id="gate" ${a.gate ? 'checked' : ''}>
        <div><h3>완료 게이트</h3><p>작업을 끝낼 때 검증 명령을 자동 실행하고, 실패하면 끝내지 못하게 막습니다. AI가 게이트 설정을 고쳐 우회하지 못하도록 설정 파일도 잠급니다.</p></div></label>
      <label class="toggle"><input type="checkbox" id="loop" ${a.loop ? 'checked' : ''}>
        <div><h3>Planner → Generator ⇄ Evaluator 루프</h3><p><code>/harness-feature &lt;기능&gt;</code> 명령. 계획 → 스프린트별 완료 기준 합의(계약) → 구현 → <b>코드를 수정할 수 없는</b> Evaluator가 실제 실행으로 검증 → 실패하면 재시도.</p></div></label>
      <label class="f" for="max">재시도 상한 <span class="hint">— 스프린트 하나가 이만큼 실패하면 멈추고 사람에게 보고</span></label>
      <input type="number" id="max" min="1" max="10" value="${a.maxAttempts}" style="width:100px">`,
    bind: () => {
      a.gate = $('#gate').checked;
      a.loop = $('#loop').checked;
      a.maxAttempts = Math.max(1, Math.min(10, +$('#max').value || 3));
    },
    blocked: () => '',
  },
  {
    render: () => installed
      ? `<div class="done"><h2>✓ 설치했습니다</h2>
          <p>${installed.filter((f) => f.status !== 'same').map((f) => `<code>${esc(f.path)}</code>`).join(' ')}</p>
          <p>다음:</p><ol>
            <li>이 폴더에서 <code>claude</code> 를 실행합니다. AGENTS.md를 지도로 읽습니다.</li>
            ${a.loop ? '<li>기능을 맡길 땐 <code>/harness-feature 로그인 기능 추가</code> 처럼 입력합니다.</li>' : ''}
            ${a.gate ? '<li>AI가 작업을 끝내려 하면 검증 명령이 자동으로 돕니다. 실패하면 AI가 계속 고칩니다.</li>' : ''}
            <li>설정을 바꾸려면 <code>npx harness-kit</code> 을 다시 실행하세요. 지금 답이 미리 채워집니다.</li>
          </ol><p class="hint">이 창은 닫아도 됩니다.</p></div>`
      : `
      <h2>설치될 파일</h2>
      <p class="lead">기존 파일은 덮어쓰지 않습니다. AGENTS.md·CLAUDE.md는 관리 블록만, settings.json은 하네스 항목만 바뀝니다.</p>
      <div class="files">
        <ul>${files.map((f, i) => `<li><button data-open="${i}" class="${i === openFile ? 'sel' : ''}"><span class="badge ${f.status}">${{ new: '새 파일', update: '변경', same: '그대로' }[f.status]}</span>${esc(f.path)}</button></li>`).join('')}</ul>
        <pre>${esc(files[openFile]?.content)}</pre>
      </div>`,
    bind: () => {},
    blocked: () => (a.gate && failing().length ? `완료 게이트를 켰는데 통과하지 않은 검사가 있습니다: ${failing().map((c) => c.label || c.command).join(', ')} — 2단계에서 실행해 통과시키거나, 5단계에서 게이트를 끄세요.` : ''),
    events: { open: (i) => { openFile = +i; } },
  },
];

function draw() {
  const v = VIEWS[step];
  $('#steps').innerHTML = STEPS.map((s, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}">${s}</li>`).join('');
  $('#main').innerHTML = v.render();
  const why = installed ? '' : error || v.blocked();
  const last = step === STEPS.length - 1;
  $('#nav').innerHTML = installed ? '' : `
    <button class="ghost" id="prev" ${step === 0 ? 'disabled' : ''}>← 이전</button>
    <span class="why">${esc(why)}</span>
    <button class="primary" id="next" ${why ? 'disabled' : ''}>${last ? '설치' : '다음 →'}</button>`;
}

// 클릭은 한 곳에서: 입력값을 먼저 a에 반영한 뒤 동작
document.addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el || el.disabled) return;
  const v = VIEWS[step];
  v.bind();
  const [ev, arg] = Object.entries(el.dataset)[0] ?? [];
  error = '';
  try {
    if (el.id === 'prev') step--;
    else if (el.id === 'next') {
      if (step === STEPS.length - 1) installed = await api('/api/install', a);
      else if (++step === STEPS.length - 1) { files = await api('/api/plan', a); openFile = files.findIndex((f) => f.status !== 'same'); }
    } else if (el.id === 'add') v.events.add();
    else if (v.events?.[ev]) await v.events[ev](arg);
  } catch (err) {
    error = `오류: ${err.message}`;
  }
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
  $('#main').innerHTML = '<h2>연결할 수 없습니다</h2><p class="lead">터미널에 출력된 주소(#토큰 포함)로 다시 열어주세요.</p>';
} else {
  $('#dir').textContent = dir;
  // 다시 실행하면 지난 답을, 처음이면 감지한 값을 기본값으로
  a = saved ?? {
    name: d.name, summary: d.summary, dirs: d.dirs, rules: [],
    checks: d.checks, run: d.run,
    noRead: d.protect.filter((p) => p.startsWith('.env')), noEdit: d.protect.filter((p) => !p.startsWith('.env')),
    denyCommands: ['git push --force*', 'git reset --hard*'],
    gate: d.checks.length > 0, loop: true, maxAttempts: 3,
  };
  if (saved) a.dirs = d.dirs.map((x) => saved.dirs?.find((s) => s.name === x.name) ?? x); // 폴더가 늘거나 줄었을 수 있다
  draw();
}
