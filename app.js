'use strict';
const PLAN = window.PLAN;
const KEY = 'pitanie:' + PLAN.id;

// Shopping rules: which plan items are counted, and how they are shown.
const SHOP = [
  { re: /^Молоко/, name: 'Молоко', fmt: g => liters(g) },
  { re: /^Банан/, name: 'Бананы', fmt: g => grams(g) },
  { re: /^(Яблоко|Киви|Апельсин|Мандарин|Слива)/, fmt: g => grams(g) },
  { re: /^Хлеб/, fmt: g => grams(g) },
  { re: /^Сыр/, fmt: g => grams(g) },
  { re: /^Ветчина/, fmt: g => grams(g) },
  { re: /^Макароны/, name: 'Макароны', fmt: g => grams(g) },
  { re: /^Шоколад/, fmt: g => `${Math.ceil(g / 75)} пл. (${g} г)` },
  { re: /^Чокопай/, name: 'Чокопай', fmt: g => `${Math.ceil(g / 30)} шт.` },
  { re: /^Белок яичный/, name: 'Яйца на белок', fmt: g => `${Math.ceil(g / 37.5)} шт.` },
  { re: /^Пюре/, name: 'Пюре (картофель, молоко, масло)', fmt: g => grams(g) },
  { re: /^Говядина/, name: 'Говядина', fmt: g => grams(g) },
  { re: /^Тунец/, name: 'Тунец', fmt: g => `${Math.ceil(g / 185)} банк. по 185 г` },
];
const liters = g => (g >= 1000 ? `${(g / 1000).toFixed(1).replace('.', ',')} л` : `${g} мл`);
const grams = g => (g >= 1000 ? `${(g / 1000).toFixed(2).replace('.', ',')} кг` : `${g} г`);

let memory = {};
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return memory; }
}
function save() {
  memory = state;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* the page still works for this visit */ }
  if (window.Sync) Sync.changed();
}
const state = Object.assign({ eaten: {}, shop: {}, day: 0, view: 'plan', swaps: {}, extras: {} }, load());
let open = null;

// Cooked weights and dishes outlive any single plan, so they have their own key.
const SHARED = 'pitanie:shared';
let sharedMemory = {};
function loadShared() {
  try { return JSON.parse(localStorage.getItem(SHARED)) || {}; } catch (e) { return sharedMemory; }
}
const shared = Object.assign({ yield: {}, yieldAt: {}, vessels: [], myfoods: [], raw: {} }, loadShared());
function saveShared() {
  sharedMemory = shared;
  try { localStorage.setItem(SHARED, JSON.stringify(shared)); } catch (e) { /* the page still works for this visit */ }
  if (window.Sync) Sync.changed();
}
const COOK = /^(Макароны|Рис|Гречка|Наггетсы|Рулетики|Фарш|Куриная грудка|Бёдра|Филе|Говядина|Курица|Индейка|Свинина|Рыба|Котлеты)/;
const DRY = /^(Макароны|Рис|Гречка|Крупа|Овсян)/;
const rawWord = n => (DRY.test(n) ? 'сухого' : 'сырого');
const cookables = () => [...new Set(PLAN.days.flatMap(d => d.meals.flatMap(m => m.items.map(it => it.n))).filter(n => COOK.test(n)))];
const cookedOf = (it, raw) => (shared.yield[it.n] ? Math.round(raw * shared.yield[it.n] / 100) : null);

const $ = id => document.getElementById(id);
const num = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
const whole = x => Math.round(x).toString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const idOf = (d, m, i) => `d${d}m${m}i${i}`;
const itemAt = (d, m, i) => state.swaps[idOf(d, m, i)] || PLAN.days[d].meals[m].items[i];
const extrasOf = d => state.extras[d] || [];
// Ready-made food that is not in the table. Typical values, per 100 g.
const READY_FOOD = [
  { cat: 'Готовая еда', n: 'Шаурма с курицей', brand: '', freq: '', base: 100, u: 'г', p: 8.5, f: 8, c: 22, k: 190, start: 350 },
  { cat: 'Готовая еда', n: 'Картофель фри', brand: '', freq: '', base: 100, u: 'г', p: 3, f: 15, c: 40, k: 310, start: 100 },
  { cat: 'Готовая еда', n: 'Сухарики к пиву', brand: '', freq: '', base: 100, u: 'г', p: 10.1, f: 8.4, c: 67.7, k: 386, start: 50 },
  { cat: 'Готовая еда', n: 'Щёчки судака сушёные', brand: '', freq: '', base: 100, u: 'г', p: 55, f: 3, c: 0, k: 250, start: 75 },
];
// The product list: the table, ready-made food and the dishes the user saved. Rebuilt in place when "my dishes" change.
const PRODUCTS = [];
function rebuildProducts() {
  const mine = (shared.myfoods || []).map(p => ({ ...p, cat: 'Мои блюда', brand: '', freq: '', mine: true }));
  PRODUCTS.length = 0;
  PRODUCTS.push(...[...(window.PRODUCTS || []), ...READY_FOOD, ...mine].sort((x, y) => x.n.localeCompare(y.n, 'ru')));
}
rebuildProducts();
const SWAPPABLE = /^(Мармелад|Чокопай|Шоколад|Зефир|Мёд|Джем|Пряники|Пломбир|Печенье|Банан|Яблоко|Киви|Апельсин|Мандарин|Слива|Грецкий|Миндаль|Фундук|Кедровые|Курага)/;
const SWAP_CATS = ['Сладкое', 'Овощи и фрукты', 'Орехи и сухофрукты'];
const label = p => p.n + (p.brand ? `, ${p.brand}` : '');
// Search treats Ё and Е as the same letter, as people usually type Е.
const norm = s => String(s).toLowerCase().replace(/ё/g, 'е');
const portionOf = (p, a) => {
  const k = a / p.base;
  return { n: label(p), a, u: p.u, p: +(p.p * k).toFixed(1), f: +(p.f * k).toFixed(1), c: +(p.c * k).toFixed(1), k: +(p.k * k).toFixed(1), fb: 0,
    src: { base: p.base, u: p.u, p: p.p, f: p.f, c: p.c, k: p.k } };
};
// What an outside-the-plan entry is based on, so its amount can be changed later.
const srcOf = x => x.src || (x.a ? { base: x.a, u: x.u, p: x.p, f: x.f, c: x.c, k: x.k } : null);
const macroInputs = (v = {}) => `<div class="grid4">
        <label class="field col"><span>Белки</span><input type="number" inputmode="decimal" id="cP" value="${v.p ?? ''}" data-act="calcinput" aria-label="Белки, г"></label>
        <label class="field col"><span>Жиры</span><input type="number" inputmode="decimal" id="cF" value="${v.f ?? ''}" data-act="calcinput" aria-label="Жиры, г"></label>
        <label class="field col"><span>Углев.</span><input type="number" inputmode="decimal" id="cC" value="${v.c ?? ''}" data-act="calcinput" aria-label="Углеводы, г"></label>
        <label class="field col"><span>Ккал</span><input type="number" inputmode="decimal" id="cK" value="${v.k ?? ''}" data-act="calcinput" aria-label="Ккал"></label>
      </div>`;
const readMacros = () => ({ p: Number($('cP').value) || 0, f: Number($('cF').value) || 0, c: Number($('cC').value) || 0, k: Number($('cK').value) || 0 });
const eatenOf = (id, it) => Math.min(state.eaten[id] || 0, it.a);

function totals(d) {
  const t = { p: 0, f: 0, c: 0, k: 0, fb: 0 }, plan = { p: 0, f: 0, c: 0, k: 0, fb: 0 };
  PLAN.days[d].meals.forEach((meal, m) => meal.items.forEach((orig, i) => {
    const it = itemAt(d, m, i), part = eatenOf(idOf(d, m, i), it) / it.a;
    for (const key in t) { t[key] += it[key] * part; plan[key] += it[key]; }
  }));
  extrasOf(d).forEach(x => { for (const key in t) t[key] += x[key] || 0; });
  return { t, plan };
}

function summary(d) {
  const { t, plan } = totals(d);
  const pct = (a, b) => Math.min(100, b ? a / b * 100 : 0);
  const macro = (label, a, b, color) => `<div class="macro"><small>${label}</small>
    <b>${whole(a)} <em>из ${whole(b)} г</em></b>
    <div class="bar"><i style="width:${pct(a, b)}%;background:var(${color})"></i></div></div>`;
  return `<section class="card sum" aria-label="Итог дня">
    <div class="kcal"><b>${whole(t.k)} ккал</b><span>осталось ${whole(Math.max(0, plan.k - t.k))} из ${whole(plan.k)}</span></div>
    <div class="bar" style="margin-top:8px"><i style="width:${pct(t.k, plan.k)}%;background:var(--kcal)"></i></div>
    <div class="macros">${macro('Белки', t.p, plan.p, '--prot')}${macro('Жиры', t.f, plan.f, '--fat')}${macro('Углеводы', t.c, plan.c, '--carb')}</div>
    <div class="fiber">Клетчатка примерно ${whole(t.fb)} из ${whole(plan.fb)} г</div>
  </section>`;
}

function itemHtml(d, m, i, it) {
  const id = idOf(d, m, i), got = eatenOf(id, it);
  const cls = got >= it.a ? 'full' : got > 0 ? 'part' : '';
  const status = cls === 'part'
    ? `<small class="st">съел ${got} из ${it.a} ${it.u}, осталось ${it.a - got} ${it.u}</small>`
    : `<small>${it.a} ${it.u} · ${whole(it.k)} ккал · Б ${num(it.p)} Ж ${num(it.f)} У ${num(it.c)}</small>`;
  const step = it.u === 'кусок' ? 0.5 : it.a >= 100 ? 10 : 5;
  const ready = cookedOf(it, cls === 'part' ? it.a - got : it.a);
  const readyLine = ready === null ? '' : `<small class="ck">${cls === 'part' ? 'осталось' : 'порция'} ${ready} г готового</small>`;
  const readyEdit = ready === null ? '' : `<div class="ckrow"><span>Готового съел</span>
        <input type="number" inputmode="numeric" min="0" value="${cookedOf(it, got)}" data-act="cookedinput" data-id="${id}" aria-label="Съедено готового, г"><span>г</span></div>`;
  const edit = open === id ? `<div class="edit">
      <div class="step">
        <button type="button" data-act="minus" data-id="${id}" data-step="${step}" aria-label="Меньше">−</button>
        <input type="number" inputmode="numeric" min="0" max="${it.a}" step="${step}" value="${got}" data-act="input" data-id="${id}" aria-label="Съедено, ${it.u}">
        <button type="button" data-act="plus" data-id="${id}" data-step="${step}" aria-label="Больше">+</button>
        <span>из ${it.a} ${it.u}</span>
      </div>${readyEdit}
      <div class="chips">
        ${SWAPPABLE.test(it.n) ? `<button type="button" data-act="swap" data-id="${id}">Заменить</button>` : ''}
        ${state.swaps[id] ? `<button type="button" data-act="unswap" data-id="${id}">Вернуть как было</button>` : ''}
        <button type="button" data-act="set" data-id="${id}" data-val="0">Не ел</button>
        <button type="button" data-act="set" data-id="${id}" data-val="${it.u === 'кусок' ? it.a / 2 : Math.round(it.a / 2)}">Половина</button>
        <button type="button" data-act="set" data-id="${id}" data-val="${it.a}">Всё</button>
      </div>
    </div>` : '';
  return `<div class="item ${cls}">
    <div class="row">
      <button type="button" class="tick" data-act="tick" data-id="${id}" aria-label="${esc(it.n)}: отметить" aria-pressed="${cls === 'full'}"><i>${cls === 'full' ? '✓' : ''}</i></button>
      <button type="button" class="info" data-act="open" data-id="${id}" aria-expanded="${open === id}"><b>${esc(it.n)}</b>${status}${readyLine}</button>
    </div>${edit}</div>`;
}

function renderPlan() {
  const d = state.day, day = PLAN.days[d];
  const meals = day.meals.map((meal, m) => {
    const list = meal.items.map((x, i) => itemAt(d, m, i));
    const left = list.filter((it, i) => eatenOf(idOf(d, m, i), it) < it.a).length;
    const kcal = list.reduce((s, it) => s + it.k, 0);
    return `<section class="card meal">
      <div class="mealhead"><h2>${esc(meal.name)}</h2><span>${left ? `осталось ${left} · ` : 'всё съедено · '}${whole(kcal)} ккал</span></div>
      ${list.map((it, i) => itemHtml(d, m, i, it)).join('')}
    </section>`;
  }).join('');
  const viewer = window.Sync && Sync.viewer;
  $('main').innerHTML = `${window.Sync ? Sync.bar() : ''}<h1>${esc(day.title)}</h1><p class="sub">${esc(day.note || '')}</p>
    ${viewer ? nextMealHtml(d) : window.Sync ? trainTop() : ''}${summary(d)}${meals}
    ${extrasHtml(d)}
    <div class="actions">
      ${viewer ? '' : '<button type="button" class="btn" data-act="extra">Съел вне плана</button>'}
      ${!viewer && window.Sync ? weightLink() : ''}
      <button type="button" class="btn ghost" data-act="sync">${esc(window.Sync ? Sync.buttonText() : 'Синхронизация')}</button>
    </div>`;
}

// For the person who serves the food: what is left in the next meal, in cooked grams.
function nextMealHtml(d) {
  const day = PLAN.days[d];
  for (let m = 0; m < day.meals.length; m++) {
    const rows = day.meals[m].items.map((x, i) => {
      const it = itemAt(d, m, i), left = it.a - eatenOf(idOf(d, m, i), it);
      if (left <= 0) return '';
      const ready = cookedOf(it, left);
      return `<div class="nextrow"><span>${esc(it.n)}</span><b>${ready === null ? `${num(left)} ${esc(it.u)}` : `${ready} г готового`}</b></div>`;
    }).join('');
    if (rows) return `<section class="card next"><div class="mealhead"><h2>Положить: ${esc(day.meals[m].name)}</h2></div>${rows}</section>`;
  }
  return '<section class="card next"><div class="mealhead"><h2>На этот день всё съедено</h2></div></section>';
}

function extrasHtml(d) {
  const list = extrasOf(d);
  if (!list.length) return '';
  const rows = list.map((x, i) => `<div class="item"><div class="row xrow">
      <button type="button" class="info" data-act="editextra" data-i="${i}" aria-label="Изменить: ${esc(x.n)}"><b>${esc(x.n)}</b><small>${x.a ? `${x.a} ${x.u} · ` : ''}${whole(x.k)} ккал · Б ${num(x.p)} Ж ${num(x.f)} У ${num(x.c)}</small></button>
      <button type="button" class="del" data-act="delextra" data-i="${i}" aria-label="Убрать: ${esc(x.n)}">Убрать</button>
    </div></div>`).join('');
  const kcal = list.reduce((s, x) => s + x.k, 0);
  return `<section class="card meal"><div class="mealhead"><h2>Вне плана</h2><span>${whole(kcal)} ккал</span></div>${rows}</section>`;
}

// Bottom sheet shared by "replace a product" and "ate outside the plan".
let sheet = null;
function closeSheet() { sheet = null; $('sheet').hidden = true; $('sheet').innerHTML = ''; document.body.classList.remove('locked'); }
function swapOptions() {
  const it = findItem(sheet.id), q = norm(sheet.q);
  return PRODUCTS.filter(p => SWAP_CATS.includes(p.cat) && p.u === 'г' && p.k > 0 && !/Сгущёнка/.test(p.n)
      && !label(p).startsWith(it.n) && norm(label(p)).includes(q))
    .map(p => {
      const unit = /^Чокопай/.test(p.n) ? 30 : 5;
      const a = Math.max(unit, Math.round(it.k / p.k * p.base / unit) * unit);
      return { p, a, x: portionOf(p, a) };
    });
}
function sheetList() {
  if (sheet.mode === 'swap') {
    return swapOptions().map((o, i) => `<button type="button" class="pick" data-act="doswap" data-i="${i}">
      <b>${esc(o.x.n)}${o.p.freq ? ` <em>${esc(o.p.freq.toLowerCase())}</em>` : ''}</b>
      <small>${o.a} г · ${whole(o.x.k)} ккал · Б ${num(o.x.p)} Ж ${num(o.x.f)} У ${num(o.x.c)}</small></button>`).join('') || '<p class="sub">Ничего не нашлось</p>';
  }
  const q = norm(sheet.q);
  return PRODUCTS.map((p, i) => ({ p, i })).filter(o => norm(label(o.p)).includes(q)).map(o =>
    `<button type="button" class="pick" data-act="pickextra" data-i="${o.i}"><b>${esc(label(o.p))}${o.p.mine ? ' <em>моё</em>' : ''}</b>
      <small>на ${o.p.base} ${o.p.u}: ${whole(o.p.k)} ккал · Б ${num(o.p.p)} Ж ${num(o.p.f)} У ${num(o.p.c)}</small></button>`).join('') || '<p class="sub">В таблице нет. Нажми «Найти в интернете».</p>';
}
function webList() {
  if (sheet.webState === 'load') return '<p class="sub">Ищу, это может занять до 15 секунд…</p>';
  if (sheet.webState === 'error') return '<p class="sub">Интернет-база не ответила. Попробуй ещё раз или впиши блюдо вручную.</p>';
  if (sheet.webState === 'empty') return '<p class="sub">В интернете не нашлось. Впиши блюдо вручную.</p>';
  if (!sheet.web || !sheet.web.length) return '';
  return `<p class="sub webhead">Из интернета, база Open Food Facts. Значения от пользователей, примерные.</p>` + sheet.web.map((p, i) =>
    `<button type="button" class="pick" data-act="pickweb" data-i="${i}"><b>${esc(label(p))}</b>
      <small>на 100 г: ${whole(p.k)} ккал · Б ${num(p.p)} Ж ${num(p.f)} У ${num(p.c)}</small></button>`).join('');
}
async function webSearch() {
  const q = sheet.q.trim();
  if (q.length < 2) { toast('Сначала впиши название в поиск'); return; }
  sheet.webState = 'load';
  $('webBox').innerHTML = webList();
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 15000);
  try {
    const url = 'https://ru.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=30&fields=product_name,brands,nutriments&search_terms=' + encodeURIComponent(q);
    const data = await (await fetch(url, { signal: stop.signal })).json();
    const seen = new Set();
    const found = (data.products || []).map(x => {
      const t = x.nutriments || {}, k = t['energy-kcal_100g'] ?? (t['energy_100g'] ? t['energy_100g'] / 4.184 : null);
      return { n: (x.product_name || '').trim(), brand: (x.brands || '').split(',')[0].trim(), freq: '', base: 100, u: 'г', k, p: t.proteins_100g || 0, f: t.fat_100g || 0, c: t.carbohydrates_100g || 0 };
    }).filter(p => {
      const key = `${label(p)}|${Math.round(p.k)}`.toLowerCase();
      if (!p.n || !p.k || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
    if (!sheet) return;
    sheet.web = found;
    sheet.webState = found.length ? '' : 'empty';
  } catch (e) {
    if (!sheet) return;
    sheet.webState = 'error';
  }
  clearTimeout(timer);
  if ($('webBox')) $('webBox').innerHTML = webList();
}
function pickInfo() {
  const p = sheet.pick, a = Number($('xAmount').value) || 0, x = portionOf(p, a);
  $('xInfo').textContent = `${whole(x.k)} ккал · Б ${num(x.p)} Ж ${num(x.f)} У ${num(x.c)}`;
}
function renderSheet() {
  const s = $('sheet');
  s.hidden = false;
  document.body.classList.add('locked');
  let title, body;
  if (sheet.mode === 'sync') {
    const on = Sync.mode === 'writer' || Sync.mode === 'shopper';
    s.innerHTML = sheetFrame('Синхронизация', `<p class="sub">${esc(Sync.mode === 'viewer' ? 'Этот телефон только смотрит. Чтобы отмечать покупки, вставь ключ и выбери «Только покупки».' : on ? Sync.buttonText() : 'Вставь ключ GitHub и выбери, какой это телефон.')}</p>
      ${on ? '<button type="button" class="btn ghost small" data-act="forgetkey">Убрать ключ с этого телефона</button>' : `<label class="field col"><span>Ключ GitHub</span><input type="password" id="syncKey" data-act="calcinput" autocomplete="off" aria-label="Ключ GitHub"></label>
      <button type="button" class="btn small" data-act="savekey" data-role="main">Основной телефон: отмечаю еду</button>
      <button type="button" class="btn ghost small" data-act="savekey" data-role="shop">Только покупки</button>`}`);
    return;
  }
  if (sheet.mode === 'editextra') {
    const x = extrasOf(state.day)[sheet.i], src = srcOf(x);
    s.innerHTML = sheetFrame('Изменить', `<label class="field col"><span>Название</span><input type="text" id="cName" value="${esc(x.n)}" data-act="calcinput" aria-label="Название"></label>
      ${src ? `<label class="field"><span>Сколько съел</span><input type="number" inputmode="decimal" min="0" id="xAmount" value="${x.a}" data-act="calcinput" aria-label="Количество"><span>${esc(src.u)}</span></label>` : ''}
      <p class="sub">${src ? `Значения на ${num(src.base)} ${esc(src.u)}` : 'Значения на всю порцию'}</p>
      ${macroInputs(src || x)}
      <button type="button" class="btn small" data-act="saveextra">Сохранить</button>`);
    return;
  }
  if (sheet.mode === 'swap') {
    const it = findItem(sheet.id);
    title = `Заменить: ${it.n}`;
    body = `<p class="sub">Порции подобраны на те же ${whole(it.k)} ккал.</p>`;
  } else {
    title = 'Съел вне плана';
    body = '';
  }
  if (sheet.pick) {
    const p = sheet.pick, start = p.start || (p.base === 100 ? 100 : 1);
    body = `<h3>${esc(label(p))}</h3>
      <label class="field"><span>Сколько съел</span><input type="number" inputmode="decimal" min="0" id="xAmount" value="${start}" data-act="xamount" aria-label="Количество"><span>${esc(p.u)}</span></label>
      <p class="sub" id="xInfo"></p>
      <button type="button" class="btn small" data-act="addpicked">Добавить</button>
      <button type="button" class="btn ghost small" data-act="backpick">Другой продукт</button>
      ${p.mine ? '<button type="button" class="btn ghost small" data-act="delmyfood">Убрать из моих блюд</button>' : ''}`;
    s.innerHTML = sheetFrame(title, body);
    pickInfo();
    return;
  }
  const custom = sheet.mode === 'extra' ? `<details><summary>Своё блюдо, которого нет в списке</summary>
      <label class="field col"><span>Название</span><input type="text" id="cName" data-act="calcinput" aria-label="Название"></label>
      <label class="field"><span>Сколько съел</span><input type="number" inputmode="decimal" min="0" id="xAmount" data-act="calcinput" aria-label="Сколько съел, г"><span>г</span></label>
      <div class="chips cmode" role="group" aria-label="На что указаны БЖУ">
        <button type="button" class="on" data-act="cmode" data-m="100" aria-pressed="true">БЖУ на 100 г</button>
        <button type="button" data-act="cmode" data-m="all" aria-pressed="false">БЖУ на всю порцию</button>
      </div>
      ${macroInputs()}
      <label class="check"><input type="checkbox" id="cRemember" checked data-act="calcinput"><span>Запомнить в моих блюдах</span></label>
      <button type="button" class="btn small" data-act="addcustom">Добавить блюдо</button></details>` : '';
  const web = sheet.mode === 'extra' ? '<button type="button" class="btn ghost small webbtn" data-act="websearch">Найти в интернете</button><div id="webBox"></div>' : '';
  s.innerHTML = sheetFrame(title, `${body}
    <input type="search" id="sheetSearch" class="search" placeholder="Найти продукт" value="${esc(sheet.q)}" data-act="sheetsearch" aria-label="Поиск продукта">
    ${web}${custom}
    <div id="sheetList">${sheetList()}</div>`);
  if ($('webBox')) $('webBox').innerHTML = webList();
}
const sheetFrame = (title, body) => `<div class="sheetbox" role="dialog" aria-label="${esc(title)}">
  <div class="sheethead"><h2>${esc(title)}</h2><button type="button" data-act="closesheet">Закрыть</button></div>
  <div class="sheetbody">${body}</div></div>`;
function addExtra(x) {
  (state.extras[state.day] = state.extras[state.day] || []).push(x);
  save();
  closeSheet();
}

// Each photo is kept twice: a small square for the list and a larger copy to open full screen.
function photoCopies(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
      const thumb = document.createElement('canvas');
      thumb.width = thumb.height = 160;
      thumb.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 160, 160);
      const k = Math.min(1, 900 / Math.max(w, h)), big = document.createElement('canvas');
      big.width = Math.round(w * k);
      big.height = Math.round(h * k);
      big.getContext('2d').drawImage(img, 0, 0, big.width, big.height);
      URL.revokeObjectURL(url);
      resolve({ photo: thumb.toDataURL('image/jpeg', 0.7), big: big.toDataURL('image/jpeg', 0.72) });
    };
    img.onerror = reject;
    img.src = url;
  });
}
function openPhoto(v) {
  const box = document.createElement('div');
  box.className = 'photoview';
  box.dataset.act = 'closephoto';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `Фото: ${v.n}`);
  box.innerHTML = `<img src="${v.big || v.photo}" alt="${esc(v.n)}"><p>${esc(v.n)}, ${v.w} г</p><button type="button" data-act="closephoto">Закрыть</button>`;
  document.body.appendChild(box);
  document.body.classList.add('locked');
}

function shoppingList() {
  const sums = new Map();
  // shopFrom: when days are added to a running plan, shop only for the new days, with their own ticks.
  const from = PLAN.shopFrom || 0;
  PLAN.days.slice(from).forEach(day => day.meals.forEach(meal => meal.items.forEach(it => {
    const rule = SHOP.find(r => r.re.test(it.n));
    if (!rule) return;
    const name = rule.name || it.n;
    const row = sums.get(name) || { name, key: from ? `${from}:${name}` : name, g: 0, fmt: rule.fmt };
    row.g += it.a;
    sums.set(name, row);
  })));
  return [...sums.values()];
}

function renderShop() {
  const rows = shoppingList().map(r => {
    const done = !!state.shop[r.key];
    return `<button type="button" class="shop ${done ? 'done' : ''}" data-act="shop" data-name="${esc(r.key)}" aria-pressed="${done}">
      <span class="tick"><i>${done ? '✓' : ''}</i></span><span>${esc(r.name)}</span><span class="amt">${r.fmt(r.g)}</span></button>`;
  }).join('');
  const days = PLAN.days.slice(PLAN.shopFrom || 0), span = days.length > 1 ? `${days[0].tab}–${days[days.length - 1].tab}` : days[0].tab;
  $('main').innerHTML = `${window.Sync ? Sync.bar() : ''}<h1>Покупки</h1><p class="sub">На дни ${esc(span)}. Орехи и мюсли не считаем.</p>
    <section class="card">${rows}</section>`;
}

// Cookware groups, and which dishes count as a side.
const VCATS = ['Кастрюли', 'Сковородки', 'Тарелки', 'Другое'];
const vcatOf = v => (VCATS.includes(v.cat) ? v.cat
  : /кастрюл|сотейник|казан/i.test(v.n) ? 'Кастрюли' : /сковород/i.test(v.n) ? 'Сковородки' : /тарел|миск/i.test(v.n) ? 'Тарелки' : 'Другое');
const SIDE = /^(Макароны|Рис|Гречка|Пюре|Крупа|Овсян|Картофель|Булгур|Кускус)/;
const gramsOpen = {};
let rawEdit = null, rawTimer = 0;
// In the weights tab a dish is just «Макароны», not «Макароны (сухие)».
const dishName = n => n.replace(/ \((сухие|сухой|сухая)\)$/, '');
const shortDate = iso => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');

function renderGrams() {
  const thumb = v => (v.photo ? `<img src="${v.photo}" alt="">` : '');
  const cats = VCATS.filter(c => shared.vessels.some(v => vcatOf(v) === c));
  const vesselPick = `<div class="chips vfilter" role="group" aria-label="Тип посуды">
      <button type="button" class="on" data-act="vfilter" data-cat="">Вся</button>${cats.length > 1 ? cats.map(c => `<button type="button" data-act="vfilter" data-cat="${c}">${c}</button>`).join('') : ''}<button type="button" data-act="vfilter" data-custom="1">Своя</button></div>
    <div class="vpick" role="group" aria-label="Посуда">
      <button type="button" class="vp on" data-act="pickv" data-w="0"><small>Без посуды</small></button>
      ${shared.vessels.map((v, i) => `<button type="button" class="vp" data-act="pickv" data-i="${i}" data-w="${v.w}" data-cat="${vcatOf(v)}">${thumb(v)}<small><span>${esc(v.n)}</span><b>${v.w} г</b></small></button>`).join('')}
    </div>
    <label class="field vcustom" hidden><span>Вес этой посуды</span><input type="number" inputmode="numeric" min="1" data-f="vcustom" data-act="calcinput" aria-label="Вес посуды, г"><span>г</span></label>`;
  const card = n => {
    const y = shared.yield[n], at = (shared.yieldAt || {})[n], raw = (shared.raw || {})[n];
    const before = DRY.test(n) ? 'до варки' : 'до готовки';
    const rawLine = rawEdit === n
      ? `<label class="rawedit"><span>Вес ${before}</span><input type="number" inputmode="numeric" min="1" value="${raw ? raw.g : ''}" data-act="rawsave" data-name="${esc(n)}" aria-label="${esc(dishName(n))}: вес ${before}, г"><span>г</span></label>`
      : `<button type="button" class="rawbtn" data-act="rawedit" data-name="${esc(n)}">${raw ? `Вес ${before}: ${raw.g} г · ${shortDate(raw.at)}` : `+ Записать вес ${before}`}</button>`;
    return `<section class="card cook" data-name="${esc(n)}">
      <h2>${esc(dishName(n))}</h2>
      <label class="field"><span>Вес готового продукта<small class="note">из 100 г ${rawWord(n)}${y && at ? ` · обновлено ${shortDate(at)}` : ''}</small></span>
        <input type="number" inputmode="numeric" min="1" value="${y || ''}" placeholder="—" data-act="yield" data-name="${esc(n)}" aria-label="${esc(dishName(n))}: вес готового из 100 г ${rawWord(n)}"><span>г</span></label>
      ${rawLine}
      <details><summary>Посчитать по весам</summary>
        <label class="field"><span>Вес продукта ${before}</span><input type="number" inputmode="numeric" min="1" value="${raw ? raw.g : ''}" data-f="raw" data-act="calcinput" aria-label="Вес продукта ${before}, г"><span>г</span></label>
        <label class="field"><span>Вес готового вместе с посудой</span><input type="number" inputmode="numeric" min="1" data-f="scale" data-act="calcinput" aria-label="Вес готового вместе с посудой, г"><span>г</span></label>
        ${vesselPick}
        <button type="button" class="btn small" data-act="calc">Посчитать</button>
      </details>
      ${y || raw ? `<button type="button" class="btn ghost small" data-act="clearyield" data-name="${esc(n)}">Стереть, сварю новые</button>` : ''}
    </section>`;
  };
  const all = cookables();
  const group = (key, title, names) => {
    if (!names.length) return '';
    const brief = names.map(n => `${dishName(n).replace(/,.*$/, '')}${shared.yield[n] ? ` ${shared.yield[n]} г` : ''}`).join(' · ');
    return `<details class="group" data-group="${key}"${gramsOpen[key] ? ' open' : ''}>
      <summary><span><b>${title}</b><small>${esc(brief)}</small></span></summary>${names.map(card).join('')}</details>`;
  };
  const upload = (v, i, text) => `<label class="${text ? 'vreplace' : 'vthumb'}" aria-label="${text ? 'Заменить фото' : 'Добавить фото'}: ${esc(v.n)}">${text || '<i>Фото</i>'}<input type="file" accept="image/*" data-act="vphoto" data-i="${i}" hidden></label>`;
  const row = (v, i) => `<div class="vessel">${v.photo
      ? `<button type="button" class="vthumb" data-act="viewphoto" data-i="${i}" aria-label="Открыть фото: ${esc(v.n)}"><img src="${v.photo}" alt=""></button>`
      : upload(v, i)}<span>${esc(v.n)}${v.photo ? `<br>${upload(v, i, 'Заменить фото')}` : ''}</span><b>${v.w} г</b>
      <button type="button" data-act="delvessel" data-i="${i}" aria-label="Удалить: ${esc(v.n)}">Удалить</button></div>`;
  const vesselGroups = VCATS.map(c => {
    const list = shared.vessels.map((v, i) => ({ v, i })).filter(o => vcatOf(o.v) === c);
    return list.length ? `<h3 class="vcat">${c}</h3>${list.map(o => row(o.v, o.i)).join('')}` : '';
  }).join('');
  $('main').innerHTML = `<h1>Граммовки</h1><p class="sub">Впиши, сколько выходит готового, и рацион сам покажет порции.</p>
    ${group('side', 'Гарниры', all.filter(n => SIDE.test(n)))}
    ${group('main', 'Мясо и основные блюда', all.filter(n => !SIDE.test(n)))}
    <h1>Посуда</h1><p class="sub">Вес кастрюль и тарелок хранится всегда, при смене плана не пропадает.</p>
    <section class="card cook">
      ${vesselGroups || '<p class="sub" style="margin:0 0 10px">Пока пусто.</p>'}
      <label class="field col"><span>Название</span><input type="text" id="vName" data-act="calcinput" placeholder="Большая кастрюля" aria-label="Название посуды"></label>
      <label class="field col"><span>Тип</span><select id="vCat" data-act="calcinput" aria-label="Тип посуды">${VCATS.map(c => `<option>${c}</option>`).join('')}</select></label>
      <label class="field"><span>Вес</span><input type="number" inputmode="numeric" min="1" id="vWeight" data-act="calcinput" aria-label="Вес посуды, г"><span>г</span></label>
      <button type="button" class="btn small" data-act="addvessel">Добавить посуду</button>
    </section>`;
}

function render() {
  $('days').hidden = state.view !== 'plan';
  $('days').innerHTML = PLAN.days.map((day, d) =>
    `<button type="button" class="day" role="tab" data-act="day" data-d="${d}" aria-selected="${d === state.day}">${esc(day.tab)}</button>`).join('');
  $('tabPlan').setAttribute('aria-current', state.view === 'plan' ? 'page' : 'false');
  $('tabGrams').setAttribute('aria-current', state.view === 'grams' ? 'page' : 'false');
  $('tabShop').setAttribute('aria-current', state.view === 'shop' ? 'page' : 'false');
  const viewer = !!(window.Sync && Sync.viewer);
  $('tabTrain').hidden = viewer;
  if (viewer && state.view === 'train') state.view = 'plan';
  $('tabTrain').setAttribute('aria-current', state.view === 'train' ? 'page' : 'false');
  if (state.view === 'train' && !window.Sync) state.view = 'plan';
  if (state.view === 'plan') renderPlan(); else if (state.view === 'grams') renderGrams(); else if (state.view === 'train') renderTrain(); else renderShop();
}

function findItem(id) {
  const [, d, m, i] = id.match(/d(\d+)m(\d+)i(\d+)/);
  return itemAt(+d, +m, +i);
}
function setEaten(id, value) {
  const it = findItem(id);
  const n = Number(value) || 0;
  const v = Math.max(0, Math.min(it.a, it.u === 'кусок' ? Math.round(n * 2) / 2 : Math.round(n)));
  if (v) state.eaten[id] = v; else delete state.eaten[id];
  save();
}
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('on'), 2200);
}

function dayText(d) {
  const day = PLAN.days[d], { t, plan } = totals(d), lines = [`${day.title}`];
  day.meals.forEach((meal, m) => {
    lines.push(`${meal.name}:`);
    meal.items.forEach((orig, i) => {
      const it = itemAt(d, m, i), got = eatenOf(idOf(d, m, i), it);
      lines.push(`- ${it.n}: ${got >= it.a ? `съел ${it.a} ${it.u}` : got > 0 ? `съел ${got} из ${it.a} ${it.u}` : 'не ел'}`);
    });
  });
  if (extrasOf(d).length) {
    lines.push('Вне плана:');
    extrasOf(d).forEach(x => lines.push(`- ${x.n}${x.a ? `: ${x.a} ${x.u}` : ''}, ${whole(x.k)} ккал`));
  }
  lines.push(`Итого съедено: ${whole(t.k)} ккал, Б ${whole(t.p)}, Ж ${whole(t.f)}, У ${whole(t.c)}`);
  lines.push(`По плану: ${whole(plan.k)} ккал, Б ${whole(plan.p)}, Ж ${whole(plan.f)}, У ${whole(plan.c)}`);
  return lines.join('\n');
}

// What a phone without a key may do: look around, nothing that changes the marks.
const VIEWER_OK = new Set(['day', 'sync', 'closesheet', 'savekey', 'pickv', 'vfilter', 'viewphoto', 'closephoto']);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || ['input', 'cookedinput', 'yield', 'rawsave', 'calcinput', 'sheetsearch', 'xamount', 'vphoto'].includes(el.dataset.act)) return;
  const { act, id } = el.dataset;
  if (act === 'viewphoto') { openPhoto(shared.vessels[+el.dataset.i]); return; }
  if (act === 'closephoto') { document.querySelectorAll('.photoview').forEach(b => b.remove()); document.body.classList.remove('locked'); return; }
  if (window.Sync && Sync.viewer && !VIEWER_OK.has(act) && !(act === 'shop' && Sync.canShop)) {
    toast(act === 'shop' ? 'Чтобы отмечать покупки, нужен ключ: Рацион, кнопка внизу' : 'Отмечать можно только на основном телефоне');
    return;
  }
  if (act === 'sync') { sheet = { mode: 'sync' }; renderSheet(); return; }
  if (act === 'forgetkey') { Sync.forget(); return; }
  if (act === 'savekey') {
    const key = $('syncKey').value.trim();
    if (!key) { toast('Вставь ключ'); return; }
    Sync.setToken(key, el.dataset.role).then(error => {
      if (error) { toast(error); return; }
      closeSheet();
      render();
      toast('Синхронизация включена');
    });
    return;
  }
  if (act === 'pickv') {
    el.closest('.vpick').querySelectorAll('.vp').forEach(b => b.classList.toggle('on', b === el));
    // Tapping the small photo also opens it large, like in the cookware list.
    const v = shared.vessels[+el.dataset.i];
    if (e.target.closest('img') && v && v.photo) openPhoto(v);
    return;
  }
  if (act === 'rawedit') {
    rawEdit = el.dataset.name;
    render();
    const box = document.querySelector('.rawedit input');
    if (box) box.focus();
    return;
  }
  if (act === 'vfilter') {
    const card = el.closest('.cook'), cat = el.dataset.cat, own = !!el.dataset.custom;
    el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
    card.querySelectorAll('.vp[data-cat]').forEach(b => { b.hidden = !!cat && b.dataset.cat !== cat; });
    card.querySelector('.vpick').hidden = own;
    const custom = card.querySelector('.vcustom');
    custom.hidden = !own;
    if (own) custom.querySelector('input').focus();
    return;
  }
  if (act === 'extra') { sheet = { mode: 'extra', q: '' }; renderSheet(); return; }
  if (act === 'swap') { sheet = { mode: 'swap', id, q: '' }; renderSheet(); return; }
  if (act === 'closesheet') { closeSheet(); return; }
  if (act === 'pickextra') { sheet.pick = PRODUCTS[+el.dataset.i]; renderSheet(); return; }
  if (act === 'pickweb') { sheet.pick = sheet.web[+el.dataset.i]; renderSheet(); return; }
  if (act === 'websearch') { webSearch(); return; }
  if (act === 'backpick') { sheet.pick = null; renderSheet(); return; }
  if (act === 'addpicked') {
    const a = Number($('xAmount').value) || 0;
    if (a <= 0) { toast('Впиши количество'); return; }
    addExtra(portionOf(sheet.pick, a));
    render();
    return;
  }
  if (act === 'cmode') {
    el.closest('.cmode').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === el); b.setAttribute('aria-pressed', String(b === el)); });
    return;
  }
  if (act === 'addcustom') {
    const n = $('cName').value.trim(), g = Number($('xAmount').value) || 0, v = readMacros();
    const per100 = document.querySelector('.cmode .on').dataset.m === '100';
    if (!n || !v.k) { toast('Впиши название и калории'); return; }
    if (per100 && g <= 0) { toast('Впиши, сколько граммов съел'); return; }
    const base = g > 0 ? { n, base: per100 ? 100 : g, u: 'г', ...v, start: g } : { n, base: 1, u: 'порция', ...v, start: 1 };
    if ($('cRemember').checked) {
      shared.myfoods = (shared.myfoods || []).filter(p => norm(p.n) !== norm(n)).concat(base);
      saveShared();
      rebuildProducts();
    }
    addExtra(portionOf({ ...base, brand: '' }, base.start));
    render();
    return;
  }
  if (act === 'delmyfood') {
    if (!confirm('Убрать это блюдо из списка? Уже добавленные записи останутся.')) return;
    const n = sheet.pick.n;
    shared.myfoods = (shared.myfoods || []).filter(p => p.n !== n);
    saveShared();
    rebuildProducts();
    sheet.pick = null;
    renderSheet();
    return;
  }
  if (act === 'editextra') { sheet = { mode: 'editextra', i: +el.dataset.i, q: '' }; renderSheet(); return; }
  if (act === 'saveextra') {
    const list = extrasOf(state.day), x = list[sheet.i], n = $('cName').value.trim() || x.n, v = readMacros();
    if (!v.k) { toast('Впиши калории'); return; }
    const src = srcOf(x);
    if (src) {
      const g = Number($('xAmount').value) || 0;
      if (g <= 0) { toast('Впиши количество'); return; }
      list[sheet.i] = { ...portionOf({ n, brand: '', base: src.base, u: src.u, ...v }, g) };
    } else {
      list[sheet.i] = { ...x, n, ...v };
    }
    save();
    closeSheet();
    render();
    return;
  }
  if (act === 'doswap') {
    const o = swapOptions()[+el.dataset.i];
    state.swaps[sheet.id] = o.x;
    delete state.eaten[sheet.id];
    save();
    closeSheet();
    render();
    return;
  }
  if (act === 'unswap') { delete state.swaps[id]; delete state.eaten[id]; save(); render(); return; }
  if (act === 'delextra') { extrasOf(state.day).splice(+el.dataset.i, 1); save(); render(); return; }
  if (act === 'day') { state.day = +el.dataset.d; open = null; save(); render(); window.scrollTo(0, 0); return; }
  if (act === 'tick') {
    const it = findItem(id);
    setEaten(id, eatenOf(id, it) >= it.a ? 0 : it.a);
  } else if (act === 'open') {
    open = open === id ? null : id;
  } else if (act === 'plus' || act === 'minus') {
    const it = findItem(id), s = +el.dataset.step;
    setEaten(id, eatenOf(id, it) + (act === 'plus' ? s : -s));
  } else if (act === 'set') {
    setEaten(id, el.dataset.val);
  } else if (act === 'shop') {
    const n = el.dataset.name;
    const bought = !state.shop[n];
    if (bought) state.shop[n] = true; else delete state.shop[n];
    save();
    if (window.Sync) Sync.shop(n, bought);
  } else if (act === 'calc') {
    const card = el.closest('.cook'), val = f => Number(card.querySelector(`[data-f=${f}]`).value) || 0;
    const own = !!card.querySelector('.vfilter .on[data-custom]');
    const tare = own ? val('vcustom') : Number(card.querySelector('.vp.on').dataset.w);
    if (own && tare <= 0) { toast('Впиши вес своей посуды'); return; }
    const net = val('scale') - tare;
    if (val('raw') <= 0 || net <= 0) { toast('Проверь оба веса'); return; }
    shared.raw = shared.raw || {};
    shared.raw[card.dataset.name] = { g: val('raw'), at: new Date().toISOString() };
    shared.yield[card.dataset.name] = Math.round(net / val('raw') * 100);
    (shared.yieldAt = shared.yieldAt || {})[card.dataset.name] = new Date().toISOString();
    saveShared();
    toast(`Готового всего ${net} г, это ${shared.yield[card.dataset.name]} г из 100 г ${rawWord(card.dataset.name)}`);
  } else if (act === 'clearyield') {
    delete shared.yield[el.dataset.name];
    if (shared.yieldAt) delete shared.yieldAt[el.dataset.name];
    if (shared.raw) delete shared.raw[el.dataset.name];
    saveShared();
  } else if (act === 'addvessel') {
    const n = $('vName').value.trim(), w = Math.round(Number($('vWeight').value) || 0);
    if (!n || w <= 0) { toast('Впиши название и вес'); return; }
    shared.vessels.push({ n, w, cat: $('vCat').value });
    saveShared();
  } else if (act === 'delvessel') {
    if (!confirm('Удалить эту посуду?')) return;
    shared.vessels.splice(+el.dataset.i, 1);
    saveShared();
  }
  render();
});
document.addEventListener('input', e => {
  const act = e.target.dataset.act;
  if (act === 'sheetsearch') { sheet.q = e.target.value; $('sheetList').innerHTML = sheetList(); }
  if (act === 'xamount') pickInfo();
  // The raw weight box folds back into a line by itself a moment after typing stops.
  if (act === 'rawsave') {
    clearTimeout(rawTimer);
    const box = e.target;
    rawTimer = setTimeout(() => { if (box.isConnected) saveRaw(box); }, 1200);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.act === 'rawsave') saveRaw(e.target);
});
document.addEventListener('focusout', e => {
  if (e.target.dataset && e.target.dataset.act === 'rawsave' && e.target.isConnected) saveRaw(e.target);
});
function saveRaw(t) {
  clearTimeout(rawTimer);
  if (rawEdit === null) return;
  rawEdit = null;
  const g = Math.round(Number(t.value) || 0), name = t.dataset.name, old = (shared.raw || {})[name];
  shared.raw = shared.raw || {};
  if (!old || old.g !== g) {
    if (g > 0) shared.raw[name] = { g, at: new Date().toISOString() }; else delete shared.raw[name];
    saveShared();
  }
  render();
}
document.addEventListener('change', e => {
  const t = e.target, act = t.dataset.act;
  if (window.Sync && Sync.viewer && ['input', 'vphoto', 'cookedinput', 'yield', 'rawsave'].includes(act)) {
    toast('Менять можно только на основном телефоне');
    render();
    return;
  }
  if (act === 'input') { setEaten(t.dataset.id, t.value); render(); }
  if (act === 'vphoto' && t.files[0]) {
    photoCopies(t.files[0]).then(copies => {
      Object.assign(shared.vessels[+t.dataset.i], copies);
      saveShared();
      render();
    }).catch(() => toast('Не получилось прочитать фото'));
  }
  if (act === 'cookedinput') {
    const it = findItem(t.dataset.id);
    setEaten(t.dataset.id, Number(t.value) * 100 / shared.yield[it.n]);
    render();
  }
  if (act === 'rawsave' && t.isConnected) saveRaw(t);
  if (act === 'yield') {
    const v = Math.round(Number(t.value) || 0);
    shared.yieldAt = shared.yieldAt || {};
    if (v > 0) { shared.yield[t.dataset.name] = v; shared.yieldAt[t.dataset.name] = new Date().toISOString(); }
    else { delete shared.yield[t.dataset.name]; delete shared.yieldAt[t.dataset.name]; }
    saveShared();
    render();
  }
});
// Remember which dish groups are open, so a re-render does not fold them back.
document.addEventListener('toggle', e => { if (e.target.dataset && e.target.dataset.group) gramsOpen[e.target.dataset.group] = e.target.open; }, true);
$('tabPlan').addEventListener('click', () => { state.view = 'plan'; save(); render(); window.scrollTo(0, 0); });
$('tabGrams').addEventListener('click', () => { state.view = 'grams'; save(); render(); window.scrollTo(0, 0); });
$('tabTrain').addEventListener('click', () => { state.view = 'train'; save(); render(); window.scrollTo(0, 0); });
$('tabShop').addEventListener('click', () => { state.view = 'shop'; save(); render(); window.scrollTo(0, 0); });

if (state.day >= PLAN.days.length) state.day = 0;
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
