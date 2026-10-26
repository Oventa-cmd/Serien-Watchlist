/* Als Nächstes – Watchlist für Serien & Filme
   Daten: TMDB (Titel, Bilder, Anbieter, Empfehlungen) · Sync: Supabase */
(() => {
'use strict';

const CFG = window.APP_CONFIG || {};
const STATUSES = [
  { id: 'planned',  label: 'Geplant',     color: 'var(--planned)' },
  { id: 'watching', label: 'Am Gucken',   color: 'var(--watching)' },
  { id: 'done',     label: 'Fertig',      color: 'var(--done)' },
  { id: 'dropped',  label: 'Abgebrochen', color: 'var(--dropped)' },
];
const ST = Object.fromEntries(STATUSES.map(s => [s.id, s]));
const IMG = 'https://image.tmdb.org/t/p/';
const TV_STATUS = { 'Returning Series': 'Läuft noch', 'Ended': 'Beendet', 'Canceled': 'Abgesetzt', 'In Production': 'In Produktion', 'Planned': 'Geplant', 'Pilot': 'Pilot' };

const S = {
  sb: null, user: null, tmdbKey: null,
  items: new Map(),
  filter: 'all',
  curView: null, lastView: 'home',
  detail: null,
  recs: null, recsSig: null, recsPromise: null,
  trending: null,
  search: { q: '', results: null, loading: false, seq: 0 },
  lastSync: 0, sortables: [], navigated: false,
};
const timers = new Map();
const tmdbCache = new Map();

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = (type, id) => `${type}:${id}`;
const kOf = it => key(it.media_type, it.tmdb_id);
const img = (p, size) => p ? IMG + (p.endsWith('.svg') ? 'original' : size) + p : '';
const year = c => (c.release_date || c.first_air_date || '').slice(0, 4);
const nameOf = c => c.title || c.name || c.original_title || c.original_name || '';
const typeLabel = t => t === 'tv' ? 'Serie' : 'Film';
const fmtDate = d => d ? new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : '';
const fmtNum = (n, dig = 1) => Number(n).toFixed(dig).replace('.', ',');
const today = () => new Date().toISOString().slice(0, 10);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const byPos = (a, b) => (a.position - b.position) || String(a.added_at).localeCompare(String(b.added_at));

const svg = (inner, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inner}</svg>`;
const I = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  list: svg('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>', 'stroke-width="3"'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  grip: svg('<circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/>', 'stroke="none"'),
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5L2.6 9.4l6.5-.8z"/></svg>',
  top: svg('<path d="M12 19V7M6 12l6-6 6 6M5 3h14"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>'),
};

function toast(msg, type = '', action) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); el.remove(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), action ? 6000 : 3500);
}

/* ---------- TMDB ---------- */
function tmdb(path, params = {}, apiKey = S.tmdbKey) {
  const url = new URL('https://api.themoviedb.org/3' + path);
  const p = { language: 'de-DE', ...params };
  const headers = { accept: 'application/json' };
  if (apiKey && apiKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + apiKey;
  else p.api_key = apiKey;
  for (const [k, v] of Object.entries(p)) if (v != null) url.searchParams.set(k, v);
  const ck = url.toString();
  if (tmdbCache.has(ck)) return tmdbCache.get(ck);
  const pr = fetch(url, { headers }).then(async r => {
    if (!r.ok) {
      const e = new Error(r.status === 401 ? 'Der TMDB-Schlüssel ist ungültig. Prüfe ihn in den Einstellungen.' : `TMDB antwortet mit Fehler ${r.status}.`);
      e.status = r.status; throw e;
    }
    return r.json();
  });
  tmdbCache.set(ck, pr);
  pr.catch(() => tmdbCache.delete(ck));
  return pr;
}

async function getDetails(type, id) {
  const d = await tmdb(`/${type}/${id}`, {
    append_to_response: `images,watch/providers,recommendations,videos,${type === 'tv' ? 'aggregate_credits' : 'credits'}`,
    include_image_language: 'de,en,null',
    include_video_language: 'de,en',
  });
  if (!d.overview) {
    try { d.overview = (await tmdb(`/${type}/${id}`, { language: 'en-US' })).overview; } catch {}
  }
  return d;
}

function pickLogo(logos = []) {
  const rank = l => (l.iso_639_1 === 'de' ? 3 : l.iso_639_1 === 'en' ? 2 : l.iso_639_1 == null ? 1 : 0);
  const best = [...logos].sort((a, b) => rank(b) - rank(a) || b.vote_average - a.vote_average)[0];
  return best && rank(best) > 0 ? best.file_path : null;
}

function providersDE(d) { return d?.['watch/providers']?.results?.DE || null; }

function itemFromDetails(type, d) {
  const meta = {
    year: year(d),
    genres: (d.genres || []).map(g => g.name).slice(0, 3),
    prov: (providersDE(d)?.flatrate || []).slice(0, 3).map(p => ({ n: p.provider_name, l: p.logo_path })),
  };
  if (type === 'tv') {
    meta.seasons = (d.seasons || []).filter(s => s.season_number > 0 && s.episode_count > 0).map(s => [s.season_number, s.episode_count]);
    const last = d.last_episode_to_air;
    meta.aired = last ? [last.season_number, last.episode_number] : [0, 0];
    meta.tv_status = d.status || null;
  } else {
    meta.runtime = d.runtime || null;
  }
  return {
    media_type: type, tmdb_id: d.id, title: nameOf(d),
    poster_path: d.poster_path || null, backdrop_path: d.backdrop_path || null,
    logo_path: pickLogo(d.images?.logos), meta,
  };
}

/* Folgen-Statistik einer Serie */
function airedIn(meta, s, c) {
  const a = meta?.aired;
  if (!a) return c;
  if (s < a[0]) return c;
  if (s === a[0]) return Math.min(c, a[1]);
  return 0;
}
function epStats(it) {
  const seasons = it.meta?.seasons || [];
  let total = 0, done = 0, next = null;
  for (const [s, c] of seasons) {
    const n = airedIn(it.meta, s, c);
    const w = new Set(it.progress?.[s] || []);
    for (let e = 1; e <= n; e++) { total++; if (w.has(e)) done++; else if (!next) next = [s, e]; }
  }
  return { total, done, next, pct: total ? done / total : 0 };
}
const epLabel = ([s, e]) => `S${s} · F${e}`;

/* ---------- Speichern ---------- */
function rowOf(it) {
  return {
    user_id: S.user.id, media_type: it.media_type, tmdb_id: it.tmdb_id, title: it.title,
    poster_path: it.poster_path, backdrop_path: it.backdrop_path, logo_path: it.logo_path,
    status: it.status, position: it.position, rating: it.rating ?? null, note: it.note ?? null,
    progress: it.progress || {}, meta: it.meta || {},
    added_at: it.added_at, updated_at: it.updated_at,
  };
}
function saveLocal() { if (S.user) lsSet('an_items_' + S.user.id, JSON.stringify([...S.items.values()])); }
function loadLocal() {
  try {
    const arr = JSON.parse(lsGet('an_items_' + S.user.id) || '[]');
    S.items = new Map(arr.map(r => [kOf(r), r]));
  } catch { S.items = new Map(); }
}

function save(it, ms = 450) {
  it.updated_at = new Date().toISOString();
  const k = kOf(it);
  S.items.set(k, it);
  saveLocal();
  scheduleRender();
  clearTimeout(timers.get(k));
  timers.set(k, setTimeout(async () => {
    timers.delete(k);
    const cur = S.items.get(k);
    if (!cur) return;
    const { error } = await S.sb.from('items').upsert(rowOf(cur));
    if (error) toast('Konnte nicht speichern: ' + error.message, 'err');
  }, ms));
}

async function removeItem(it) {
  const k = kOf(it);
  clearTimeout(timers.get(k)); timers.delete(k);
  S.items.delete(k);
  saveLocal(); scheduleRender(); refreshDetail();
  toast(`„${it.title}“ entfernt`, '', { label: 'Rückgängig', fn: () => { save({ ...it }, 0); refreshDetail(); } });
  const { error } = await S.sb.from('items').delete().match({ user_id: S.user.id, media_type: it.media_type, tmdb_id: it.tmdb_id });
  if (error) toast('Konnte nicht löschen: ' + error.message, 'err');
}

function inStatus(st) { return [...S.items.values()].filter(i => i.status === st).sort(byPos); }
function endPos(st, front = false) {
  const list = inStatus(st);
  if (!list.length) return 0;
  return front ? list[0].position - 1 : list[list.length - 1].position + 1;
}

async function addItem(type, id, status = 'planned', silent = false) {
  const k = key(type, id);
  if (S.items.has(k)) { if (!silent) toast('Steht schon auf deiner Liste'); return S.items.get(k); }
  try {
    const d = S.detail?.data && S.detail.type === type && S.detail.id === id ? S.detail.data : await getDetails(type, id);
    const now = new Date().toISOString();
    const it = { ...itemFromDetails(type, d), status, position: endPos(status), rating: null, note: null, progress: {}, added_at: now };
    save(it, 0);
    if (!silent) toast(`„${it.title}“ hinzugefügt`, '', { label: 'Ansehen', fn: () => { location.hash = `#/${type}/${id}`; } });
    return it;
  } catch (e) { toast(e.message, 'err'); return null; }
}

function setStatus(it, status) {
  if (it.status === status) return;
  const next = { ...it, status, position: endPos(status) };
  save(next);
  toast(`Verschoben nach „${ST[status].label}“`);
}

function toggleEpisodes(it, s, eps, on) {
  const p = { ...(it.progress || {}) };
  const set = new Set(p[s] || []);
  eps.forEach(e => on ? set.add(e) : set.delete(e));
  if (set.size) p[s] = [...set].sort((a, b) => a - b); else delete p[s];
  const next = { ...it, progress: p };
  if (on && it.status === 'planned') { next.status = 'watching'; next.position = endPos('watching', true); }
  const st = epStats(next);
  if (on && st.total && st.done >= st.total && ['Ended', 'Canceled'].includes(next.meta?.tv_status) && next.status !== 'done') {
    next.status = 'done'; next.position = endPos('done', true);
    toast(`Alle Folgen gesehen – „${next.title}“ ist jetzt fertig`);
  }
  save(next);
  return next;
}

/* ---------- Supabase / Auth ---------- */
function initSupabase() {
  if (!CFG.supabaseUrl || CFG.supabaseUrl.includes('DEIN-PROJEKT') || !CFG.supabaseKey || CFG.supabaseKey.startsWith('DEIN')) return 'config';
  if (!window.supabase?.createClient) return 'lib';
  S.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return 'ok';
}

async function boot() {
  const res = initSupabase();
  if (res !== 'ok') { renderConfigMissing(res); return; }
  S.sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_OUT') { S.user = null; S.items = new Map(); S.tmdbKey = null; renderAuth(); }
    else if (session && (!S.user || S.user.id !== session.user.id)) { S.user = session.user; setTimeout(afterLogin, 0); }
  });
  const { data } = await S.sb.auth.getSession();
  if (data.session) { if (!S.user) { S.user = data.session.user; afterLogin(); } }
  else if (!S.user) renderAuth();
}

let loginRun = 0;
async function afterLogin() {
  const run = ++loginRun;
  loadLocal();
  S.tmdbKey = lsGet('an_tmdb_' + S.user.id);
  if (S.tmdbKey) startApp();
  const { data, error } = await S.sb.from('settings').select('tmdb_key').maybeSingle();
  if (run !== loginRun) return;
  if (error) {
    if (!S.tmdbKey) renderGateError('Die Datenbank antwortet nicht wie erwartet. Hast du das SQL aus „supabase.sql“ im Supabase-SQL-Editor ausgeführt?', error.message);
    return;
  }
  const remote = data?.tmdb_key;
  if (remote && remote !== S.tmdbKey) { S.tmdbKey = remote; lsSet('an_tmdb_' + S.user.id, remote); startApp(); }
  else if (!remote && !S.tmdbKey) renderKeySetup();
  else if (!remote && S.tmdbKey) S.sb.from('settings').upsert({ user_id: S.user.id, tmdb_key: S.tmdbKey });
}

function startApp() {
  if (!$('#view')) renderShell();
  route();
  syncItems();
}

async function syncItems() {
  if ([...timers.keys()].length) return;
  const { data, error } = await S.sb.from('items').select('*');
  if (error) { toast('Liste konnte nicht geladen werden: ' + error.message, 'err'); return; }
  S.items = new Map(data.map(r => [kOf(r), r]));
  S.lastSync = Date.now();
  saveLocal();
  renderView();
  refreshDetail();
}

async function saveKey(k) {
  k = k.trim();
  if (!k) throw new Error('Bitte gib deinen TMDB-Schlüssel ein.');
  try { await tmdb('/configuration', {}, k); }
  catch (e) { throw new Error(e.status === 401 ? 'Dieser Schlüssel wird von TMDB nicht akzeptiert. Kopiere den „API-Schlüssel“ oder das „API-Lesezugriffstoken“ erneut.' : 'TMDB ist gerade nicht erreichbar. Versuch es gleich noch einmal.'); }
  const { error } = await S.sb.from('settings').upsert({ user_id: S.user.id, tmdb_key: k, updated_at: new Date().toISOString() });
  if (error) throw new Error('Speichern fehlgeschlagen: ' + error.message);
  S.tmdbKey = k; lsSet('an_tmdb_' + S.user.id, k);
  tmdbCache.clear(); S.recs = null; S.recsSig = null; S.trending = null;
}

/* ---------- Gates (Login, Setup) ---------- */
const bulbs = n => `<span class="bulbs">${'<i></i>'.repeat(n)}</span>`;

function renderConfigMissing(why) {
  document.body.style.overflow = '';
  $('#app').innerHTML = `
  <section class="gate"><div class="marquee-bg"></div><div class="gate-card">
    <h1 class="gate-title">${bulbs(7)}Als<br>Nächstes</h1>
    ${why === 'lib'
      ? `<p>Die Supabase-Bibliothek konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.</p>`
      : `<p>Fast startklar. Trag in der Datei <b>config.js</b> deine Supabase-Projekt-URL und den Publishable- bzw. Anon-Key ein und lade die Datei neu hoch.</p>
         <ol class="steps"><li>Supabase → Project Settings → API</li><li>Project URL und Publishable Key kopieren</li><li>In config.js einfügen, speichern, hochladen</li></ol>`}
  </div></section>`;
}

function renderGateError(msg, detail) {
  $('#app').innerHTML = `
  <section class="gate"><div class="marquee-bg"></div><div class="gate-card">
    <h1 class="gate-title">${bulbs(7)}Kurze<br>Pause</h1>
    <p>${esc(msg)}</p>
    ${detail ? `<p class="attrib">${esc(detail)}</p>` : ''}
    <div class="actions"><button class="btn primary" id="retry">Erneut versuchen</button><button class="btn" id="logout">Abmelden</button></div>
  </div></section>`;
  $('#retry').onclick = () => afterLogin();
  $('#logout').onclick = () => S.sb.auth.signOut();
}

function renderAuth(mode = 'login') {
  document.body.style.overflow = '';
  $('#sheet-root')?.remove();
  $('#app').innerHTML = `
  <section class="gate"><div class="marquee-bg"></div><div class="gate-card">
    <h1 class="gate-title">${bulbs(7)}Als<br>Nächstes</h1>
    <p>Deine Serien und Filme in einer Reihenfolge, die du festlegst. Auf jedem Gerät gleich.</p>
    <form class="form" id="auth-form" novalidate>
      <div class="field"><label for="email">E-Mail</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Passwort</label><input id="pw" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="6" required></div>
      <div class="err" id="auth-err" hidden></div>
      <button class="btn primary" type="submit" id="auth-submit">${mode === 'login' ? 'Anmelden' : 'Konto erstellen'}</button>
    </form>
    <p>${mode === 'login' ? 'Noch kein Konto?' : 'Schon ein Konto?'} <button class="linkbtn" id="auth-toggle">${mode === 'login' ? 'Konto erstellen' : 'Anmelden'}</button></p>
  </div></section>`;
  $('#auth-toggle').onclick = () => renderAuth(mode === 'login' ? 'signup' : 'login');
  $('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const email = $('#email').value.trim(), password = $('#pw').value;
    const err = $('#auth-err'), btn = $('#auth-submit');
    err.hidden = true;
    if (!email || password.length < 6) { err.textContent = 'Gib deine E-Mail und ein Passwort mit mindestens 6 Zeichen ein.'; err.hidden = false; return; }
    btn.disabled = true;
    const { data, error } = mode === 'login'
      ? await S.sb.auth.signInWithPassword({ email, password })
      : await S.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    btn.disabled = false;
    if (error) {
      const m = error.message || '';
      err.textContent = /invalid login/i.test(m) ? 'E-Mail oder Passwort stimmt nicht.'
        : /not confirmed/i.test(m) ? 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Mail.'
        : /already registered/i.test(m) ? 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.'
        : m;
      err.hidden = false; return;
    }
    if (mode === 'signup' && !data.session) {
      err.textContent = 'Fast geschafft: Bestätige deine E-Mail über den Link, den Supabase dir geschickt hat. Danach kannst du dich anmelden.';
      err.style.color = 'var(--done)'; err.hidden = false;
    }
  };
}

function renderKeySetup() {
  $('#app').innerHTML = `
  <section class="gate"><div class="marquee-bg"></div><div class="gate-card">
    <h1 class="gate-title">${bulbs(7)}Noch ein<br>Schlüssel</h1>
    <p>Die App holt Titel, Bilder und Empfehlungen von TMDB. Dafür brauchst du einmalig deinen kostenlosen Schlüssel. Er wird in deinem Konto gespeichert, auf weiteren Geräten musst du ihn nicht erneut eingeben.</p>
    <ol class="steps">
      <li>Auf <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org/settings/api</a> anmelden</li>
      <li>„API-Schlüssel“ (v3) oder „API-Lesezugriffstoken“ kopieren</li>
      <li>Hier einfügen</li>
    </ol>
    <form class="form" id="key-form" novalidate>
      <div class="field"><label for="tmdb-key">TMDB-Schlüssel</label><input id="tmdb-key" autocomplete="off" spellcheck="false"></div>
      <div class="err" id="key-err" hidden></div>
      <button class="btn primary" type="submit" id="key-submit">Prüfen und speichern</button>
    </form>
    <p><button class="linkbtn" id="logout">Abmelden</button></p>
  </div></section>`;
  $('#logout').onclick = () => S.sb.auth.signOut();
  $('#key-form').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#key-submit'), err = $('#key-err');
    btn.disabled = true; err.hidden = true;
    try { await saveKey($('#tmdb-key').value); $('#app').innerHTML = ''; startApp(); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
    btn.disabled = false;
  };
}

/* ---------- Shell & Routing ---------- */
const NAV = [
  { id: 'home', label: 'Start', icon: I.home },
  { id: 'list', label: 'Liste', icon: I.list },
  { id: 'discover', label: 'Entdecken', icon: I.compass },
];

function renderShell() {
  $('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="#/home">${bulbs(3)}Als Nächstes</a>
    <nav class="nav" aria-label="Hauptnavigation">${NAV.map(n => `<a href="#/${n.id}" data-nav="${n.id}">${n.icon}${n.label}</a>`).join('')}</nav>
    <span class="spacer"></span>
    <a class="icon-btn" href="#/discover?suche" data-focus-search aria-label="Suchen">${I.search}</a>
    <a class="icon-btn" href="#/settings" aria-label="Einstellungen">${I.sliders}</a>
  </header>
  <main id="view"></main>
  <nav class="tabbar" aria-label="Hauptnavigation">${NAV.map(n => `<a href="#/${n.id}" data-nav="${n.id}">${n.icon}${n.label}</a>`).join('')}</nav>`;
  if (!$('#sheet-root')) {
    const r = document.createElement('div'); r.id = 'sheet-root'; document.body.appendChild(r);
  }
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const [a, b] = path.split('/');
  if ((a === 'tv' || a === 'movie') && /^\d+$/.test(b)) return { view: 'detail', type: a, id: +b };
  if (['home', 'list', 'discover', 'settings'].includes(a)) return { view: a, query };
  return { view: 'home' };
}

function route() {
  if (!S.user || !S.tmdbKey || !$('#view')) return;
  const r = parseHash();
  if (r.view === 'detail') { openDetail(r.type, r.id); return; }
  closeDetail();
  S.lastView = r.view;
  document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === r.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const changed = S.curView !== r.view;
  S.curView = r.view;
  renderView(changed);
  if (changed) window.scrollTo(0, 0);
  if (r.view === 'discover' && r.query === 'suche') setTimeout(() => $('#q')?.focus(), 30);
}
window.addEventListener('hashchange', () => { S.navigated = true; route(); });

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderView(); });
}

function renderView(fresh = false) {
  const v = $('#view');
  if (!v) return;
  if (S.dragging) return;
  switch (S.curView) {
    case 'list': renderList(v); break;
    case 'discover': renderDiscover(v, fresh); break;
    case 'settings': renderSettings(v, fresh); break;
    default: renderHome(v);
  }
}

/* ---------- Bausteine ---------- */
function posterCard(c, opt = {}) {
  const type = c.media_type;
  const id = c.id ?? c.tmdb_id;
  const t = nameOf(c);
  const inList = S.items.has(key(type, id));
  const yr = c.meta?.year ?? year(c);
  return `<div class="pcard">
    <div class="pwrap">
      <a class="poster" href="#/${type}/${id}" aria-label="${esc(t)}">
        ${c.poster_path ? `<img src="${img(c.poster_path, 'w342')}" alt="" loading="lazy" decoding="async">` : `<span class="noimg">${esc(t)}</span>`}
        ${opt.rank ? `<span class="rank tnum">${opt.rank}</span>` : ''}
        ${inList && !opt.rank ? `<span class="inlist" title="Auf deiner Liste">${I.check}</span>` : ''}
      </a>
      ${!inList && !opt.noAdd ? `<button class="quickadd" data-add="${type}:${id}" aria-label="„${esc(t)}“ auf die Liste setzen" title="Auf die Liste">${I.plus}</button>` : ''}
    </div>
    <a class="t" href="#/${type}/${id}">${esc(t)}</a>
    <div class="s">${typeLabel(type)}${yr ? ' · ' + yr : ''}</div>
    ${opt.reason ? `<div class="reason">${esc(opt.reason)}</div>` : ''}
  </div>`;
}

function provMini(it, max = 3) {
  const p = it.meta?.prov || [];
  if (!p.length) return '';
  return `<span class="prov-mini" title="${esc(p.map(x => x.n).join(', '))}">${p.slice(0, max).map(x => `<img src="${img(x.l, 'w92')}" alt="${esc(x.n)}" loading="lazy">`).join('')}</span>`;
}

const ratingText = r => r ? `★ ${fmtNum(r / 2, r % 2 ? 1 : 0)}` : '';

function heroHTML(it) {
  const tv = it.media_type === 'tv';
  const st = tv ? epStats(it) : null;
  const eyebrow = it.status === 'watching' ? 'Weiter geht’s' : 'Als Nächstes';
  let line = '', primary = '';
  if (tv) {
    if (st.next) {
      line = `<span><b>${epLabel(st.next)}</b> ist dran</span><span class="tnum">${st.done} von ${st.total} Folgen</span>`;
      primary = `<button class="btn primary" data-act="next-ep" data-key="${kOf(it)}">${I.check}${epLabel(st.next)} gesehen</button>`;
    } else {
      line = `<span><b>Auf dem neuesten Stand</b></span><span class="tnum">${st.total} Folgen gesehen</span>`;
    }
  } else {
    line = `<span>Film${it.meta?.runtime ? ` · ${Math.floor(it.meta.runtime / 60)} Std. ${it.meta.runtime % 60} Min.` : ''}</span>`;
    primary = `<button class="btn primary" data-act="movie-done" data-key="${kOf(it)}">${I.check}Gesehen</button>`;
  }
  return `<section class="hero">
    ${it.backdrop_path ? `<img class="bg" src="${img(it.backdrop_path, 'w1280')}" alt="">` : ''}
    <div class="content">
      <div class="eyebrow">${bulbs(3)}${eyebrow}</div>
      ${it.logo_path ? `<img class="logo-img" src="${img(it.logo_path, 'w500')}" alt="${esc(it.title)}">` : `<h1 class="title-fallback">${esc(it.title)}</h1>`}
      <div class="metaline">${line}${it.meta?.year ? `<span>${it.meta.year}</span>` : ''}${provMini(it)}</div>
      <div class="actions">${primary}<a class="btn ghost" href="#/${it.media_type}/${it.tmdb_id}">${I.info}Details</a></div>
    </div>
  </section>`;
}

function watchCard(it) {
  const tv = it.media_type === 'tv';
  const st = tv ? epStats(it) : null;
  return `<a class="wcard" href="#/${it.media_type}/${it.tmdb_id}">
    <div class="frame">
      ${it.backdrop_path ? `<img class="bg" src="${img(it.backdrop_path, 'w780')}" alt="" loading="lazy">` : ''}
      ${provMini(it, 2)}
      ${it.logo_path ? `<img class="lg" src="${img(it.logo_path, 'w300')}" alt="${esc(it.title)}" loading="lazy">` : `<span class="lt">${esc(it.title)}</span>`}
      ${tv ? `<span class="bar"><i style="width:${Math.round(st.pct * 100)}%"></i></span>` : ''}
    </div>
    <div class="info"><b>${tv ? (st.next ? epLabel(st.next) + ' ist dran' : 'Auf dem neuesten Stand') : 'Film'}</b><span class="tnum">${tv ? `${st.done}/${st.total}` : ''}</span></div>
  </a>`;
}

function sectionHead(title, sub, link) {
  return `<div class="section-head"><div><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${link || ''}</div>`;
}

/* ---------- Start ---------- */
function renderHome(v) {
  const all = [...S.items.values()];
  const watching = inStatus('watching');
  const planned = inStatus('planned');
  const next = watching[0] || planned[0];
  let html = '';
  if (!all.length) {
    html += `<section class="hero" style="min-height:auto"><div class="content" style="padding-block:clamp(28px,5vw,56px)">
      <div class="eyebrow">${bulbs(3)}Willkommen</div>
      <h1 class="title-fallback">Was guckst<br>du als Nächstes?</h1>
      <p class="overview" style="color:var(--muted)">Such Serien und Filme, setz sie auf deine Liste und bring sie in deine Reihenfolge. Je mehr du hinzufügst und bewertest, desto besser werden die Empfehlungen.</p>
      <div class="actions"><a class="btn primary" href="#/discover?suche">${I.search}Titel suchen</a></div>
    </div></section>`;
  } else if (next) {
    html += heroHTML(next);
  }
  if (watching.length) {
    html += `<section class="section">${sectionHead('Am Gucken', `${watching.length} ${watching.length === 1 ? 'Titel' : 'Titel'}`)}
      <div class="row wide">${watching.map(watchCard).join('')}</div></section>`;
  }
  if (planned.length) {
    html += `<section class="section">${sectionHead('Warteschlange', 'In deiner Reihenfolge', '<a href="#/list">Reihenfolge ändern →</a>')}
      <div class="row posters">${planned.map((it, i) => posterCard({ ...it, id: it.tmdb_id }, { rank: i + 1 })).join('')}</div></section>`;
  }
  if (all.length) {
    html += `<section class="section">${sectionHead('Für dich', 'Aus deiner Liste und deinen Bewertungen', '<a href="#/discover">Mehr →</a>')}
      <div class="row posters" id="home-recs">${skeletons(7)}</div></section>`;
  }
  html += `<section class="section">${sectionHead('Trends diese Woche')}
    <div class="row posters" id="home-trending">${skeletons(7)}</div></section>`;
  html += credit();
  v.innerHTML = html;
  if (all.length) fillRecs($('#home-recs'), 18, true);
  fillTrending($('#home-trending'));
}

const skeletons = n => Array.from({ length: n }, () => '<div class="pcard"><div class="skeleton" style="aspect-ratio:2/3"></div></div>').join('');
const credit = () => `<footer class="credit">Daten und Bilder: TMDB. Diese App nutzt die TMDB-API, ist aber nicht von TMDB unterstützt oder zertifiziert. Streaming-Daten: JustWatch.</footer>`;

async function fillTrending(el) {
  try {
    if (!S.trending) S.trending = (await tmdb('/trending/all/week')).results.filter(r => r.media_type === 'tv' || r.media_type === 'movie');
    if (el.isConnected) el.innerHTML = S.trending.map(c => posterCard(c)).join('');
  } catch (e) { if (el.isConnected) el.outerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

/* ---------- Empfehlungen ---------- */
function recsSignature() {
  return [...S.items.values()].map(i => `${kOf(i)}:${i.status}:${i.rating || ''}`).sort().join('|');
}
function getRecs() {
  const sig = recsSignature();
  if (S.recs && S.recsSig === sig) return Promise.resolve(S.recs);
  if (S.recsPromise && S.recsPromiseSig === sig) return S.recsPromise;
  S.recsPromiseSig = sig;
  S.recsPromise = computeRecs().then(r => { if (S.recsPromiseSig === sig) { S.recs = r; S.recsSig = sig; } return r; });
  return S.recsPromise;
}
async function computeRecs() {
  const base = { done: 0.8, watching: 1, planned: 0.5, dropped: -0.7 };
  const seeds = [...S.items.values()]
    .map(it => ({ it, w: it.rating ? (it.rating - 5) / 2.5 : base[it.status] ?? 0.4 }))
    .filter(x => x.w !== 0)
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w) || String(b.it.updated_at).localeCompare(String(a.it.updated_at)))
    .slice(0, 16);
  const scores = new Map();
  await Promise.all(seeds.map(async ({ it, w }) => {
    try {
      const r = await tmdb(`/${it.media_type}/${it.tmdb_id}/recommendations`);
      (r.results || []).slice(0, 20).forEach((c, i) => {
        const type = c.media_type || it.media_type;
        if (type !== 'tv' && type !== 'movie') return;
        const k = key(type, c.id);
        if (S.items.has(k)) return;
        const s = w * (1 - i / 26) * (c.vote_count > 50 ? 1 : 0.6);
        let e = scores.get(k);
        if (!e) { e = { c: { ...c, media_type: type }, score: 0, because: [] }; scores.set(k, e); }
        e.score += s;
        if (s > 0) e.because.push([s, it.title]);
      });
    } catch {}
  }));
  return [...scores.values()]
    .filter(e => e.score > 0.25 && e.c.poster_path)
    .sort((a, b) => b.score - a.score)
    .slice(0, 48)
    .map(e => ({ ...e.c, reason: e.because.sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]) }));
}
function reasonText(r) { return r?.length ? `Weil du ${r.map(t => `„${t}“`).join(' und ')} auf der Liste hast` : ''; }

async function fillRecs(el, n, row) {
  try {
    const recs = (await getRecs()).filter(c => !S.items.has(key(c.media_type, c.id))).slice(0, n);
    if (!el.isConnected) return;
    if (!recs.length) { el.outerHTML = `<div class="empty"><h3>Noch keine Empfehlungen</h3><span>Setz ein paar Titel auf deine Liste oder bewerte, was du gesehen hast.</span></div>`; return; }
    el.innerHTML = recs.map(c => posterCard(c, { reason: row ? (c.reason?.[0] ? `Wegen „${c.reason[0]}“` : '') : reasonText(c.reason) })).join('');
  } catch (e) { if (el.isConnected) el.outerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

/* ---------- Liste (Board) ---------- */
function renderList(v) {
  S.sortables.forEach(s => s.destroy()); S.sortables = [];
  const f = S.filter;
  const all = [...S.items.values()];
  const visible = all.filter(i => f === 'all' || i.media_type === f);
  v.innerHTML = `
  <div class="page-head">
    <div><h1>Meine Liste</h1><p class="tnum">${all.length} Titel · Ziehen zum Sortieren und Verschieben</p></div>
    <div class="chips" role="group" aria-label="Filter">
      ${[['all', 'Alle'], ['tv', 'Serien'], ['movie', 'Filme']].map(([id, l]) => `<button class="chip" data-filter="${id}" aria-pressed="${f === id}">${l}</button>`).join('')}
    </div>
  </div>
  <div class="board">
    ${STATUSES.map(s => {
      const list = visible.filter(i => i.status === s.id).sort(byPos);
      return `<section class="col" aria-label="${s.label}">
        <div class="col-head"><span class="dot" style="background:${s.color}"></span><h3>${s.label}</h3><span class="n tnum">${list.length}</span></div>
        <div class="col-list" data-status="${s.id}">${list.map((it, i) => listItem(it, s.id === 'planned' ? i + 1 : 0)).join('')}</div>
      </section>`;
    }).join('')}
  </div>
  ${all.length ? '' : `<div class="empty" style="margin-top:16px"><h3>Deine Liste ist leer</h3><span>Such einen Titel und tipp auf ＋, dann landet er unter „Geplant“.</span><a class="btn primary small" href="#/discover?suche">${I.search}Titel suchen</a></div>`}
  ${credit()}`;

  v.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { S.filter = b.dataset.filter; renderList(v); });
  if (window.Sortable) {
    v.querySelectorAll('.col-list').forEach(el => {
      S.sortables.push(new Sortable(el, {
        group: 'board', handle: '.handle', animation: 160, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
        delayOnTouchOnly: true, delay: 80, scroll: true, bubbleScroll: true,
        onStart: () => { S.dragging = true; },
        onEnd: evt => { S.dragging = false; onDrop(evt); },
      }));
    });
  }
}

function listItem(it, rank) {
  const tv = it.media_type === 'tv';
  const st = tv ? epStats(it) : null;
  let extra = '';
  if (tv && it.status === 'watching') extra = st.next ? `<span>${epLabel(st.next)} ist dran</span>` : '<span>Auf dem neuesten Stand</span>';
  return `<div class="litem" data-key="${kOf(it)}" data-open="#/${it.media_type}/${it.tmdb_id}" tabindex="0" role="link" aria-label="${esc(it.title)}">
    <button class="handle" aria-label="Verschieben" tabindex="-1">${I.grip}</button>
    <div class="thumb">${it.poster_path ? `<img src="${img(it.poster_path, 'w154')}" alt="" loading="lazy">` : ''}</div>
    <div class="body">
      <div class="name">${rank ? `<span class="pos tnum">${rank}</span> ` : ''}${esc(it.title)}</div>
      <div class="sub"><span class="tag">${typeLabel(it.media_type)}</span>${it.meta?.year ? `<span>${it.meta.year}</span>` : ''}${extra}${it.rating ? `<span class="stars-static">${ratingText(it.rating)}</span>` : ''}${provMini(it, 2)}</div>
      ${tv && it.status === 'watching' && st.total ? `<div class="mini-bar"><i style="width:${Math.round(st.pct * 100)}%"></i></div>` : ''}
    </div>
  </div>`;
}

function onDrop(evt) {
  const k = evt.item.dataset.key;
  const it = S.items.get(k);
  if (!it) return renderView();
  const status = evt.to.dataset.status;
  const posOf = el => el ? S.items.get(el.dataset.key)?.position : undefined;
  const p = posOf(evt.item.previousElementSibling), n = posOf(evt.item.nextElementSibling);
  let pos;
  if (p != null && n != null) pos = (p + n) / 2;
  else if (p != null) pos = p + 1;
  else if (n != null) pos = n - 1;
  else pos = 0;
  if (it.status === status && it.position === pos) return renderView();
  save({ ...it, status, position: pos });
  if (p != null && n != null && Math.abs(n - p) < 1e-6) renumber(status);
  if (it.status !== status) toast(`„${it.title}“ → ${ST[status].label}`);
}
function renumber(status) {
  inStatus(status).forEach((it, i) => { if (it.position !== i) save({ ...it, position: i }); });
}

/* ---------- Entdecken ---------- */
function renderDiscover(v, fresh) {
  if (!fresh && $('#q', v)) { updateDiscover(); return; }
  v.innerHTML = `
  <div class="page-head"><div><h1>Entdecken</h1><p>Suchen, stöbern, auf die Liste setzen.</p></div></div>
  <div class="search">${I.search}<input id="q" type="search" placeholder="Serie oder Film suchen …" autocomplete="off" enterkeyhint="search" value="${esc(S.search.q)}" aria-label="Serie oder Film suchen"></div>
  <div id="disc-results"></div>`;
  $('#q').addEventListener('input', debounce(e => runSearch(e.target.value), 280));
  updateDiscover();
}

function updateDiscover() {
  const box = $('#disc-results');
  if (!box) return;
  if (S.search.q.trim()) {
    if (S.search.loading && !S.search.results) { box.innerHTML = `<div class="grid">${skeletons(12)}</div>`; return; }
    const res = S.search.results || [];
    box.innerHTML = res.length
      ? `<section class="section">${sectionHead('Treffer', `${res.length} Ergebnisse für „${esc(S.search.q)}“`)}<div class="grid">${res.map(c => posterCard(c)).join('')}</div></section>`
      : `<div class="empty"><h3>Nichts gefunden</h3><span>Probier einen anderen Titel oder den Originaltitel.</span></div>`;
    return;
  }
  box.innerHTML = `
    <section class="section">${sectionHead('Für dich', S.items.size ? 'Passend zu deiner Liste und deinen Bewertungen' : '')}
      ${S.items.size ? `<div class="grid" id="disc-recs">${skeletons(12)}</div>` : `<div class="empty"><h3>Empfehlungen folgen</h3><span>Sobald du Titel auf der Liste hast, findest du hier Vorschläge dazu.</span></div>`}</section>
    <section class="section">${sectionHead('Trends diese Woche')}<div class="row posters" id="disc-trending">${skeletons(7)}</div></section>
    <section class="section">${sectionHead('Beliebte Serien')}<div class="row posters" id="disc-tv">${skeletons(7)}</div></section>
    ${credit()}`;
  if (S.items.size) fillRecs($('#disc-recs'), 36, false);
  fillTrending($('#disc-trending'));
  fillList($('#disc-tv'), '/tv/popular', 'tv');
}

async function fillList(el, path, type) {
  try {
    const r = await tmdb(path, { region: 'DE' });
    if (el.isConnected) el.innerHTML = r.results.map(c => posterCard({ ...c, media_type: type })).join('');
  } catch (e) { if (el.isConnected) el.outerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function runSearch(q) {
  S.search.q = q;
  const seq = ++S.search.seq;
  if (!q.trim()) { S.search.results = null; updateDiscover(); return; }
  S.search.loading = true; S.search.results = null; updateDiscover();
  try {
    const r = await tmdb('/search/multi', { query: q.trim(), include_adult: 'false' });
    if (seq !== S.search.seq) return;
    S.search.results = r.results.filter(c => c.media_type === 'tv' || c.media_type === 'movie');
  } catch (e) { if (seq === S.search.seq) { S.search.results = []; toast(e.message, 'err'); } }
  S.search.loading = false;
  if (seq === S.search.seq) updateDiscover();
}

/* ---------- Einstellungen ---------- */
function renderSettings(v) {
  const n = S.items.size;
  v.innerHTML = `
  <div class="page-head"><div><h1>Einstellungen</h1></div></div>
  <div class="settings">
    <div class="panel">
      <div><div class="label">Konto</div><div>${esc(S.user?.email || '')}</div></div>
      <div class="actions"><button class="btn small" id="sync">Jetzt synchronisieren</button><button class="btn small danger" id="logout">Abmelden</button></div>
    </div>
    <form class="panel" id="key-form" novalidate>
      <div class="field"><label for="tmdb-key">TMDB-Schlüssel</label><input id="tmdb-key" type="password" autocomplete="off" spellcheck="false" value="${esc(S.tmdbKey || '')}"></div>
      <div class="err" id="key-err" hidden></div>
      <div class="actions"><button class="btn small primary" type="submit">Prüfen und speichern</button></div>
    </form>
    <div class="panel">
      <div><div class="label">Deine Daten</div><div class="tnum">${n} Titel · ${STATUSES.map(s => `${inStatus(s.id).length} ${s.label}`).join(' · ')}</div></div>
      <div class="actions"><button class="btn small" id="export">Als JSON exportieren</button></div>
    </div>
    ${credit()}
  </div>`;
  $('#logout').onclick = () => S.sb.auth.signOut();
  $('#sync').onclick = async () => { await syncItems(); toast('Synchronisiert'); };
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify([...S.items.values()], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `als-naechstes-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#key-form').onsubmit = async e => {
    e.preventDefault();
    const err = $('#key-err'); err.hidden = true;
    try { await saveKey($('#tmdb-key').value); toast('Schlüssel gespeichert'); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}

/* ---------- Detailansicht ---------- */
function sheetRoot() { return $('#sheet-root'); }

async function openDetail(type, id) {
  if (!$('#view')) return;
  if (!S.curView) { S.curView = S.lastView; renderView(true); }
  S.detail = { type, id, data: null, open: new Set() };
  const root = sheetRoot();
  root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Details">
    <button class="icon-btn close" data-act="close" aria-label="Schließen">${I.x}</button>
    <div class="d-hero"><div class="content"><div class="skeleton" style="height:90px;width:min(70%,380px)"></div><div class="skeleton" style="height:18px;width:220px"></div></div></div>
  </div>`;
  document.body.style.overflow = 'hidden';
  let d;
  try { d = await getDetails(type, id); }
  catch (e) {
    if (S.detail?.id === id) root.querySelector('.d-hero .content').innerHTML = `<p class="err">${esc(e.message)}</p>`;
    return;
  }
  if (!S.detail || S.detail.type !== type || S.detail.id !== id) return;
  S.detail.data = d;
  const it = S.items.get(key(type, id));
  if (it) {
    const fresh = itemFromDetails(type, d);
    const changed = ['title', 'poster_path', 'backdrop_path', 'logo_path'].some(f => fresh[f] !== it[f]) || JSON.stringify(fresh.meta) !== JSON.stringify(it.meta);
    if (changed) save({ ...it, ...fresh });
  }
  // nächste offene Staffel automatisch aufklappen
  if (type === 'tv') {
    const cur = S.items.get(key(type, id));
    const nx = cur ? epStats(cur).next : null;
    if (nx) S.detail.open.add(nx[0]);
  }
  renderDetail();
}

function closeDetail() {
  if (!S.detail) return;
  S.detail = null;
  const r = sheetRoot();
  if (r) r.innerHTML = '';
  document.body.style.overflow = '';
}
function leaveDetail() {
  if (S.navigated && history.length > 1) history.back();
  else location.hash = '#/' + (S.lastView || 'home');
}

function renderDetail() {
  const D = S.detail; if (!D?.data) return;
  const d = D.data, type = D.type, tv = type === 'tv';
  const t = nameOf(d);
  const logo = pickLogo(d.images?.logos);
  const trailer = (d.videos?.results || []).filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
    .sort((a, b) => (b.iso_639_1 === 'de') - (a.iso_639_1 === 'de') || (b.type === 'Trailer') - (a.type === 'Trailer'))[0];
  const meta = [
    `<span>${typeLabel(type)}</span>`,
    year(d) ? `<span>${year(d)}</span>` : '',
    (d.genres || []).length ? `<span>${esc(d.genres.slice(0, 3).map(g => g.name).join(', '))}</span>` : '',
    tv ? `<span>${d.number_of_seasons} ${d.number_of_seasons === 1 ? 'Staffel' : 'Staffeln'}</span>` : (d.runtime ? `<span>${Math.floor(d.runtime / 60)} Std. ${d.runtime % 60} Min.</span>` : ''),
    d.vote_count > 20 ? `<span><b>★ ${fmtNum(d.vote_average)}</b> TMDB</span>` : '',
  ].join('');
  const recs = (d.recommendations?.results || []).filter(c => c.poster_path).slice(0, 16).map(c => ({ ...c, media_type: c.media_type || type }));
  const cast = (d.aggregate_credits?.cast || d.credits?.cast || []).slice(0, 8);

  sheetRoot().innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(t)}">
    <button class="icon-btn close" data-act="close" aria-label="Schließen">${I.x}</button>
    <section class="d-hero">
      ${d.backdrop_path ? `<img class="bg" src="${img(d.backdrop_path, 'w1280')}" alt="">` : ''}
      <div class="content">
        ${logo ? `<img class="logo-img" src="${img(logo, 'w500')}" alt="${esc(t)}">` : `<h1 class="title-fallback">${esc(t)}</h1>`}
        ${d.tagline ? `<div style="color:#cfcabf;font-style:italic">${esc(d.tagline)}</div>` : ''}
        <div class="metaline">${meta}</div>
        <div class="actions" id="d-actions"></div>
      </div>
    </section>
    <div class="d-body">
      <div style="display:grid;gap:34px;min-width:0">
        <section><h3>Handlung</h3><p class="overview">${esc(d.overview || 'Für diesen Titel gibt es noch keine Beschreibung.')}</p></section>
        ${tv ? `<section><h3>Staffeln & Folgen</h3><div id="d-seasons"></div></section>` : ''}
        ${cast.length ? `<section><h3>Besetzung</h3><div class="cast">${cast.map(c => `<span>${esc(c.name)}</span>`).join('')}</div></section>` : ''}
        ${recs.length ? `<section style="min-width:0"><h3>Das könnte dir auch gefallen</h3><div class="row posters">${recs.map(c => posterCard(c)).join('')}</div></section>` : ''}
      </div>
      <aside style="display:grid;gap:16px">
        <div class="panel" id="d-panel"></div>
        <div class="panel">
          <div><div class="label">Wo läuft’s?</div>${providersHTML(d)}</div>
        </div>
        <div class="panel">${factsHTML(d, type)}</div>
      </aside>
    </div>
  </div>`;
  renderDetailActions(trailer);
  renderDetailPanel();
  if (tv) renderSeasons();
  bindDetail();
}

function refreshDetail() {
  if (!S.detail?.data || !$('#d-panel')) return;
  renderDetailActions(S.detail.trailer);
  renderDetailPanel();
  if (S.detail.type === 'tv') renderSeasons();
}

function detailItem() { return S.detail ? S.items.get(key(S.detail.type, S.detail.id)) : null; }

function renderDetailActions(trailer) {
  const D = S.detail; if (!D) return;
  if (trailer !== undefined) D.trailer = trailer;
  const it = detailItem();
  let primary;
  if (!it) primary = `<button class="btn primary" data-act="add">${I.plus}Auf die Liste</button>`;
  else if (D.type === 'tv') {
    const st = epStats(it);
    primary = st.next ? `<button class="btn primary" data-act="next-ep" data-key="${kOf(it)}">${I.check}${epLabel(st.next)} gesehen</button>`
      : `<button class="btn" disabled>${I.check}Alles gesehen</button>`;
  } else {
    primary = it.status === 'done' ? `<button class="btn" disabled>${I.check}Gesehen</button>` : `<button class="btn primary" data-act="movie-done" data-key="${kOf(it)}">${I.check}Gesehen</button>`;
  }
  const tr = D.trailer ? `<a class="btn ghost" href="https://www.youtube.com/watch?v=${encodeURIComponent(D.trailer.key)}" target="_blank" rel="noopener">${I.play}Trailer</a>` : '';
  const el = $('#d-actions'); if (el) el.innerHTML = primary + tr;
}

function starsHTML(v) {
  let h = '<div class="stars" role="group" aria-label="Deine Bewertung">';
  for (let i = 1; i <= 5; i++) {
    const full = v >= i * 2, half = v === i * 2 - 1;
    h += `<button type="button" data-star="${i}" aria-label="${i} ${i === 1 ? 'Stern' : 'Sterne'}">${I.star}${full || half ? `<span class="half" style="${half ? 'width:50%' : 'width:100%'}">${I.star}</span>` : ''}</button>`;
  }
  h += `<span class="val tnum">${v ? fmtNum(v / 2, v % 2 ? 1 : 0) + ' / 5' : 'Noch nicht bewertet'}</span></div>`;
  return h;
}

function renderDetailPanel() {
  const el = $('#d-panel'); if (!el) return;
  const it = detailItem();
  const focusNote = document.activeElement?.id === 'note';
  if (focusNote) return; // Notiz wird gerade bearbeitet
  el.innerHTML = `
    <div><div class="label">Status</div>
      <div class="seg">${STATUSES.map(s => `<button type="button" data-s="${s.id}" aria-pressed="${it?.status === s.id}"><span class="dot" style="background:${s.color}"></span>${s.label}</button>`).join('')}</div>
      ${it?.status === 'planned' ? `<div style="margin-top:10px"><button class="btn small" data-act="to-front">${I.top}Als Nächstes gucken</button></div>` : ''}
    </div>
    <div><div class="label">Deine Bewertung</div>${starsHTML(it?.rating || 0)}</div>
    <div><div class="label"><label for="note">Notiz</label></div><textarea id="note" class="note" placeholder="z. B. Tipp von Lena, erst nach Staffel 2 wird’s gut …">${esc(it?.note || '')}</textarea></div>
    ${it ? `<div><button class="btn small danger" data-act="remove">Von der Liste entfernen</button></div>` : ''}`;
}

function providersHTML(d) {
  const p = providersDE(d);
  if (!p) return '<p style="margin:0;color:var(--muted)">Aktuell bei keinem Anbieter in Deutschland verfügbar.</p>';
  const groups = [['Im Abo', p.flatrate], ['Kostenlos', [...(p.free || []), ...(p.ads || [])]], ['Leihen', p.rent], ['Kaufen', p.buy]].filter(g => g[1]?.length);
  if (!groups.length) return '<p style="margin:0;color:var(--muted)">Aktuell bei keinem Anbieter in Deutschland verfügbar.</p>';
  return `<div class="providers">${groups.map(([k, list]) => `<div class="prov-group"><div class="k">${k}</div><div class="prov-logos">${list.slice(0, 8).map(x => `<img src="${img(x.logo_path, 'w92')}" alt="${esc(x.provider_name)}" title="${esc(x.provider_name)}" loading="lazy">`).join('')}</div></div>`).join('')}
    <div class="attrib">Daten von JustWatch${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">Alle Angebote</a>` : ''}</div></div>`;
}

function factsHTML(d, type) {
  const rows = [];
  const orig = d.original_title || d.original_name;
  if (orig && orig !== nameOf(d)) rows.push(['Originaltitel', orig]);
  if (type === 'tv') {
    if (d.first_air_date) rows.push(['Start', fmtDate(d.first_air_date)]);
    if (d.status) rows.push(['Status', TV_STATUS[d.status] || d.status]);
    if (d.networks?.length) rows.push(['Sender', d.networks.slice(0, 2).map(n => n.name).join(', ')]);
    rows.push(['Folgen', `${d.number_of_episodes ?? '–'} in ${d.number_of_seasons ?? '–'} Staffeln`]);
    if (d.next_episode_to_air) rows.push(['Nächste Folge', `${epLabel([d.next_episode_to_air.season_number, d.next_episode_to_air.episode_number])} am ${fmtDate(d.next_episode_to_air.air_date)}`]);
    if (d.created_by?.length) rows.push(['Idee', d.created_by.slice(0, 2).map(c => c.name).join(', ')]);
  } else {
    if (d.release_date) rows.push(['Erschienen', fmtDate(d.release_date)]);
    const dir = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
    if (dir.length) rows.push(['Regie', dir.slice(0, 2).join(', ')]);
    if (d.runtime) rows.push(['Laufzeit', `${d.runtime} Min.`]);
  }
  return `<div class="label">Fakten</div><dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

function ring(p) {
  const r = 12, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="3"/>${p > 0 ? `<circle cx="15" cy="15" r="${r}" fill="none" stroke="${p >= 1 ? 'var(--done)' : 'var(--accent)'}" stroke-width="3" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" stroke-linecap="round" transform="rotate(-90 15 15)"/>` : ''}</svg>`;
}

function renderSeasons() {
  const box = $('#d-seasons'); if (!box) return;
  const D = S.detail, d = D.data;
  const it = detailItem();
  const metaNow = itemFromDetails('tv', d).meta;
  const seasons = (d.seasons || []).filter(s => s.season_number > 0 && s.episode_count > 0);
  if (!seasons.length) { box.innerHTML = '<p style="color:var(--muted)">Noch keine Folgen angekündigt.</p>'; return; }
  box.innerHTML = seasons.map(s => {
    const n = s.season_number;
    const aired = airedIn(metaNow, n, s.episode_count);
    const seen = (it?.progress?.[n] || []).filter(e => e <= aired).length;
    const p = aired ? seen / aired : 0;
    const open = D.open.has(n);
    return `<details class="season" data-season="${n}" ${open ? 'open' : ''}>
      <summary class="season-head">
        ${ring(p)}
        <div class="grow"><div class="ttl">${esc(s.name || 'Staffel ' + n)}</div><div class="cnt tnum">${aired ? `${seen} von ${aired} gesehen` : 'Noch nicht ausgestrahlt'}${s.episode_count > aired && aired ? ` · ${s.episode_count - aired} weitere angekündigt` : ''}${s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ''}</div></div>
        ${aired ? `<button type="button" class="btn small" data-act="season-all" data-season="${n}">${seen >= aired ? 'Zurücksetzen' : 'Alle gesehen'}</button>` : ''}
        <span class="chev">${I.chev}</span>
      </summary>
      <div class="eps" id="eps-${n}">${open ? episodesHTML(n) : ''}</div>
    </details>`;
  }).join('');
  D.open.forEach(n => loadSeason(n));
}

function episodesHTML(n) {
  const D = S.detail;
  const data = D.seasons?.[n];
  if (!data) return `<div class="ep"><span></span><div class="skeleton" style="height:16px"></div><span></span></div>`;
  const it = detailItem();
  const seen = new Set(it?.progress?.[n] || []);
  const t = today();
  return data.episodes.map(e => {
    const unaired = !e.air_date || e.air_date > t;
    const on = seen.has(e.episode_number);
    return `<div class="ep ${unaired ? 'unaired' : ''}">
      <span class="no tnum">${e.episode_number}</span>
      <div class="en"><b>${esc(e.name || 'Folge ' + e.episode_number)}</b><span>${e.air_date ? fmtDate(e.air_date) : 'Termin offen'}${e.runtime ? ` · ${e.runtime} Min.` : ''}</span></div>
      <button type="button" class="check" data-ep="${n}:${e.episode_number}" aria-pressed="${on}" ${unaired ? 'disabled' : ''} aria-label="Folge ${e.episode_number} ${on ? 'als ungesehen markieren' : 'als gesehen markieren'}">${I.check}</button>
    </div>`;
  }).join('');
}

async function loadSeason(n) {
  const D = S.detail; if (!D) return;
  D.seasons = D.seasons || {};
  if (!D.seasons[n]) {
    try { D.seasons[n] = await tmdb(`/tv/${D.id}/season/${n}`); }
    catch (e) { const el = $('#eps-' + n); if (el) el.innerHTML = `<p class="err" style="padding:12px 14px;margin:0">${esc(e.message)}</p>`; return; }
  }
  if (S.detail !== D) return;
  const el = $('#eps-' + n); if (el) el.innerHTML = episodesHTML(n);
}

function ensureDetailItem(status) {
  const D = S.detail;
  let it = detailItem();
  if (!it) {
    it = { ...itemFromDetails(D.type, D.data), status, position: endPos(status), rating: null, note: null, progress: {}, added_at: new Date().toISOString() };
    save(it, 0);
  }
  return it;
}

function bindDetail() {
  const root = sheetRoot().querySelector('.sheet');
  root.addEventListener('click', e => {
    const b = e.target.closest('button, [data-act]');
    if (!b || !root.contains(b)) return;
    const D = S.detail; if (!D) return;
    if (b.dataset.act === 'close') { leaveDetail(); return; }
    if (b.dataset.act === 'add') { ensureDetailItem('planned'); toast('Auf die Liste gesetzt'); refreshDetail(); return; }
    if (b.dataset.act === 'remove') { const it = detailItem(); if (it) removeItem(it); return; }
    if (b.dataset.act === 'to-front') { const it = detailItem(); if (it) { save({ ...it, position: endPos('planned', true) }); toast('Steht jetzt ganz vorne in der Warteschlange'); refreshDetail(); } return; }
    if (b.dataset.s) {
      const it = detailItem();
      if (!it) { ensureDetailItem(b.dataset.s); toast(`Auf die Liste gesetzt: ${ST[b.dataset.s].label}`); }
      else setStatus(it, b.dataset.s);
      refreshDetail(); return;
    }
    if (b.dataset.star) {
      const i = +b.dataset.star;
      const r = b.getBoundingClientRect();
      const left = (e.clientX || r.right) - r.left < r.width / 2;
      let v = left ? i * 2 - 1 : i * 2;
      const it = ensureDetailItem('done');
      if (it.rating === v) v = null;
      save({ ...detailItem(), rating: v });
      refreshDetail(); return;
    }
    if (b.dataset.act === 'season-all') {
      e.preventDefault(); e.stopPropagation();
      const n = +b.dataset.season;
      const metaNow = itemFromDetails('tv', D.data).meta;
      const s = metaNow.seasons.find(x => x[0] === n);
      const aired = s ? airedIn(metaNow, n, s[1]) : 0;
      const eps = Array.from({ length: aired }, (_, i) => i + 1);
      const it = ensureDetailItem('watching');
      const seen = (it.progress?.[n] || []).filter(x => x <= aired).length;
      toggleEpisodes(detailItem(), n, eps, seen < aired);
      refreshDetail(); return;
    }
    if (b.dataset.ep) {
      const [n, ep] = b.dataset.ep.split(':').map(Number);
      const it = ensureDetailItem('watching');
      const on = !(it.progress?.[n] || []).includes(ep);
      toggleEpisodes(detailItem(), n, [ep], on);
      refreshDetail(); return;
    }
    if (b.dataset.act === 'next-ep' || b.dataset.act === 'movie-done') { quickAction(b); refreshDetail(); }
  });
  root.addEventListener('toggle', e => {
    const det = e.target.closest?.('details.season'); if (!det) return;
    const n = +det.dataset.season;
    if (det.open) { S.detail.open.add(n); loadSeason(n); } else S.detail.open.delete(n);
  }, true);
  root.addEventListener('input', debounce(e => {
    if (e.target.id !== 'note') return;
    const it = ensureDetailItem('planned');
    save({ ...detailItem(), note: e.target.value.trim() || null }, 800);
  }, 400));
}

function quickAction(b) {
  const it = S.items.get(b.dataset.key);
  if (!it) return;
  if (b.dataset.act === 'movie-done') {
    save({ ...it, status: 'done', position: endPos('done', true) });
    toast(`„${it.title}“ gesehen`, '', { label: 'Bewerten', fn: () => { location.hash = `#/movie/${it.tmdb_id}`; } });
  } else {
    const nx = epStats(it).next;
    if (!nx) return;
    toggleEpisodes(it, nx[0], [nx[1]], true);
    toast(`${epLabel(nx)} abgehakt`, '', { label: 'Rückgängig', fn: () => { const cur = S.items.get(kOf(it)); if (cur) { toggleEpisodes(cur, nx[0], [nx[1]], false); refreshDetail(); } } });
  }
}

/* ---------- Globale Events ---------- */
document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { e.preventDefault(); e.stopPropagation(); const [t, i] = add.dataset.add.split(':'); addItem(t, +i, 'planned'); return; }
  if (e.target.closest('#sheet-root')) return;
  const q = e.target.closest('#view [data-act="next-ep"], #view [data-act="movie-done"]');
  if (q) { quickAction(q); return; }
  const li = e.target.closest('.litem');
  if (li && !e.target.closest('.handle')) location.hash = li.dataset.open;
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.detail) leaveDetail();
  if (e.key === 'Enter' && e.target.classList?.contains('litem')) location.hash = e.target.dataset.open;
  if (e.key === '/' && !/input|textarea/i.test(e.target.tagName) && S.user) { e.preventDefault(); location.hash = '#/discover?suche'; }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.user && S.tmdbKey && Date.now() - S.lastSync > 30000) syncItems();
});

boot();
})();
