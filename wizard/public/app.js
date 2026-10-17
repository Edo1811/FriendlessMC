const $ = (id) => document.getElementById(id);
const sections = [...document.querySelectorAll('section[data-step]')];
const choice = { dir: '', world: null, version: null, worldVersion: null };

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- step navigation ----
let current = 0;
function show(step) {
  current = step;
  sections.forEach((s) => (s.hidden = Number(s.dataset.step) !== step));
  $('steps').innerHTML = sections
    .map((_, i) => `<li class="${i < step ? 'past' : i === step ? 'current' : ''}"></li>`)
    .join('');
  onEnter[step]?.();
}
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => show(current - 1)));

const onEnter = {};

// ---- 1. check ----
const FIXES = {
  java: 'Get Java 21 or newer (Java 25 recommended) from <a href="https://adoptium.net" target="_blank" rel="noreferrer">adoptium.net</a>, then check again.',
  node: 'Get Node.js 20 or newer from <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a>.',
  claude: 'Open a terminal and run <code>npm install -g @anthropic-ai/claude-code</code>, then check again.',
};
const LABELS = { java: 'Java (for the server)', node: 'Node.js (for the bot)', claude: 'Claude Code (to sign in to Claude)' };

async function runChecks() {
  $('checks').innerHTML = '<li>Checking...</li>';
  $('next0').disabled = true;
  const checks = await api('/api/check');
  $('checks').innerHTML = Object.entries(checks)
    .map(([key, c]) => `<li class="${c.ok ? 'ok' : 'bad'}"><b>${LABELS[key]}</b>: ${escapeHtml(c.detail)}${
      c.ok ? '' : `<span class="fix">${FIXES[key]}</span>`}</li>`)
    .join('');
  $('next0').disabled = !Object.values(checks).every((c) => c.ok);
}
$('recheck').addEventListener('click', runChecks);
$('next0').addEventListener('click', () => show(1));
onEnter[0] = runChecks;

// ---- 2. world ----
async function loadWorlds() {
  const list = $('worlds');
  list.innerHTML = '<p class="status">Looking for worlds...</p>';
  try {
    const { dir, worlds } = await api(`/api/worlds?dir=${encodeURIComponent($('savesDir').value)}`);
    $('savesDir').value = dir;
    choice.dir = dir;
    if (!worlds.length) {
      list.innerHTML = '<p class="status bad">No worlds found here. If your launcher keeps worlds somewhere else, paste that saves folder above.</p>';
      return;
    }
    list.innerHTML = '';
    for (const w of worlds) {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.innerHTML = `<span><b>${escapeHtml(w.name)}</b><br><span class="meta">${escapeHtml(w.folder)}</span></span>
        <span class="meta">${escapeHtml(w.version ?? 'unknown version')}<br>${
          w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : ''}</span>`;
      btn.disabled = Boolean(w.unreadable);
      btn.addEventListener('click', () => {
        list.querySelectorAll('.option').forEach((o) => o.classList.remove('selected'));
        btn.classList.add('selected');
        choice.world = w.folder;
        choice.worldName = w.name;
        $('next1').disabled = false;
      });
      list.append(btn);
    }
  } catch (err) {
    list.innerHTML = `<p class="status bad">${escapeHtml(err.message)}</p>`;
  }
}
$('reloadWorlds').addEventListener('click', loadWorlds);
$('next1').addEventListener('click', () => show(2));
onEnter[1] = () => { if (!$('worlds').children.length) loadWorlds(); };

// ---- 3. version ----
async function loadVersions() {
  const list = $('versions');
  list.innerHTML = '<p class="status">Asking Paper which versions exist...</p>';
  $('next2').disabled = true;
  try {
    const { worldVersion, choices } = await api(
      `/api/versions?dir=${encodeURIComponent(choice.dir)}&world=${encodeURIComponent(choice.world)}`,
    );
    choice.worldVersion = worldVersion;
    list.innerHTML = '';
    if (!choices.length) list.innerHTML = '<p class="status bad">No version is supported by both Paper and the bot.</p>';
    const select = (c, btn) => {
      list.querySelectorAll('.option').forEach((o) => o.classList.remove('selected'));
      btn.classList.add('selected');
      choice.version = c.version;
      $('versionWarning').hidden = c.relation !== 'newer';
      $('next2').disabled = false;
    };
    const tags = { same: 'same as your world', newer: 'newer: upgrades the copy', older: "older: can break the world", unknown: '' };
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.disabled = !c.allowed;
      btn.innerHTML = `<b>${escapeHtml(c.version)}</b>${tags[c.relation] ? `<span class="tag ${c.relation}">${tags[c.relation]}</span>` : ''}`;
      btn.addEventListener('click', () => select(c, btn));
      list.append(btn);
      if (c.selected) select(c, btn);
    }
  } catch (err) {
    list.innerHTML = `<p class="status bad">${escapeHtml(err.message)}</p>`;
  }
}
$('next2').addEventListener('click', () => show(3));
onEnter[2] = loadVersions;

// ---- 4. server ----
$('next3').addEventListener('click', () => {
  if (!/^[A-Za-z0-9_]{3,16}$/.test($('owner').value.trim())) {
    $('owner').focus();
    $('owner').style.borderColor = 'var(--bad)';
    return;
  }
  show(4);
});

// ---- 5. EULA + build ----
$('eula').addEventListener('change', () => ($('build').disabled = !$('eula').checked));
$('build').addEventListener('click', async () => {
  $('build').disabled = true;
  const log = $('buildLog');
  log.hidden = false;
  log.textContent = '';
  try {
    await api('/api/setup', {
      dir: choice.dir,
      world: choice.world,
      version: choice.version,
      owner: $('owner').value.trim(),
      ops: $('ops').value.split('\n'),
      eula: $('eula').checked,
    });
    const job = await pollJob((lines) => (log.textContent = lines.join('\n')));
    if (job.error) throw new Error(job.error);
    show(5);
  } catch (err) {
    log.innerHTML += `\n<span class="error">${escapeHtml(err.message)}</span>`;
    $('build').disabled = false;
  }
});

async function pollJob(onLog) {
  for (;;) {
    const job = await api('/api/progress');
    onLog(job.log);
    if (!job.running) return job;
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ---- 6. .claude ----
$('next5').addEventListener('click', () => show(6));

// ---- 7. login ----
async function refreshLogin() {
  const status = await api('/api/login/status');
  const el = $('loginStatus');
  if (status.auth === 'apiKey') {
    el.textContent = 'Using your API key.';
    el.className = 'status ok';
  } else if (status.loggedIn) {
    el.textContent = 'Signed in to Claude.';
    el.className = 'status ok';
  } else {
    el.textContent = 'Not signed in yet.';
    el.className = 'status bad';
  }
  $('next6').disabled = !(status.loggedIn || status.auth === 'apiKey');
}
$('login').addEventListener('click', async () => {
  await api('/api/login', {});
  $('loginStatus').textContent = 'Finish signing in in the window that opened, then press "check again".';
});
$('loginRefresh').addEventListener('click', refreshLogin);
$('saveKey').addEventListener('click', async () => {
  await api('/api/apikey', { key: $('apiKey').value });
  refreshLogin();
});
$('next6').addEventListener('click', () => show(7));
onEnter[6] = refreshLogin;

// ---- 8. shortcut ----
$('shortcut').addEventListener('click', async () => {
  const el = $('shortcutStatus');
  try {
    const { path } = await api('/api/shortcut', {});
    el.textContent = `Created ${path}`;
    el.className = 'status ok';
    $('finalVersion').textContent = choice.version;
    $('finished').hidden = false;
  } catch (err) {
    el.textContent = err.message;
    el.className = 'status bad';
  }
});

show(0);
