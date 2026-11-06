'use strict';
// Связь между телефонами через публичный репозиторий pitanie-data.
// Телефон с ключом записывает отметки, телефон без ключа только смотрит.
// Ключ хранится только на этом телефоне и никогда не попадает в отправляемые данные.
window.Sync = (() => {
  const REPO = 'https://api.github.com/repos/untilsolution/pitanie-data/contents/';
  const PATH = `days/${encodeURIComponent(PLAN.id)}.json`;
  const TOKEN = 'pitanie:token', LAST = `pitanie:sent:${PLAN.id}`;
  const VIEW_EVERY = 90 * 1000; // без ключа GitHub даёт 60 запросов в час
  const me = { mode: 'local', at: null, error: '', sha: null, busy: false, timer: 0 };

  const token = () => { try { return localStorage.getItem(TOKEN) || ''; } catch (e) { return ''; } };
  const remember = (key, value) => {
    try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) { /* только на этот раз */ }
  };
  const sent = () => { try { return localStorage.getItem(LAST) || ''; } catch (e) { return ''; } };
  const clock = iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    let out = '';
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(out);
  }
  const decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  function headers(extra) {
    const h = { Accept: 'application/vnd.github+json', ...extra };
    if (token()) h.Authorization = `Bearer ${token()}`;
    return h;
  }

  const marked = d => extrasOf(d).length > 0 || Object.keys(state.eaten).some(k => k.startsWith(`d${d}m`));

  function body() {
    return {
      plan: PLAN.id, eaten: state.eaten, shop: state.shop, swaps: state.swaps, extras: state.extras,
      yield: shared.yield, vessels: shared.vessels,
      days: PLAN.days.map((day, d) => ({ title: day.title, text: marked(d) ? dayText(d) : null })),
    };
  }

  async function pull() {
    const res = await fetch(`${REPO}${PATH}?t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
    if (res.status === 404) return null;
    if (res.status === 401) throw new Error('Ключ не подошёл');
    if (!res.ok) throw new Error('GitHub не ответил');
    const file = await res.json();
    return { sha: file.sha, data: JSON.parse(decode(file.content)) };
  }

  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  function apply(data) {
    if (data.plan !== PLAN.id) return;
    for (const k of ['eaten', 'shop', 'swaps', 'extras']) if (plain(data[k])) state[k] = data[k];
    if (plain(data.yield)) shared.yield = data.yield;
    if (Array.isArray(data.vessels)) {
      shared.vessels = data.vessels.map(v => ({ n: String(v.n), w: Number(v.w) || 0, ...(/^data:image\/jpeg;base64,[\w+/=]+$/.test(v.photo || '') ? { photo: v.photo } : {}) }));
    }
    me.at = data.updated || me.at;
  }

  function redraw() {
    const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (!sheet && !typing) render();
  }

  async function push(quick) {
    if (me.mode !== 'writer') return;
    if (me.busy) { me.again = true; return; }
    const data = body(), text = JSON.stringify(data);
    if (text === sent()) return;
    me.busy = true;
    const updated = new Date().toISOString();
    const send = () => {
      const json = JSON.stringify({ ...data, updated });
      const payload = JSON.stringify({ message: 'Отметки', content: encode(json), ...(me.sha ? { sha: me.sha } : {}) });
      return fetch(REPO + PATH, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: payload, keepalive: quick && payload.length < 60000 });
    };
    try {
      let res = await send();
      if (res.status === 409 || res.status === 422) { // файл успел измениться, берём свежую версию
        me.sha = (await pull())?.sha ?? null;
        res = await send();
      }
      if (res.status === 401 || res.status === 403) throw new Error('Ключ не подошёл');
      if (res.status === 404) throw new Error('Нет репозитория pitanie-data или доступа к нему');
      if (!res.ok) throw new Error('GitHub не принял данные');
      me.sha = (await res.json()).content.sha;
      remember(LAST, text);
      me.at = updated;
      me.error = '';
    } catch (e) {
      me.error = e.message === 'Failed to fetch' || e.name === 'TypeError' ? 'Нет связи, отправлю позже' : e.message;
    }
    me.busy = false;
    if (me.again) { me.again = false; push(); }
    if (state.view === 'plan') label();
  }

  function label() {
    const b = document.querySelector('[data-act=sync]');
    if (b) b.textContent = buttonText();
  }
  function buttonText() {
    if (me.mode === 'viewer') return 'Просмотр';
    if (me.mode === 'local') return 'Синхронизация выключена';
    return me.error ? `Не отправлено: ${me.error}` : me.at ? `Отправлено в ${clock(me.at)}` : 'Синхронизация включена';
  }

  async function refresh() {
    try {
      const got = await pull();
      if (!got) return;
      me.sha = got.sha;
      apply(got.data);
      me.error = '';
      redraw();
    } catch (e) {
      me.error = 'Нет связи';
      redraw();
    }
  }

  function todayIndex() {
    const now = new Date();
    const word = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    return PLAN.days.findIndex(day => day.title.toLowerCase().includes(word));
  }

  async function start() {
    if (token()) {
      me.mode = 'writer';
      try {
        const got = await pull();
        me.sha = got?.sha ?? null;
        const empty = !Object.keys(state.eaten).length && !Object.keys(state.shop).length;
        if (got && empty) { apply(got.data); save(); saveShared(); remember(LAST, JSON.stringify(body())); redraw(); }
        else if (got) me.at = got.data.updated;
        me.error = '';
      } catch (e) {
        me.error = e.message;
      }
      if (!me.error) await push();
      if (state.view === 'plan') label();
      return;
    }
    try {
      const got = await pull();
      if (!got) return; // репозитория ещё нет: всё работает как раньше
      me.mode = 'viewer';
      me.sha = got.sha;
      apply(got.data);
      const today = todayIndex();
      if (today >= 0) state.day = today;
      redraw();
      if (!me.poll) me.poll = setInterval(() => { if (!document.hidden) refresh(); }, VIEW_EVERY);
    } catch (e) { /* без связи телефон показывает то, что знает */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (me.mode === 'writer') { clearTimeout(me.timer); push(true); } } else if (me.mode === 'viewer') refresh();
    else if (me.mode === 'writer') push();
  });
  addEventListener('online', () => { if (me.mode === 'writer') push(); });

  return {
    get viewer() { return me.mode === 'viewer'; },
    get mode() { return me.mode; },
    changed() {
      if (me.mode !== 'writer') return;
      clearTimeout(me.timer);
      me.timer = setTimeout(() => push(), 1500);
    },
    buttonText,
    bar: () => (me.mode === 'viewer' ? `<p class="syncbar">Просмотр${me.error ? `, ${esc(me.error.toLowerCase())}` : me.at ? `, обновлено в ${clock(me.at)}` : ''}</p>` : ''),
    async setToken(value) {
      remember(TOKEN, value.trim());
      me.mode = 'local';
      me.error = '';
      me.sha = null;
      await start();
      const error = me.error;
      if (error) { // ключ оставляем только если запись прошла
        remember(TOKEN, '');
        me.mode = 'local';
        me.error = '';
        await start();
      }
      return error;
    },
    forget() {
      remember(TOKEN, '');
      location.reload();
    },
    start,
  };
})();
render();
Sync.start();
