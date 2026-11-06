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
}
const state = Object.assign({ eaten: {}, shop: {}, day: 0, view: 'plan' }, load());
let open = null;

// Cooked weights and dishes outlive any single plan, so they have their own key.
const SHARED = 'pitanie:shared';
let sharedMemory = {};
function loadShared() {
  try { return JSON.parse(localStorage.getItem(SHARED)) || {}; } catch (e) { return sharedMemory; }
}
const shared = Object.assign({ yield: {}, vessels: [] }, loadShared());
function saveShared() {
  sharedMemory = shared;
  try { localStorage.setItem(SHARED, JSON.stringify(shared)); } catch (e) { /* the page still works for this visit */ }
}
const COOK = /^(Макароны|Рис|Гречка|Наггетсы|Рулетики|Фарш|Куриная грудка|Бёдра|Филе|Говядина|Курица|Индейка|Свинина|Рыба|Котлеты)/;
const cookables = () => [...new Set(PLAN.days.flatMap(d => d.meals.flatMap(m => m.items.map(it => it.n))).filter(n => COOK.test(n)))];
const cookedOf = (it, raw) => (shared.yield[it.n] ? Math.round(raw * shared.yield[it.n] / 100) : null);

const $ = id => document.getElementById(id);
const num = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
const whole = x => Math.round(x).toString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const idOf = (d, m, i) => `d${d}m${m}i${i}`;
const eatenOf = (id, it) => Math.min(state.eaten[id] || 0, it.a);

function totals(d) {
  const t = { p: 0, f: 0, c: 0, k: 0, fb: 0 }, plan = { p: 0, f: 0, c: 0, k: 0, fb: 0 };
  PLAN.days[d].meals.forEach((meal, m) => meal.items.forEach((it, i) => {
    const part = eatenOf(idOf(d, m, i), it) / it.a;
    for (const key in t) { t[key] += it[key] * part; plan[key] += it[key]; }
  }));
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
    const left = meal.items.filter((it, i) => eatenOf(idOf(d, m, i), it) < it.a).length;
    const kcal = meal.items.reduce((s, it) => s + it.k, 0);
    return `<section class="card meal">
      <div class="mealhead"><h2>${esc(meal.name)}</h2><span>${left ? `осталось ${left} · ` : 'всё съедено · '}${whole(kcal)} ккал</span></div>
      ${meal.items.map((it, i) => itemHtml(d, m, i, it)).join('')}
    </section>`;
  }).join('');
  $('main').innerHTML = `<h1>${esc(day.title)}</h1><p class="sub">${esc(day.note || '')}</p>
    ${summary(d)}${meals}
    <div class="actions">
      <button type="button" class="btn" data-act="copy">Скопировать итог дня</button>
      <button type="button" class="btn ghost" data-act="reset">Сбросить отметки этого дня</button>
    </div><div id="copyBox"></div>`;
}

function shoppingList() {
  const sums = new Map();
  PLAN.days.forEach(day => day.meals.forEach(meal => meal.items.forEach(it => {
    const rule = SHOP.find(r => r.re.test(it.n));
    if (!rule) return;
    const name = rule.name || it.n;
    const row = sums.get(name) || { name, g: 0, fmt: rule.fmt };
    row.g += it.a;
    sums.set(name, row);
  })));
  return [...sums.values()];
}

function renderShop() {
  const rows = shoppingList().map(r => {
    const done = !!state.shop[r.name];
    return `<button type="button" class="shop ${done ? 'done' : ''}" data-act="shop" data-name="${esc(r.name)}" aria-pressed="${done}">
      <span class="tick"><i>${done ? '✓' : ''}</i></span><span>${esc(r.name)}</span><span class="amt">${r.fmt(r.g)}</span></button>`;
  }).join('');
  const n = PLAN.days.length;
  $('main').innerHTML = `<h1>Покупки</h1><p class="sub">На весь план, дней: ${n}. Орехи и мюсли не считаем.</p>
    <section class="card">${rows}</section>`;
}

function renderGrams() {
  const vesselOptions = '<option value="0">Без посуды</option>' + shared.vessels.map(v =>
    `<option value="${v.w}">${esc(v.n)}, ${v.w} г</option>`).join('');
  const cards = cookables().map(n => {
    const y = shared.yield[n];
    return `<section class="card cook" data-name="${esc(n)}">
      <h2>${esc(n)}</h2>
      <label class="field"><span>Из 100 г сырого выходит</span>
        <input type="number" inputmode="numeric" min="1" value="${y || ''}" placeholder="—" data-act="yield" data-name="${esc(n)}" aria-label="${esc(n)}: вес готового из 100 г сырого"><span>г</span></label>
      <details><summary>Посчитать по весам</summary>
        <label class="field"><span>Сырой вес всего</span><input type="number" inputmode="numeric" min="1" data-f="raw" data-act="calcinput" aria-label="Сырой вес, г"><span>г</span></label>
        <label class="field"><span>На весах вместе с посудой</span><input type="number" inputmode="numeric" min="1" data-f="scale" data-act="calcinput" aria-label="Вес на весах, г"><span>г</span></label>
        <label class="field col"><span>Посуда</span><select data-f="vessel" data-act="calcinput" aria-label="Посуда">${vesselOptions}</select></label>
        <button type="button" class="btn small" data-act="calc">Посчитать</button>
      </details>
      ${y ? `<button type="button" class="btn ghost small" data-act="clearyield" data-name="${esc(n)}">Стереть, сварю новые</button>` : ''}
    </section>`;
  }).join('');
  const vessels = shared.vessels.map((v, i) => `<div class="vessel"><span>${esc(v.n)}</span><b>${v.w} г</b>
      <button type="button" data-act="delvessel" data-i="${i}" aria-label="Удалить: ${esc(v.n)}">Удалить</button></div>`).join('');
  $('main').innerHTML = `<h1>Граммовки</h1><p class="sub">Впиши, сколько выходит готового, и рацион сам покажет порции.</p>
    ${cards}
    <h1>Посуда</h1><p class="sub">Вес кастрюль и тарелок хранится всегда, при смене плана не пропадает.</p>
    <section class="card cook">
      ${vessels || '<p class="sub" style="margin:0 0 10px">Пока пусто.</p>'}
      <label class="field col"><span>Название</span><input type="text" id="vName" data-act="calcinput" placeholder="Большая кастрюля" aria-label="Название посуды"></label>
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
  if (state.view === 'plan') renderPlan(); else if (state.view === 'grams') renderGrams(); else renderShop();
}

function findItem(id) {
  const [, d, m, i] = id.match(/d(\d+)m(\d+)i(\d+)/);
  return PLAN.days[+d].meals[+m].items[+i];
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
    meal.items.forEach((it, i) => {
      const got = eatenOf(idOf(d, m, i), it);
      lines.push(`- ${it.n}: ${got >= it.a ? `съел ${it.a} ${it.u}` : got > 0 ? `съел ${got} из ${it.a} ${it.u}` : 'не ел'}`);
    });
  });
  lines.push(`Итого съедено: ${whole(t.k)} ккал, Б ${whole(t.p)}, Ж ${whole(t.f)}, У ${whole(t.c)}`);
  lines.push(`По плану: ${whole(plan.k)} ккал, Б ${whole(plan.p)}, Ж ${whole(plan.f)}, У ${whole(plan.c)}`);
  return lines.join('\n');
}
async function copyDay() {
  const text = dayText(state.day);
  try {
    await navigator.clipboard.writeText(text);
    toast('Итог дня скопирован');
  } catch (e) {
    $('copyBox').innerHTML = '<textarea class="copy" readonly aria-label="Итог дня"></textarea>';
    const box = $('copyBox').firstChild;
    box.value = text;
    box.focus();
    box.select();
    toast('Выдели текст и скопируй');
  }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || ['input', 'cookedinput', 'yield', 'calcinput'].includes(el.dataset.act)) return;
  const { act, id } = el.dataset;
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
    if (state.shop[n]) delete state.shop[n]; else state.shop[n] = true;
    save();
  } else if (act === 'calc') {
    const card = el.closest('.cook'), val = f => Number(card.querySelector(`[data-f=${f}]`).value) || 0;
    const net = val('scale') - val('vessel');
    if (val('raw') <= 0 || net <= 0) { toast('Проверь сырой вес и вес на весах'); return; }
    shared.yield[card.dataset.name] = Math.round(net / val('raw') * 100);
    saveShared();
    toast(`Готового всего ${net} г, из 100 г сырого ${shared.yield[card.dataset.name]} г`);
  } else if (act === 'clearyield') {
    delete shared.yield[el.dataset.name];
    saveShared();
  } else if (act === 'addvessel') {
    const n = $('vName').value.trim(), w = Math.round(Number($('vWeight').value) || 0);
    if (!n || w <= 0) { toast('Впиши название и вес'); return; }
    shared.vessels.push({ n, w });
    saveShared();
  } else if (act === 'delvessel') {
    if (!confirm('Удалить эту посуду?')) return;
    shared.vessels.splice(+el.dataset.i, 1);
    saveShared();
  } else if (act === 'copy') {
    copyDay();
    return;
  } else if (act === 'reset') {
    if (!confirm('Сбросить все отметки этого дня?')) return;
    Object.keys(state.eaten).filter(k => k.startsWith(`d${state.day}m`)).forEach(k => delete state.eaten[k]);
    open = null;
    save();
  }
  render();
});
document.addEventListener('change', e => {
  const t = e.target, act = t.dataset.act;
  if (act === 'input') { setEaten(t.dataset.id, t.value); render(); }
  if (act === 'cookedinput') {
    const it = findItem(t.dataset.id);
    setEaten(t.dataset.id, Number(t.value) * 100 / shared.yield[it.n]);
    render();
  }
  if (act === 'yield') {
    const v = Math.round(Number(t.value) || 0);
    if (v > 0) shared.yield[t.dataset.name] = v; else delete shared.yield[t.dataset.name];
    saveShared();
    render();
  }
});
$('tabPlan').addEventListener('click', () => { state.view = 'plan'; save(); render(); window.scrollTo(0, 0); });
$('tabGrams').addEventListener('click', () => { state.view = 'grams'; save(); render(); window.scrollTo(0, 0); });
$('tabShop').addEventListener('click', () => { state.view = 'shop'; save(); render(); window.scrollTo(0, 0); });

if (state.day >= PLAN.days.length) state.day = 0;
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
