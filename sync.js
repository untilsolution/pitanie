'use strict';
// Связь между телефонами через публичный репозиторий pitanie-data.
// Основной телефон записывает отметки, телефон с ролью «покупки» отмечает только покупки,
// телефон без ключа только смотрит. Покупки лежат в своём файле, чтобы не затирать еду.
// Ключ хранится только на этом телефоне и никогда не попадает в отправляемые данные.
window.Sync = (() => {
  const REPO = 'https://api.github.com/repos/untilsolution/pitanie-data/contents/';
  const PATH = `days/${encodeURIComponent(PLAN.id)}.json`;
  const SHOP_PATH = `shop/${encodeURIComponent(PLAN.id)}.json`;
  const TOKEN = 'pitanie:token', ROLE = 'pitanie:role', LAST = `pitanie:sent:${PLAN.id}`, QUEUE = `pitanie:shopq:${PLAN.id}`;
  // Без ключа GitHub даёт 60 запросов в час, а за раз нужно два
  const EVERY_ANON = 150 * 1000, EVERY_KEY = 60 * 1000;
  const me = { mode: 'local', at: null, error: '', sha: null, busy: false, timer: 0, shopBusy: false };

  const token = () => { try { return localStorage.getItem(TOKEN) || ''; } catch (e) { return ''; } };
  const remember = (key, value) => {
    try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) { /* только на этот раз */ }
  };
  const sent = () => { try { return localStorage.getItem(LAST) || ''; } catch (e) { return ''; } };
  const role = () => { try { return localStorage.getItem(ROLE) || 'main'; } catch (e) { return 'main'; } };
  const JOURNAL = 'journal.json', JKEY = 'pitanie:journal', JDIRTY = 'pitanie:journal:dirty';
  let journal = { weights: {}, workouts: {} };
  try { journal = { ...journal, ...JSON.parse(localStorage.getItem(JKEY)) }; } catch (e) { /* журнал только на этот раз */ }
  const dirty = () => { try { return !!localStorage.getItem(JDIRTY); } catch (e) { return false; } };
  let queue = {}; // покупки, ещё не дошедшие до GitHub: имя -> куплено или нет
  try { queue = JSON.parse(localStorage.getItem(QUEUE)) || {}; } catch (e) { /* очередь только на этот раз */ }
  const keepQueue = () => remember(QUEUE, Object.keys(queue).length ? JSON.stringify(queue) : '');
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
      plan: PLAN.id, eaten: state.eaten, swaps: state.swaps, extras: state.extras,
      yield: shared.yield, vessels: shared.vessels, myfoods: shared.myfoods || [],
      days: PLAN.days.map((day, d) => ({ title: day.title, text: marked(d) ? dayText(d) : null })),
    };
  }

  async function pull(path = PATH) {
    const res = await fetch(`${REPO}${path}?t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
    if (res.status === 404) return null;
    if (res.status === 401) throw new Error('Ключ не подошёл');
    if (!res.ok) throw new Error('GitHub не ответил');
    const file = await res.json();
    return { sha: file.sha, data: JSON.parse(decode(file.content)) };
  }

  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  function apply(data) {
    if (data.plan !== PLAN.id) return;
    for (const k of ['eaten', 'swaps', 'extras']) if (plain(data[k])) state[k] = data[k];
    if (plain(data.yield)) shared.yield = data.yield;
    if (Array.isArray(data.vessels)) {
      const jpeg = p => /^data:image\/jpeg;base64,[\w+/=]+$/.test(p || '');
      shared.vessels = data.vessels.map(v => ({ n: String(v.n), w: Number(v.w) || 0, ...(jpeg(v.photo) ? { photo: v.photo } : {}), ...(jpeg(v.big) ? { big: v.big } : {}) }));
    }
    if (Array.isArray(data.myfoods)) {
      const n = x => Number(x) || 0;
      shared.myfoods = data.myfoods.filter(p => p && p.n).map(p => ({ n: String(p.n), base: n(p.base) || 1, u: String(p.u || 'г'), p: n(p.p), f: n(p.f), c: n(p.c), k: n(p.k), start: n(p.start) || 1 }));
      rebuildProducts();
    }
    me.at = data.updated || me.at;
  }

  function redraw() {
    const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (!sheet && !typing) render();
  }

  function mergeShop(remote) {
    const next = { ...remote };
    for (const [name, on] of Object.entries(queue)) { if (on) next[name] = true; else delete next[name]; }
    const changed = JSON.stringify(next) !== JSON.stringify(state.shop);
    state.shop = next;
    return changed;
  }

  // Берём свежий файл и накладываем только свои отметки, поэтому два телефона не мешают друг другу
  async function flushShop(force) {
    if (!token() || me.shopBusy || (!force && !Object.keys(queue).length)) return;
    me.shopBusy = true;
    const sending = { ...queue };
    try {
      for (let i = 0; ; i++) {
        const got = await pull(SHOP_PATH);
        mergeShop(got?.data?.shop ?? {});
        const content = encode(JSON.stringify({ plan: PLAN.id, shop: state.shop, updated: new Date().toISOString() }));
        const res = await fetch(REPO + SHOP_PATH, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ message: 'Покупки', content, ...(got ? { sha: got.sha } : {}) }) });
        if ((res.status === 409 || res.status === 422) && i < 4) continue;
        if (res.status === 401 || res.status === 403) throw new Error('Ключ не подошёл');
        if (res.status === 404) throw new Error('Нет репозитория pitanie-data или доступа к нему');
        if (!res.ok) throw new Error('GitHub не принял данные');
        break;
      }
      for (const [name, on] of Object.entries(sending)) if (queue[name] === on) delete queue[name];
      keepQueue();
      me.error = '';
    } catch (e) {
      me.error = e.name === 'TypeError' ? 'Нет связи, отправлю позже' : e.message;
    }
    me.shopBusy = false;
    if (!me.error && Object.keys(queue).length) flushShop();
  }

  // Журнал пишет только основной телефон: вес и выполненные тренировки
  async function flushJournal() {
    if (me.mode !== 'writer' || me.journalBusy || !dirty()) return;
    me.journalBusy = true;
    try {
      for (let i = 0; ; i++) {
        const got = await pull(JOURNAL);
        const content = encode(JSON.stringify({ ...journal, updated: new Date().toISOString() }));
        const res = await fetch(REPO + JOURNAL, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ message: 'Журнал', content, ...(got ? { sha: got.sha } : {}) }) });
        if ((res.status === 409 || res.status === 422) && i < 3) continue;
        if (!res.ok) throw new Error('GitHub не принял журнал');
        break;
      }
      remember(JDIRTY, '');
      me.error = '';
    } catch (e) {
      me.error = e.name === 'TypeError' ? 'Нет связи, отправлю позже' : e.message;
    }
    me.journalBusy = false;
  }

  async function loadJournal() {
    if (dirty()) return;
    const got = await pull(JOURNAL);
    if (!got) return;
    journal = { weights: got.data.weights || {}, workouts: got.data.workouts || {} };
    remember(JKEY, JSON.stringify(journal));
    redraw();
  }

  async function refreshShop() {
    const got = await pull(SHOP_PATH);
    if (got && mergeShop(got.data?.shop ?? {})) { save(); redraw(); }
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
    if (me.mode === 'shopper') return me.error ? `Не отправлено: ${me.error}` : 'Покупки отмечаются';
    if (me.mode === 'local') return 'Синхронизация выключена';
    return me.error ? `Не отправлено: ${me.error}` : me.at ? `Отправлено в ${clock(me.at)}` : 'Синхронизация включена';
  }

  async function refresh() {
    try {
      const got = await pull();
      if (got) {
        me.sha = got.sha;
        apply(got.data);
      }
      await refreshShop();
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

  function poll() {
    if (me.poll) clearInterval(me.poll);
    me.poll = setInterval(() => {
      if (document.hidden) return;
      if (me.mode === 'writer') refreshShop().catch(() => {}); else refresh();
    }, token() ? EVERY_KEY : EVERY_ANON);
  }

  async function start() {
    if (token() && role() === 'shop') {
      me.mode = 'shopper';
      await refresh();
      const today = todayIndex();
      if (today >= 0) state.day = today;
      redraw();
      await flushShop(true);
      poll();
      return;
    }
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
      if (!me.error) {
        try {
          const list = await pull(SHOP_PATH);
          if (!list) { for (const name of Object.keys(state.shop)) queue[name] = true; keepQueue(); }
          await flushShop(!list);
          await refreshShop();
          await loadJournal();
          await flushJournal();
        } catch (e) { me.error = e.message; }
      }
      poll();
      if (state.view === 'plan') label();
      return;
    }
    try {
      const got = await pull();
      if (!got) return; // данных ещё нет: всё работает как раньше
      me.mode = 'viewer';
      me.sha = got.sha;
      apply(got.data);
      await refreshShop();
      const today = todayIndex();
      if (today >= 0) state.day = today;
      redraw();
      poll();
    } catch (e) { /* без связи телефон показывает то, что знает */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (me.mode === 'writer') { clearTimeout(me.timer); push(true); } return; }
    if (me.mode === 'viewer' || me.mode === 'shopper') refresh();
    if (me.mode === 'writer') { push(); refreshShop().catch(() => {}); flushJournal(); }
    flushShop();
  });
  addEventListener('online', () => { if (me.mode === 'writer') push(); flushShop(); flushJournal(); });

  return {
    get viewer() { return me.mode === 'viewer' || me.mode === 'shopper'; },
    get canShop() { return me.mode !== 'viewer'; },
    get journal() { return journal; },
    async saveJournal() {
      remember(JKEY, JSON.stringify(journal));
      remember(JDIRTY, '1');
      if (me.mode !== 'writer') return 'нет ключа на этом телефоне';
      await flushJournal();
      if (state.view === 'plan') label();
      return dirty() ? me.error || 'нет связи' : '';
    },
    shop(name, on) {
      if (me.mode !== 'writer' && me.mode !== 'shopper') return;
      queue[name] = on;
      keepQueue();
      flushShop();
    },
    get mode() { return me.mode; },
    changed() {
      if (me.mode !== 'writer') return;
      clearTimeout(me.timer);
      me.timer = setTimeout(() => push(), 1500);
    },
    buttonText,
    bar: () => (me.mode === 'viewer' || me.mode === 'shopper' ? `<p class="syncbar">${me.mode === 'shopper' ? 'Отмечаются только покупки' : 'Просмотр'}${me.error ? `, ${esc(me.error.toLowerCase())}` : me.at ? `, обновлено в ${clock(me.at)}` : ''}</p>` : ''),
    async setToken(value, asRole) {
      remember(TOKEN, value.trim());
      remember(ROLE, asRole);
      me.mode = 'local';
      me.error = '';
      me.sha = null;
      await start();
      const error = me.error;
      if (error) { // ключ оставляем только если запись прошла
        remember(TOKEN, '');
        remember(ROLE, '');
        me.mode = 'local';
        me.error = '';
        await start();
      }
      return error;
    },
    forget() {
      remember(TOKEN, '');
      remember(ROLE, '');
      location.reload();
    },
    start,
  };
})();
render();
Sync.start();
