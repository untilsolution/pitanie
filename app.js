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
  { re: /^Пюре/, name: 'Пюре (картофель, лук, молоко, масло)', fmt: g => grams(g) },
  { re: /^Говядина/, name: 'Говядина', fmt: g => grams(g) },
  { re: /^Индейка духовая/, name: 'Индейка духовая Индилайт', fmt: g => grams(g) },
  { re: /^Рис/, name: 'Рис', fmt: g => grams(g) },
  { re: /^Гречка/, name: 'Гречка', fmt: g => grams(g) },
  { re: /^Куриная грудка/, name: 'Куриная грудка', fmt: g => grams(g) },
  { re: /^Соус терияки/, name: 'Соус терияки', fmt: g => grams(g) },
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
// mydays: days the user made himself. adds, removed, amt: his changes to any day (added products, removed ones, new portions).
// hidden: plan days the user took off the tabs; their ticks stay and he can bring them back.
// train: the user's own «тренировка / без тренировки» for a day; trainAdj: what that switch changed, to undo it.
const state = Object.assign({ eaten: {}, shop: {}, day: 0, view: 'plan', swaps: {}, extras: {}, mydays: [], adds: {}, removed: {}, amt: {}, train: {}, trainAdj: {}, hidden: {} }, load());
let open = null;

// Cooked weights and dishes outlive any single plan, so they have their own key.
const SHARED = 'pitanie:shared';
let sharedMemory = {};
function loadShared() {
  try { return JSON.parse(localStorage.getItem(SHARED)) || {}; } catch (e) { return sharedMemory; }
}
const shared = Object.assign({ yield: {}, yieldAt: {}, vessels: [], myfoods: [], raw: {}, cookAdd: [], cookHide: [], cookSeen: [], prodEdit: {} }, loadShared());
function saveShared() {
  sharedMemory = shared;
  try { localStorage.setItem(SHARED, JSON.stringify(shared)); } catch (e) { /* the page still works for this visit */ }
  if (window.Sync) Sync.changed();
}
const COOK = /^(Пюре|Макароны|Рис|Гречка|Наггетсы|Рулетики|Фарш|Куриная грудка|Бёдра|Филе|Говядина|Курица|Индейка|Свинина|Рыба|Котлеты|Лазанья|Картофель жареный|Голень)/;
// One-off food from outside is not cooked at home, so it never gets a weights card by itself.
const NOT_COOKED = /«Вкусно и точка»|вялен|сушён|слабосол|копчён/i;
const DRY = /^(Макароны|Рис|Гречка|Крупа|Овсян)/;
// Mash is planned by the weight of its raw ingredients, like pasta and meat.
const MASH = /^Пюре/;
const rawWord = n => (DRY.test(n) ? 'сухого' : MASH.test(n) ? 'продуктов' : 'сырого');
// showFrom: older days stay in the plan (their ticks keep their ids) but are hidden from the tabs.
const SHOW_FROM = Math.min(PLAN.showFrom || 0, PLAN.days.length - 1);
// User-made days get numbers from MY up, so new plan days never collide with them.
const MY = 1000;
const isTrainTitle = t => /тренировк/i.test(t) && !/без тренировк/i.test(t);
// When the user switches a day between training and rest, its title and the shake meals follow.
const RENAME = { true: [['Полдник', 'Перед тренировкой'], ['Ужин', 'Ужин после тренировки']], false: [['Перед тренировкой', 'Полдник'], ['Ужин после тренировки', 'Ужин']] };
function dayAt(d) {
  const day = d >= MY ? state.mydays[d - MY] : PLAN.days[d], t = (state.train || {})[d];
  if (!day || t === undefined) return day;
  const pairs = RENAME[t];
  return { ...day, title: `${day.title.replace(/, (без тренировки|тренировка)$/, '')}, ${t ? 'тренировка' : 'без тренировки'}`,
    meals: day.meals.map(meal => { const r = pairs.find(([a]) => a === meal.name); return r && !day.meals.some(x => x.name === r[1]) ? { ...meal, name: r[1] } : meal; }) };
}
const isTrain = d => isTrainTitle(dayAt(d).title);
// Tabs go by calendar date, plan days and the user's own days mixed; 30, 31 November come before 1 December.
const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DATE_IN_TITLE = new RegExp(String.raw`(\d{1,2}) (` + MONTH_NAMES.join('|') + ')');
function dayTime(d) {
  const m = ((dayAt(d) || {}).title || '').match(DATE_IN_TITLE);
  if (!m) return Infinity;
  const now = new Date(), half = 182 * 864e5;
  let dt = new Date(now.getFullYear(), MONTH_NAMES.indexOf(m[2]), +m[1]);
  // A title has no year: take the one that puts the day nearest to today, so January follows December.
  if (dt - now > half) dt = new Date(now.getFullYear() - 1, dt.getMonth(), dt.getDate());
  else if (now - dt > half) dt = new Date(now.getFullYear() + 1, dt.getMonth(), dt.getDate());
  return dt.getTime();
}
const dayIds = () => [...PLAN.days.map((x, d) => d).filter(d => d >= SHOW_FROM && !state.hidden[d]), ...(state.mydays || []).map((x, j) => (x ? MY + j : -1)).filter(d => d >= 0)]
  .map((d, i) => ({ d, i, t: dayTime(d) })).sort((a, b) => a.t - b.t || a.i - b.i).map(x => x.d);
// Dishes the user cooks now and then stay in the grams list even when the current days lack them.
const COOK_KEEP = ['Макароны', 'Гречка', 'Индейка духовая Индилайт'];
// Old long names of the same products (user, 2026-11-27: just «Рис», «Гречка», «Макароны»). Everything saved under an old name moves to the new one.
const RENAMED = {
  'Рис (сухой)': 'Рис', 'Рис шлифованный круглозёрный (сухой)': 'Рис', 'Рис шлифованный круглозерный (сухой)': 'Рис',
  'Макароны (сухие)': 'Макароны', 'Макароны / спагетти из твёрдых сортов (сухие)': 'Макароны',
  'Гречка ядрица (сухая)': 'Гречка', 'Хлопья овсяные быстрые (сухие)': 'Хлопья овсяные', 'Фарш говяжий постный': 'Фарш говяжий',
};
const newName = n => {
  if (typeof n !== 'string') return n;
  for (const [a, b] of Object.entries(RENAMED)) if (n === a || n.startsWith(a + ', ')) return b + n.slice(a.length);
  return n;
};
function fixNames() {
  let changed = false;
  const keys = box => { if (!box) return; for (const k of Object.keys(box)) { const n = newName(k); if (n !== k) { if (box[n] === undefined || (shared.yieldAt || {})[k] > (shared.yieldAt || {})[n]) box[n] = box[k]; delete box[k]; changed = true; } } };
  const list = arr => (Array.isArray(arr) ? [...new Set(arr.map(n => { const m = newName(n); if (m !== n) changed = true; return m; }))] : arr);
  const item = x => { if (x && typeof x.n === 'string') { const m = newName(x.n); if (m !== x.n) { x.n = m; changed = true; } } };
  // The newest weighing wins when the old and the new name both have one.
  const at = { ...(shared.yieldAt || {}) };
  for (const k of Object.keys(shared.yield || {})) { const n = newName(k); if (n !== k) { if (shared.yield[n] === undefined || (at[k] || '') > (at[n] || '')) { shared.yield[n] = shared.yield[k]; if (at[k]) shared.yieldAt[n] = at[k]; } delete shared.yield[k]; if (shared.yieldAt) delete shared.yieldAt[k]; changed = true; } }
  keys(shared.raw);
  shared.cookHide = list(shared.cookHide);
  shared.cookSeen = list(shared.cookSeen);
  (shared.cookAdd || []).forEach(item);
  if (shared.cookAdd) shared.cookAdd = shared.cookAdd.filter((x, i, a) => a.findIndex(y => y.n === x.n) === i);
  Object.values(state.swaps || {}).forEach(item);
  Object.values(state.adds || {}).forEach(l => (l || []).forEach(item));
  Object.values(state.extras || {}).forEach(l => (l || []).forEach(item));
  (state.mydays || []).forEach(day => day && day.meals.forEach(meal => meal.items.forEach(item)));
  return changed;
}
// The grams list only grows: a dish once seen stays (shared.cookSeen) until the user hides it himself.
const cookables = () => {
  const hide = shared.cookHide || [], own = (shared.cookAdd || []).map(x => x.n);
  const now = [...dayIds().flatMap(d => dayItems(d).map(o => o.it.n)), ...PLAN.days.flatMap(day => day.meals.flatMap(meal => meal.items.map(it => it.n))), ...Object.keys(shared.yield || {})]
    .filter(n => COOK.test(n) && !NOT_COOKED.test(n));
  const seen = shared.cookSeen || [], fresh = [...new Set([...COOK_KEEP, ...now])].filter(n => !seen.includes(n));
  if (fresh.length && !(window.Sync && Sync.viewer)) { shared.cookSeen = [...seen, ...fresh]; saveShared(); }
  return [...new Set([...now, ...seen, ...fresh, ...own])].filter(n => !hide.includes(n));
};
const cookedOf = (it, raw) => (shared.yield[it.n] ? Math.round(raw * shared.yield[it.n] / 100) : null);

const $ = id => document.getElementById(id);
const num = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
const whole = x => Math.round(x).toString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const idOf = (d, m, i) => `d${d}m${m}i${i}`;
const scaled = (it, a) => {
  const k = a / it.a, r = x => +((x || 0) * k).toFixed(1);
  return { ...it, a, p: r(it.p), f: r(it.f), c: r(it.c), k: r(it.k), fb: r(it.fb), was: it.a };
};
// The item as it stands now: a swap, an added product (numbers from 100) or the plan's own, at the portion the user set.
function itemAt(d, m, i) {
  const id = idOf(d, m, i);
  const base = state.swaps[id] || (i >= 100 ? (state.adds[`d${d}m${m}`] || [])[i - 100] : dayAt(d).meals[m].items[i]);
  const a = state.amt[id];
  return base && a && a !== base.a ? scaled(base, a) : base;
}
function mealItems(d, m) {
  const own = dayAt(d).meals[m].items.length, extra = (state.adds[`d${d}m${m}`] || []).length, out = [];
  for (let n = 0; n < own + extra; n++) {
    const i = n < own ? n : 100 + n - own, id = idOf(d, m, i);
    if (!state.removed[id]) out.push({ m, i, id, it: itemAt(d, m, i) });
  }
  return out;
}
const dayItems = d => dayAt(d).meals.flatMap((meal, m) => mealItems(d, m));
const extrasOf = d => state.extras[d] || [];
// Ready-made food that is not in the table. Typical values, per 100 g.
const READY_FOOD = [
  { cat: 'Готовая еда', n: 'Шаурма с курицей', brand: '', freq: '', base: 100, u: 'г', p: 8.5, f: 8, c: 22, k: 190, start: 350 },
  { cat: 'Готовая еда', n: 'Картофель фри', brand: '', freq: '', base: 100, u: 'г', p: 3, f: 15, c: 40, k: 310, start: 100 },
  { cat: 'Закуски', n: 'Сухарики к пиву', brand: '', freq: '', base: 100, u: 'г', p: 10.1, f: 8.4, c: 67.7, k: 386, start: 50 },
  { cat: 'Закуски', n: 'Щёчки судака сушёные', brand: '', freq: '', base: 100, u: 'г', p: 55, f: 3, c: 0, k: 250, start: 75 },
];
// The product list: the table, ready-made food and the dishes the user saved. Rebuilt in place when "my dishes" change.
const PRODUCTS = [];
function rebuildProducts() {
  const mine = (shared.myfoods || []).map(p => ({ ...p, cat: 'Мои блюда', brand: '', freq: '', mine: true }));
  // The user's own names for table products and the ones he hid, made on the phone.
  const edit = shared.prodEdit || {};
  const own = [...(window.PRODUCTS || []), ...READY_FOOD].filter(p => !(edit[p.n] || {}).hidden).map(p => (edit[p.n] && edit[p.n].n ? { ...p, orig: p.n, n: edit[p.n].n } : p));
  const table = [...own, ...mine], have = new Set([...table.map(p => norm(p.n)), ...table.filter(p => p.orig).map(p => norm(p.orig))]);
  // The reference list only fills gaps: the user's own numbers always win.
  const ref = (window.FOODS || []).filter(f => !have.has(norm(f[0]))).map(([n, p, f, c, k, start]) => ({ cat: 'Справочник', n, brand: '', freq: '', base: 100, u: 'г', p, f, c, k, start, ref: true }));
  PRODUCTS.length = 0;
  PRODUCTS.push(...[...table, ...ref].sort((x, y) => x.n.localeCompare(y.n, 'ru')));
}
const SWAPPABLE = /^(Мармелад|Чокопай|Шоколад|Зефир|Мёд|Джем|Пряники|Пломбир|Печенье|Банан|Яблоко|Киви|Апельсин|Мандарин|Слива|Грецкий|Миндаль|Фундук|Кедровые|Курага)/;
const SWAP_CATS = ['Сладкое', 'Овощи и фрукты', 'Орехи и сухофрукты'];
const label = p => p.n + (p.brand ? `, ${p.brand}` : '');
// Search treats Ё and Е as the same letter, as people usually type Е.
function norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е'); }
rebuildProducts();
// Swap groups: a product is replaced only by one of its own kind. `by` says what stays equal: calories or protein.
const GROUPS = {
  sweet: { by: 'k', unit: 5, title: 'сладкое, фрукты и орехи' },
  side: { by: 'k', unit: 5, title: 'гарниры и хлеб' },
  meat: { by: 'p', unit: 10, title: 'мясо и рыба' },
  protein: { by: 'p', unit: 5, title: 'белковые продукты' },
  sauce: { by: 'k', unit: 5, title: 'соусы' },
  cereal: { by: 'k', unit: 5, title: 'хлопья, подушечки, шарики и мюсли' },
  milk: { by: 'k', unit: 50, title: 'молоко и кисломолочное' },
  cold: { by: 'p', unit: 5, title: 'ветчина и колбасы' },
  ready: { by: 'k', unit: 10, title: 'готовая еда' },
};
// Sweets and drinks from the reference list: eaten outside the plan, they are paid for with the plan's sweets.
const SWEETS = /^(Торт|Чизкейк|Тирамису|Эклер|Пирожное|Мороженое|Вафли|Халва|Конфеты|Пончик|Круассан|Булочка|Сочник|Ватрушка|Попкорн|Кола|Сок |Морс|Компот|Энергетик|Шоколадный батончик)/;
const G_SAUCE = /^(Соус|Кетчуп|Майонез|Горчица)/;
// Bread counts as a side: rice can become bread and back.
const G_SIDE = /^(Макароны|Рис[ ,(]|Рис$|Гречка|Пюре|Картофель|Булгур|Кускус|Хлеб|Лаваш|Лепёшка роти классическая|Булочки для)/;
const G_CEREAL = /^(Подушечки|Хлопья|Шарики|Мюсли|Овсяные)/;
const G_MILK = /^(Молоко|Кефир|Ряженка)/;
const G_COLD = /^(Ветчина|Колбаски|Молочная колбаса|Филе грудки копчёное)/;
const G_MEAT = /^(Куриная|Бёдра|Голень|Филе|Фарш|Рулетики|Говядина|Индейка|Наггетсы в|Курица|Свинина|Котлет|Рыба красная|Сельдь|Креветки|Тунец)/;
const G_PROTEIN = /^(Творожная запеканка|Творог|Сырники|Протеин|Сыр «Большой куш»|Сыр 20%|Йогурт 2%|Йогурт Teos|Белок яичный|Яйцо)/;
function groupOf(n, cat) {
  // Ready dishes (burgers, roti, lasagna, fast food) swap among themselves by calories.
  if (cat === 'Готовая еда') return 'ready';
  if (G_SAUCE.test(n)) return 'sauce';
  if (G_CEREAL.test(n)) return 'cereal';
  if (G_MILK.test(n)) return 'milk';
  if (G_COLD.test(n)) return 'cold';
  if (G_SIDE.test(n)) return 'side';
  if (G_MEAT.test(n)) return 'meat';
  if (G_PROTEIN.test(n)) return 'protein';
  // Anything new in these table categories joins its group even if no name rule above knows it.
  if (cat === 'Мясо и птица' || cat === 'Рыба') return 'meat';
  if (cat === 'Колбасные изделия') return 'cold';
  if (cat === 'Соусы' && !/^Масло/.test(n)) return 'sauce';
  if (SWAPPABLE.test(n) || SWEETS.test(n) || (SWAP_CATS.includes(cat) && !/^(Огурец|Сгущёнка)/.test(n))) return 'sweet';
  return null;
}
// The table entry a plan product came from, to know its category.
function productOf(n) {
  const k = norm(n);
  let best = null;
  for (const p of PRODUCTS) {
    if (p.ref) continue;
    for (const a of [norm(p.n), p.orig && norm(p.orig)].filter(Boolean)) {
      if ((k.startsWith(a) || norm(label(p)).startsWith(k)) && (!best || a.length > norm(best.n).length)) best = p;
    }
  }
  return best;
}
const pieces = u => u !== 'г' && u !== 'мл';
const unitOf = (n, u, g) => (pieces(u) ? 0.5 : /^Чокопай/.test(n) ? 30 : /^(Хлеб|Булочки)/.test(n) ? 25 : (GROUPS[g] || { unit: 5 }).unit);
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

// t: eaten; plan: the day's norm as the plan wrote it, which removing, swapping or resizing never moves;
// now: what the day holds at the moment, with the user's changes.
function totals(d) {
  const t = { p: 0, f: 0, c: 0, k: 0, fb: 0 }, plan = { p: 0, f: 0, c: 0, k: 0, fb: 0 }, now = { p: 0, f: 0, c: 0, k: 0, fb: 0 };
  dayItems(d).forEach(({ id, it }) => {
    const part = eatenOf(id, it) / it.a;
    for (const key in t) { t[key] += (it[key] || 0) * part; now[key] += it[key] || 0; }
  });
  dayAt(d).meals.forEach(meal => meal.items.forEach(it => { for (const key in plan) plan[key] += it[key] || 0; }));
  extrasOf(d).forEach(x => { for (const key in t) t[key] += x[key] || 0; });
  return { t, plan, now };
}
// What the user changed in a day against its plan: removed, resized, swapped, added, the day type.
function changesOf(d) {
  const c = { removed: 0, amt: 0, swaps: 0, adds: 0, train: (state.train || {})[d] !== undefined };
  dayAt(d).meals.forEach((meal, m) => {
    meal.items.forEach((it, i) => {
      const id = idOf(d, m, i);
      if (state.removed[id]) c.removed++;
      else if (state.swaps[id]) c.swaps++;
      else if (state.amt[id] && state.amt[id] !== it.a) c.amt++;
    });
    (state.adds[`d${d}m${m}`] || []).forEach((x, j) => { if (!state.removed[idOf(d, m, 100 + j)]) c.adds++; });
  });
  c.any = c.removed + c.amt + c.swaps + c.adds > 0 || c.train;
  return c;
}
// Puts the day back to its plan. What was already eaten stays as it is, food outside the plan too.
function resetDay(d) {
  const ate = id => state.eaten[id] > 0;
  dayAt(d).meals.forEach((meal, m) => {
    meal.items.forEach((it, i) => {
      const id = idOf(d, m, i);
      if (ate(id) && (state.swaps[id] || state.amt[id])) return;
      delete state.removed[id]; delete state.swaps[id]; delete state.amt[id];
    });
    const key = `d${d}m${m}`, list = state.adds[key] || [];
    if (!list.some((x, j) => ate(idOf(d, m, 100 + j)))) {
      delete state.adds[key];
      list.forEach((x, j) => { const id = idOf(d, m, 100 + j); delete state.removed[id]; delete state.amt[id]; delete state.swaps[id]; delete state.eaten[id]; });
    } else list.forEach((x, j) => { const id = idOf(d, m, 100 + j); if (!ate(id)) state.removed[id] = true; });
  });
  // Recounts already made for outside food are forgotten, so deleting that food later does not undo the reset.
  extrasOf(d).forEach(x => { x.adj = []; });
  delete state.train[d];
  delete state.trainAdj[d];
}

function summary(d) {
  const { t, plan, now } = totals(d), ch = changesOf(d), viewer = window.Sync && Sync.viewer;
  const pct = (a, b) => Math.min(100, b ? a / b * 100 : 0);
  // Over the plan is said in red, under it as what is still to eat.
  const rest = (a, b, unit, minOver) => (a - b >= minOver ? `<span class="ov">${unit ? `+${whole(a - b)}${unit} сверх плана` : `больше плана на ${whole(a - b)}`}</span>` : `<span>ещё ${whole(Math.max(0, b - a))}${unit}</span>`);
  const macro = (label, a, b, color) => `<div class="macro"><small>${label}</small>
    <b>${whole(a)} <em>из ${whole(b)} г</em></b>
    <div class="bar${a - b >= 3 ? ' over' : ''}"><i style="width:${pct(a, b)}%;background:var(${color})"></i></div>
    <small class="mrest">${rest(a, b, ' г', 3)}</small></div>`;
  const parts = [ch.removed && `убрано ${ch.removed}`, ch.amt && `порций изменено ${ch.amt}`, ch.swaps && `замен ${ch.swaps}`, ch.adds && `добавлено ${ch.adds}`, ch.train && 'другой тип дня'].filter(Boolean);
  const diff = Math.round(now.k - plan.k);
  const changed = ch.any ? `<div class="dchg"><p><b>День изменён:</b> ${parts.join(', ')}. В дне сейчас ${whole(now.k)} ккал, по плану ${whole(plan.k)}${Math.abs(diff) >= 10 ? ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)})` : ''}.</p>
    ${viewer ? '' : '<button type="button" class="btn ghost small" data-act="resetday">Вернуть день к плану</button>'}</div>` : '';
  return `<section class="card sum" aria-label="Итог дня">
    <div class="kcal"><b>${whole(t.k)} <em>из ${whole(plan.k)} ккал</em></b>${rest(t.k, plan.k, '', 30)}</div>
    <div class="bar${t.k - plan.k >= 30 ? ' over' : ''}" style="margin-top:8px"><i style="width:${pct(t.k, plan.k)}%;background:var(--kcal)"></i></div>
    <div class="macros">${macro('Белки', t.p, plan.p, '--prot')}${macro('Жиры', t.f, plan.f, '--fat')}${macro('Углеводы', t.c, plan.c, '--carb')}</div>
    ${plan.fb > 0 ? `<div class="fiber">Клетчатка примерно ${whole(t.fb)} из ${whole(plan.fb)} г</div>` : ''}
    ${changed}
  </section>`;
}
// Plan dishes the user took out of the day stay visible, crossed out, with a way back.
function goneHtml(d, m) {
  if (window.Sync && Sync.viewer) return '';
  return dayAt(d).meals[m].items.map((it, i) => ({ it, id: idOf(d, m, i) })).filter(o => state.removed[o.id]).map(o =>
    `<div class="gone"><span><s>${esc(o.it.n)}</s><small>убрано из дня · ${o.it.a} ${esc(o.it.u)} · ${whole(o.it.k)} ккал</small></span>
      <button type="button" data-act="restore" data-id="${o.id}">Вернуть</button></div>`).join('');
}

function itemHtml(d, m, i, it) {
  const id = idOf(d, m, i), got = eatenOf(id, it);
  const cls = got >= it.a ? 'full' : got > 0 ? 'part' : '';
  const status = cls === 'part'
    ? `<small class="st">съел ${got} из ${it.a} ${it.u}, осталось ${it.a - got} ${it.u}</small>`
    : `<small>${it.a} ${it.u}${it.was ? ` <span class="was">по плану ${it.was}</span>` : ''} · ${whole(it.k)} ккал · Б ${num(it.p)} Ж ${num(it.f)} У ${num(it.c)}</small>`;
  const step = pieces(it.u) ? 0.5 : it.a >= 100 ? 10 : 5;
  const changed = state.swaps[id] || state.amt[id];
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
      <div class="ckrow"><span>Порция по плану</span>
        <input type="number" inputmode="decimal" min="0" step="${step}" value="${it.a}" data-act="amt" data-id="${id}" aria-label="Порция по плану, ${it.u}"><span>${esc(it.u)}</span></div>
      <div class="chips">
        <button type="button" data-act="swap" data-id="${id}">Заменить</button>
        ${changed ? `<button type="button" data-act="unswap" data-id="${id}">Вернуть как было</button>` : ''}
        ${cls === 'part' ? `<button type="button" data-act="eatenportion" data-id="${id}">Сделать ${got} ${esc(it.u)} порцией</button>` : ''}
        <button type="button" data-act="set" data-id="${id}" data-val="${pieces(it.u) ? it.a / 2 : Math.round(it.a / 2)}">Половина</button>
        <button type="button" data-act="remove" data-id="${id}">Убрать из дня</button>
      </div>
    </div>` : '';
  return `<div class="item ${cls}">
    <div class="row">
      <button type="button" class="tick" data-act="tick" data-id="${id}" aria-label="${esc(it.n)}: отметить" aria-pressed="${cls === 'full'}"><i>${cls === 'full' ? '✓' : ''}</i></button>
      <button type="button" class="info" data-act="open" data-id="${id}" aria-expanded="${open === id}"><b>${esc(it.n)}</b>${status}${readyLine}</button>
    </div>${edit}</div>`;
}

function renderPlan() {
  const d = state.day, day = dayAt(d);
  const viewer = window.Sync && Sync.viewer;
  const meals = day.meals.map((meal, m) => {
    const list = mealItems(d, m), gone = goneHtml(d, m);
    if (!list.length && !gone && (viewer || d < MY)) return '';
    const left = list.filter(o => eatenOf(o.id, o.it) < o.it.a).length;
    const kcal = list.reduce((s, o) => s + o.it.k, 0);
    return `<section class="card meal">
      <div class="mealhead"><h2>${esc(meal.name)}</h2><span>${!list.length ? 'пусто' : `${left ? `осталось ${left} · ` : 'всё съедено · '}${whole(kcal)} ккал`}</span></div>
      ${list.map(o => itemHtml(d, m, o.i, o.it)).join('')}${gone}
      ${viewer ? '' : `<button type="button" class="mealadd" data-act="addto" data-m="${m}">+ Добавить в «${esc(meal.name)}»</button>`}
    </section>`;
  }).join('');
  const kind = viewer ? '' : `<div class="chips cmode daykind" role="group" aria-label="Тип дня">
      <button type="button" class="${isTrain(d) ? 'on' : ''}" data-act="daykind" data-v="1" aria-pressed="${isTrain(d)}">Тренировка</button>
      <button type="button" class="${isTrain(d) ? '' : 'on'}" data-act="daykind" data-v="0" aria-pressed="${!isTrain(d)}">Без тренировки</button></div>`;
  $('main').innerHTML = `${window.Sync ? Sync.bar() : ''}<h1>${esc(day.title)}</h1><p class="sub">${esc(day.note || '')}</p>${kind}
    ${viewer ? nextMealHtml(d) : window.Sync ? trainTop() : ''}${summary(d)}${meals}
    ${extrasHtml(d)}
    <div class="actions">
      ${viewer ? '' : '<button type="button" class="btn" data-act="extra">Съел вне плана</button>'}
      ${!viewer && window.Sync ? weightLink() : ''}
      ${viewer ? '' : '<button type="button" class="btn ghost" data-act="delday">Удалить этот день</button>'}
      ${viewer ? '' : hiddenHtml()}
      <button type="button" class="btn ghost" data-act="sync">${esc(window.Sync ? Sync.buttonText() : 'Синхронизация')}</button>
    </div>`;
}

// Plan days the user removed, each with a way back.
function hiddenHtml() {
  const list = PLAN.days.map((x, d) => d).filter(d => d >= SHOW_FROM && state.hidden[d]);
  if (!list.length) return '';
  return `<div class="hidden-days"><span>Удалённые дни, нажми, чтобы вернуть:</span><div class="chips">${list.map(d =>
    `<button type="button" data-act="unhide" data-d="${d}">${esc(PLAN.days[d].tab)}</button>`).join('')}</div></div>`;
}

// For the person who serves the food: what is left in the next meal, in cooked grams.
function nextMealHtml(d) {
  const day = dayAt(d);
  for (let m = 0; m < day.meals.length; m++) {
    const rows = mealItems(d, m).map(({ id, it }) => {
      const left = it.a - eatenOf(id, it);
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
// iPhone: while a sheet is open the page under it must not scroll, or the caret in its fields is drawn off the field.
// So the body is pinned in place (position: fixed at the current scroll) and put back on close.
function lockPage() {
  if (document.body.classList.contains('locked')) return;
  const y = window.scrollY;
  document.body.dataset.y = y;
  document.body.style.top = `-${y}px`;
  document.body.classList.add('locked');
}
function unlockPage() {
  if (!document.body.classList.contains('locked')) return;
  const y = +document.body.dataset.y || 0;
  document.body.classList.remove('locked');
  document.body.style.top = '';
  window.scrollTo(0, y);
}
function closeSheet() { sheet = null; $('sheet').hidden = true; $('sheet').innerHTML = ''; unlockPage(); }
function swapOptions() {
  const it = findItem(sheet.id), q = norm(sheet.q), cat = (productOf(it.n) || {}).cat, g = groupOf(it.n, cat);
  // «Похожие»: the same group, or the same table category for products outside the groups. «Все»: anything, by calories.
  const by = g && !sheet.all ? GROUPS[g].by : 'k';
  const fits = p => (sheet.all ? true : g ? groupOf(p.n, p.cat) === g : p.cat === cat);
  const same = p => label(p).startsWith(it.n) || it.n.startsWith(p.n) || (DRY.test(it.n) && p.n.split(/[ ,]/)[0] === it.n.split(/[ ,]/)[0]);
  // Fast food is a one-off, not something to cook instead: for other products it shows only under «Все продукты».
  const fast = p => /Вкусно и точка|фри$/i.test(label(p)) || p.cat === 'Готовая еда';
  return PRODUCTS.filter(p => !p.ref && fits(p) && (sheet.all || g === 'ready' || !fast(p)) && p[by] > 0 && p.k > 0 && !same(p) && norm(label(p)).includes(q))
    .map(p => {
      const unit = unitOf(p.n, p.u, groupOf(p.n, p.cat));
      const a = Math.max(unit, Math.round(it[by] / p[by] * p.base / unit) * unit);
      return { p, a, x: portionOf(p, a) };
    });
}

// ---------- Keeping the day on plan ----------
// x: what came on top of the plan (food eaten outside it, a swap, a bigger portion) with its macros.
// Negative macros mean the plan lost them (a smaller portion, a removed product): then the rest is topped up.
const ahead = d => dayItems(d).filter(o => !(state.eaten[o.id] > 0));
const leftAhead = (d, g) => ahead(d).filter(o => groupOf(o.it.n) === g);
const FRUIT = /^(Банан|Яблоко|Киви|Апельсин|Мандарин|Слива|Курага|Грецкий|Миндаль|Фундук|Кедровые)/;
// Treats pay for treats; fruit and nuts go last, and only for another sweet.
const treatsAhead = d => leftAhead(d, 'sweet').filter(o => !FRUIT.test(o.it.n));
// Fibre and coffee stay as they are: they are not food to balance with.
const FIXED = /^(Псиллиум|Отруби|Сибирские отруби|Кофе)/;
const fatShare = it => (it.k > 0 ? it.f * 9 / it.k : 0);
const MACROS = ['p', 'f', 'c', 'k'];
// How far a portion may grow under the plan's rules: at most 90 g of a dry side or cereal per meal,
// 100 g of bread, 300 ml of milk, 400 g of meat a day, otherwise half as much again.
function roomOf(o, d) {
  const it = o.it, base = it.was || it.a, g = groupOf(it.n);
  if (DRY.test(it.n) || g === 'cereal') return Math.max(0, 90 - it.a);
  if (/^(Хлеб|Булочки)/.test(it.n)) return Math.max(0, 100 - it.a);
  if (g === 'milk') return Math.max(0, 300 - it.a);
  if (/^Протеин/.test(it.n)) return Math.max(0, 40 - it.a);
  if (g === 'meat') {
    const used = dayItems(d).filter(x => groupOf(x.it.n) === 'meat').reduce((sum, x) => sum + x.it.a, 0);
    return Math.max(0, Math.min(400 - used, base * 0.5));
  }
  if (pieces(it.u)) return 0;
  return Math.max(0, base * 1.5 - it.a);
}
function rebalancePlan(x, d, way) {
  const changes = (x.seed || []).map(c => ({ ...c, on: true })), moved = { p: 0, f: 0, c: 0, k: 0 };
  for (const c of changes) for (const m of MACROS) moved[m] += c.d[m];
  const busy = id => id === x.id || changes.some(c => c.id === id);
  // Change items by one macro, the dish's own meal first, until `need` is covered. sign −1 takes away, +1 adds.
  const shift = (list, key, need, sign, crumb = 10, enough = null) => {
    for (const o of list) {
      if (need <= 0 || (enough && enough())) return;
      const it = o.it, per = it[key] / it.a, unit = unitOf(it.n, it.u, groupOf(it.n));
      if (per <= 0 || busy(o.id) || FIXED.test(it.n) || need < per * unit / 2) continue;
      let g = Math.round(need / per / unit) * unit;
      if (sign < 0) {
        g = Math.min(it.a, g);
        if (it.a - g < crumb) g = per * it.a <= need * 1.5 ? it.a : Math.max(0, it.a - Math.ceil(crumb / unit) * unit);
      } else g = Math.min(g, Math.floor(roomOf(o, d) / unit) * unit);
      if (g <= 0) continue;
      const delta = {};
      for (const m of MACROS) delta[m] = sign * (it[m] || 0) * g / it.a;
      changes.push({ id: o.id, n: it.n, u: it.u, from: it.a, to: +(it.a + sign * g).toFixed(1), d: delta, on: true });
      for (const m of MACROS) moved[m] += delta[m];
      need -= per * g;
    }
  };
  const over = m => (x[m] || 0) + moved[m];
  const own = list => list.sort((a, b) => (b.m === x.m) - (a.m === x.m));
  const sides = () => own(leftAhead(d, 'side')), sauces = () => leftAhead(d, 'sauce'), treats = () => treatsAhead(d);
  const fruit = () => leftAhead(d, 'sweet').filter(o => FRUIT.test(o.it.n));
  // Fatty means sauces, cheese, cold cuts, nuts and chocolate. Milk with cereal stays: cereal is never eaten dry.
  const fatty = () => ahead(d).filter(o => fatShare(o.it) > 0.35 && (['sauce', 'cold', 'sweet'].includes(groupOf(o.it.n)) || /^Сыр/.test(o.it.n))).sort((a, b) => fatShare(b.it) - fatShare(a.it));
  const meats = () => [...leftAhead(d, 'meat'), ...leftAhead(d, 'protein')];
  const breakfast = () => ahead(d).filter(o => ['cereal', 'milk'].includes(groupOf(o.it.n)) || /^Хлеб/.test(o.it.n));
  const cutK = list => () => over('k') > 50 && shift(list(), 'k', over('k'), -1, 30);
  const cutC = list => () => over('c') > 5 && over('k') > 0 && shift(list(), 'c', Math.min(over('c'), over('k') / 4), -1, 30);
  const cutF = list => () => over('f') > 5 && over('k') > 0 && shift(list(), 'f', Math.min(over('f'), over('k') / 9), -1, 10, () => over('k') < 40);
  const cutMeat = () => {
    const list = leftAhead(d, 'meat');
    if (over('k') > 50 && over('p') > 5 && list.length) shift(list, 'p', Math.min(over('p'), over('k') * list[0].it.p / list[0].it.k), -1, 50);
  };
  const addK = list => () => over('k') < -50 && shift(list(), 'k', -over('k'), 1);
  const addP = list => () => over('k') < -50 && over('p') < -5 && shift(list(), 'p', -over('p'), 1);
  let ways;
  if (over('k') > 0) {
    if (x.kind === 'sweet') ways = [[cutK(treats), cutK(fruit), cutK(sides)], [cutK(sides)], [cutK(fruit), cutK(treats)]];
    else if (x.kind === 'swap') ways = [[cutC(sides), cutK(sides)], [cutK(sides)], [cutK(sauces), cutK(treats)]];
    else if (x.kind === 'train') ways = [[cutK(treats), cutK(sides)], [cutK(sides)], [cutK(sauces), cutK(fruit)]];
    else ways = [[cutC(sides), cutMeat, cutK(sauces), cutK(treats)], [cutK(sides), cutMeat], [cutC(sides), cutK(treats), cutK(sauces)]];
    // Much fat on top: first fatty things go (sauces, nuts, chocolate, cheese), then the side evens out calories.
    if (over('f') > 8) ways.unshift([cutF(fatty), cutK(sides)]);
  } else {
    ways = [[addK(sides), addK(treats)], [addK(treats), addK(fruit), addK(sides)], [addK(fruit), addK(treats)], [addK(breakfast), addK(sides)]];
    if (over('p') < -8) ways.unshift([addP(meats), addK(sides)]);
  }
  if (way >= ways.length) return null;
  for (const step of ways[way]) step();
  // Protein that went away with the cuts and did not come with the food is topped up with whey.
  let add = null;
  const whey = PRODUCTS.find(p => /^Протеин сывороточный/.test(p.n)), lack = -over('p');
  if (x.why === 'extra' && lack > 8 && whey) {
    const g = Math.round(lack / (whey.p / whey.base) / 5) * 5, first = ahead(d)[0];
    if (g > 0 && first) add = { m: first.m, item: portionOf(whey, g), on: true };
  }
  return { changes, add };
}
// All the different ways that change something, the usual one first.
function rebalanceWays(x, d) {
  const seen = new Set(), out = [];
  for (let way = 0; way < 6; way++) {
    const plan = rebalancePlan(x, d, way);
    if (!plan) break;
    const key = JSON.stringify([plan.changes.map(c => [c.id, c.to]), plan.add && plan.add.item.a]);
    if ((plan.changes.length || plan.add) && !seen.has(key)) { seen.add(key); out.push(plan); }
  }
  return out;
}
// What the day is off the plan by, with the chosen changes: kcal and each macro.
function balanceOf(x, plan) {
  const b = {};
  for (const m of MACROS) b[m] = (x[m] || 0) + plan.changes.filter(c => c.on).reduce((sum, c) => sum + c.d[m], 0) + (plan.add && plan.add.on ? plan.add.item[m] : 0);
  return b;
}
const sgn = v => `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${whole(Math.abs(v))}`;
function balanceText(x, plan) {
  const b = balanceOf(x, plan), k = Math.round(b.k);
  const head = Math.abs(k) < 60 ? 'Калории дня сойдутся с планом' : k > 0 ? `Будет больше плана на ${k} ккал` : `Будет меньше плана на ${-k} ккал`;
  return `${head}. К плану: Б ${sgn(b.p)}, Ж ${sgn(b.f)}, У ${sgn(b.c)}.`;
}
function offerRebalance(x, d, holder) {
  // The recount aims at the plan's norm, not at the day as it stood: what the user changed before counts too.
  // A change that brings the day closer to the norm needs nothing. A training switch only evens out the shake.
  if (x.kind !== 'train') {
    const { plan, now } = totals(d), ex = extrasOf(d);
    x.ev = {};
    for (const m of MACROS) {
      x.ev[m] = x[m] || 0;
      const dev = now[m] + ex.reduce((s, e) => s + (e[m] || 0), 0) - plan[m];
      x[m] = Math.sign(dev) === Math.sign(x.ev[m]) ? +dev.toFixed(1) : 0;
    }
    if (Math.abs(x.k) < 40 && Math.abs(x.c) <= 8 && Math.abs(x.f) <= 8 && Math.abs(x.p) <= 8) return false;
  }
  const ways = rebalanceWays(x, d);
  if (!ways.length && !(x.seed || []).length) return false;
  if (!ways.length) ways.push({ changes: x.seed.map(c => ({ ...c, on: true })), add: null });
  sheet = { mode: 'rebalance', x, d, holder, ways, way: 0, custom: null };
  renderSheet();
  return true;
}
// «Свой вариант»: the user sets every portion still ahead with a slider.
function sliderItems() {
  const all = ahead(sheet.d).filter(o => o.id !== sheet.x.id && !FIXED.test(o.it.n) && !(sheet.x.seed || []).some(c => c.id === o.id));
  const offered = new Set(sheet.ways.flatMap(r => r.changes.filter(c => !c.swap).map(c => c.id)));
  return sheet.slAll || !offered.size ? all : all.filter(o => offered.has(o.id));
}
function customPlan() {
  const changes = (sheet.x.seed || []).map(c => ({ ...c, on: true }));
  for (const o of sliderItems()) {
    const v = sheet.custom[o.id];
    if (v === undefined || v === o.it.a) continue;
    const d = {};
    for (const m of MACROS) d[m] = (o.it[m] || 0) * (v - o.it.a) / o.it.a;
    changes.push({ id: o.id, n: o.it.n, u: o.it.u, from: o.it.a, to: v, d, on: true });
  }
  return { changes, add: null };
}
const sliderMax = it => { const unit = unitOf(it.n, it.u, groupOf(it.n)), base = it.was || it.a; return Math.max(Math.ceil(base * 2 / unit) * unit, it.a + unit * 4); };
function applyRebalance(x, d, plan) {
  x.adj = [];
  for (const c of plan.changes.filter(c => c.on)) {
    if (c.swap) {
      x.adj.push({ id: c.id, swap: state.swaps[c.id] ?? null, amt: state.amt[c.id] ?? null });
      state.swaps[c.id] = c.swap;
      delete state.amt[c.id];
      continue;
    }
    x.adj.push({ id: c.id, amt: state.amt[c.id] ?? null });
    if (c.to > 0) { state.amt[c.id] = c.to; delete state.removed[c.id]; } else state.removed[c.id] = true;
  }
  if (plan.add && plan.add.on) {
    const key = `d${d}m${plan.add.m}`, list = (state.adds[key] = state.adds[key] || []);
    list.push(plan.add.item);
    x.adj.push({ id: `${key}i${100 + list.length - 1}`, added: true });
  }
}
// Removing the food that caused a recount puts the plan back, unless those dishes were eaten since.
function undoRebalance(x) {
  for (const a of (x && x.adj) || []) {
    if (state.eaten[a.id] > 0) continue;
    if (a.added) { state.removed[a.id] = true; continue; }
    if (a.swap !== undefined) { if (a.swap === null) delete state.swaps[a.id]; else state.swaps[a.id] = a.swap; }
    delete state.removed[a.id];
    if (a.amt === null) delete state.amt[a.id]; else state.amt[a.id] = a.amt;
  }
  if (x) x.adj = [];
}
// The difference between two versions of a product, as the extra the plan got.
const diffOf = (now, was) => { const d = {}; for (const m of MACROS) d[m] = +((now[m] || 0) - (was[m] || 0)).toFixed(1); return d; };
const mealOf = id => +id.match(/m(\d+)i/)[1];

// ---------- Switching a day between training and rest ----------
// Before training there is a gainer; on a rest day whey instead. The calories that moved are then evened out.
function switchDay(d, train) {
  undoRebalance(state.trainAdj[d]);
  delete state.trainAdj[d];
  const raw = d >= MY ? state.mydays[d - MY] : PLAN.days[d];
  if (isTrainTitle(raw.title) === train) delete state.train[d]; else state.train[d] = train;
  save();
  render();
  const want = train ? /^Гейнер/ : /^Протеин сывороточный/, from = train ? /^Протеин сывороточный/ : /^Гейнер/;
  const p = PRODUCTS.find(x => !x.ref && want.test(x.n)), o = ahead(d).find(x => from.test(x.it.n));
  const seed = [];
  if (p && o) {
    const item = portionOf(p, train ? 50 : 30);
    seed.push({ id: o.id, n: `${o.it.n} → ${label(p)}`, u: 'г', from: o.it.a, to: item.a, swap: item, d: diffOf(item, o.it), on: true });
  }
  state.trainAdj[d] = {};
  const x = { n: '', why: 'train', train, kind: 'train', p: 0, f: 0, c: 0, k: 0, seed };
  if (!offerRebalance(x, d, state.trainAdj[d])) toast(train ? 'День стал тренировочным' : 'День стал без тренировки');
}

// ---------- A day built from the template ----------
const shortName = n => n.replace(/ \/ .*$/, '').replace(/ \(.*$/, '');
const SIDE_CHOICES = () => PRODUCTS.filter(p => !p.ref && !p.mine && groupOf(p.n, p.cat) === 'side' && !/^(Хлеб|Лаваш|Лепёшка|Булочки)/.test(p.n) && !/фри/i.test(p.n));
const MEAT_CHOICES = () => PRODUCTS.filter(p => !p.ref && !p.mine && groupOf(p.n, p.cat) === 'meat' && !/^Тунец|^Креветки/.test(p.n));
// The approved skeleton: cereal with milk, casserole with fruit, side and meat twice, a shake meal, sweets spread out.
function buildDay(train, side, meat, dt) {
  const find = re => PRODUCTS.find(p => !p.ref && !p.mine && re.test(label(p)));
  const item = (re, a) => { const p = find(re); return p ? portionOf(p, a) : null; };
  const turn = (list, k = 0) => list[(dt.getDate() + k) % list.length];
  const cereal = turn([[/^Подушечки/, 80, 300], [/^Хлопья кукурузные/, 80, 300], [/^Шарики шоколадные/, 80, 300], [/^Мюсли банан/, 80, 200]]);
  const fruit = turn([/^Банан/, /^Киви/, /^Апельсин/, /^Яблоко/], 1), nut = turn([/^Фундук/, /^Грецкий/, /^Миндаль/], 1);
  // A rest day already has chocolate in the shake meal, so dinner gets something else.
  let treat = turn(train ? [[/^Чокопай/, 30], [/^Шоколад молочный пористый/, 25], [/^Мармелад/, 40]] : [[/^Чокопай/, 30], [/^Мармелад/, 40]], 2);
  let whey = 0, noNuts = false;
  const sauce = /^Наггетсы/.test(meat.n) ? item(/^Соус сырный, Heinz/, 25) : /^Куриная грудка/.test(meat.n) ? item(/^Соус терияки/, 30) : null;
  const unit = 5, perG = side.k / side.base;
  let sideA = DRY.test(side.n) ? 90 : Math.round(315 / perG / unit) * unit;
  let meatA = 200;
  const main = extra => [portionOf(side, sideA), portionOf(meat, meatA), sauce, item(/^Псиллиум/, 5), item(/^Отруби/, 5), ...extra].filter(Boolean);
  const build = () => [
    { name: 'Завтрак', items: [item(cereal[0], cereal[1]), item(/^Молоко 2,5/, cereal[2]), item(/^Кофе с молоком/, 400), item(/^Сахар/, 15)].filter(Boolean) },
    { name: 'Второй завтрак', items: [item(/^Творожная запеканка/, 1), item(/^Сгущёнка цельная/, 20), item(fruit, 150)].filter(Boolean) },
    { name: 'Обед', items: main(train ? [] : [item(/^Мармелад/, 20)]) },
    train
      ? { name: 'Перед тренировкой', items: [item(/^Гейнер/, 50), whey ? item(/^Протеин сывороточный/, whey) : null, item(/^Молоко 2,5/, 300), item(/^Банан/, 150), item(/^Мармелад/, 40)].filter(Boolean) }
      : { name: 'Полдник', items: [item(/^Протеин сывороточный/, 30 + whey), item(/^Молоко 2,5/, 300), item(/^Шоколад молочный пористый/, 25), noNuts ? null : item(nut, 20)].filter(Boolean) },
    { name: train ? 'Ужин после тренировки' : 'Ужин', items: main([item(treat[0], treat[1])]) },
  ];
  // Fit about 3050 kcal by the side portions, the way plans are made by hand.
  let meals = build();
  const sum = key => meals.reduce((a, m) => a + m.items.reduce((b, it) => b + (it[key] || 0), 0), 0), total = () => sum('k');
  // Fatty meat (фарш, говядина) goes in smaller portions, to stay under 110 g of fat a day.
  if (sum('f') > 110 && fatShare(meat) > 0.4) { meatA = 150; meals = build(); }
  // Still too fatty: marmalade instead of chocolate at dinner, no nuts in the shake meal.
  if (sum('f') > 110) { if (/Шоколад/.test(treat[0].source)) treat = [/^Мармелад/, 40]; noNuts = true; meals = build(); }
  // Protein at least 1.6 g per kg: whey in the shake meal makes up the rest.
  const need = 1.6 * (lastWeight() || 99);
  if (sum('p') < need) { whey = Math.min(train ? 40 : 10, Math.max(15, Math.ceil((need - sum('p')) / 0.69 / 5) * 5)); meals = build(); }
  for (let i = 0; i < 12 && total() > 3150 && sideA > 50; i++) { sideA -= unit * (DRY.test(side.n) ? 1 : 4); meals = build(); }
  // A light day gets a treat at lunch and a bigger fruit, as plans are topped up by hand.
  const topUps = [[2, /^Чокопай/, 30], [1, fruit, 50], [3, /^Мармелад/, 20]];
  for (const [m, re, a] of topUps) {
    if (total() >= 2960) break;
    const have = meals[m].items.findIndex(it => re.test(it.n));
    if (have >= 0) { const it = meals[m].items[have]; meals[m].items[have] = scaled(it, it.a + a); delete meals[m].items[have].was; } else { const x = item(re, a); if (x) meals[m].items.push(x); }
  }
  return meals;
}

// ---------- The user's own days ----------
const WDAY = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'], WSHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dateWord = dt => `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
function freeDates() {
  const used = dayIds().map(d => dayAt(d).title), out = [];
  for (let i = 0; out.length < 5 && i < 14; i++) {
    const dt = new Date();
    dt.setDate(dt.getDate() + i);
    if (!used.some(t => t.includes(` ${dateWord(dt)},`) || t.endsWith(` ${dateWord(dt)}`))) out.push(dt);
  }
  return out;
}
function createDay() {
  const dt = freeDates()[sheet.date], src = sheet.from;
  const meals = src === 'gen' ? buildDay(sheet.train, SIDE_CHOICES()[sheet.side], MEAT_CHOICES()[sheet.meat], dt)
    : src === null
    ? ['Завтрак', 'Второй завтрак', 'Обед', 'Полдник', 'Ужин'].map(name => ({ name, items: [] }))
    : dayAt(src).meals.map((meal, m) => ({ name: meal.name, items: mealItems(src, m).map(({ it }) => { const copy = { ...it }; delete copy.was; return copy; }) })).filter(meal => meal.items.length);
  state.mydays.push({ tab: `${WSHORT[dt.getDay()]} ${dt.getDate()}`, title: `${WDAY[dt.getDay()]} ${dateWord(dt)}, ${sheet.train ? 'тренировка' : 'без тренировки'}`, note: src === 'gen' ? `Собран по шаблону: ${shortName(SIDE_CHOICES()[sheet.side].n).toLowerCase()} и ${MEAT_CHOICES()[sheet.meat].n.toLowerCase()}` : src === null ? 'Свой день' : `Свой день, за основу взят ${dayAt(src).tab}`, meals });
  state.day = MY + state.mydays.length - 1;
}
function deleteDay(d) {
  state.mydays[d - MY] = null;
  for (const box of [state.eaten, state.swaps, state.amt, state.removed, state.adds]) Object.keys(box).filter(k => k.startsWith(`d${d}m`)).forEach(k => delete box[k]);
  delete state.extras[d];
  delete state.train[d];
  delete state.trainAdj[d];
  state.day = dayIds()[0];
}
function sheetList() {
  if (sheet.mode === 'swap') {
    const it = findItem(sheet.id), diff = k => (Math.abs(k - it.k) < 15 ? '' : ` (${k > it.k ? '+' : '−'}${whole(Math.abs(k - it.k))})`);
    return swapOptions().map((o, i) => `<button type="button" class="pick" data-act="doswap" data-i="${i}">
      <b>${esc(o.x.n)}${o.p.freq ? ` <em>${esc(o.p.freq.toLowerCase())}</em>` : ''}${o.p.mine ? ' <em>моё</em>' : ''}</b>
      <small>${num(o.a)} ${esc(o.p.u)} · ${whole(o.x.k)} ккал${diff(o.x.k)} · Б ${num(o.x.p)} Ж ${num(o.x.f)} У ${num(o.x.c)}</small></button>`).join('') || `<p class="sub">Ничего не нашлось${sheet.all ? '' : '. Нажми «Все продукты».'}</p>`;
  }
  const q = norm(sheet.q);
  const hidden = Object.entries(shared.prodEdit || {}).filter(([, e]) => e.hidden).map(([n]) => n);
  const back = hidden.length ? `<div class="hidden-days"><span>Скрытые продукты, нажми, чтобы вернуть:</span><div class="chips">${hidden.map(n =>
    `<button type="button" data-act="unhideprod" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : '';
  return PRODUCTS.map((p, i) => ({ p, i })).filter(o => norm(label(o.p)).includes(q) || (o.p.orig && norm(o.p.orig).includes(q))).map(o =>
    `<button type="button" class="pick" data-act="pickextra" data-i="${o.i}"><b>${esc(label(o.p))}${o.p.mine ? ' <em>моё</em>' : o.p.ref ? ' <em>примерно</em>' : ''}</b>
      <small>на ${o.p.base} ${o.p.u}: ${whole(o.p.k)} ккал · Б ${num(o.p.p)} Ж ${num(o.p.f)} У ${num(o.p.c)}</small></button>`).join('') + (q ? '' : back) || '<p class="sub">В таблице нет. Нажми «Найти в интернете».</p>';
}
// Internet search has two parts.
// 1. offru.json: products sold in Russia from Open Food Facts, downloaded by tools/make_offru.py. Searched on the phone, instant, works offline.
// 2. The live Open Food Facts search for anything newer. It is often overloaded and then fails at once, so it is retried for up to 20 seconds.
let offBase = null;
function loadOff() {
  if (!offBase) offBase = fetch('offru.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('no base')))).then(j => ({
    date: j.date,
    items: j.items.map(([n, brand, p, f, c, k, qty]) => ({ n, brand, p, f, c, k, qty, key: ` ${keyText(n + ' ' + brand)}` })),
  })).catch(e => { offBase = null; throw e; });
  return offBase;
}
// Lower case, ё as е, Latin brand names in Cyrillic too (Spar and Спар both match), punctuation as spaces.
const LAT = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'й', z: 'з' };
const keyText = t => {
  const s = norm(t).replace(/[«»"'.,()\/\+\-–—:;!?%№]/g, ' ').replace(/\s+/g, ' ').trim();
  return /[a-z]/.test(s) ? `${s} ${s.replace(/[a-z]/g, ch => LAT[ch])}` : s;
};
// Every word of the query has to be in the name or brand; words found at a word start count more, shorter names go first.
function matchOff(items, q) {
  const words = keyText(q).split(' ').filter(w => w.length > 1).map(w => w.replace(/[a-z]/g, ch => LAT[ch]));
  if (!words.length) return [];
  const stem = w => (w.length > 4 ? w.slice(0, w.length - 1) : w); // «пиццы», «пицца», «роллы», «ролл»
  const hits = [];
  for (const it of items) {
    let score = 0, ok = true;
    for (const w of words) {
      const s = stem(w);
      if ((it.key + ' ').includes(` ${w} `)) score += 3;
      else if (it.key.includes(' ' + s)) score += 2;
      else if (it.key.includes(s)) score += 1;
      else { ok = false; break; }
    }
    if (ok) hits.push({ it, score: score * 100 - Math.min(it.key.length, 99) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 40).map(h => h.it);
}
const webPick = (p, i) => `<button type="button" class="pick" data-act="pickweb" data-i="${i}"><b>${esc(label(p))}</b>
      <small>на 100 г: ${whole(p.k)} ккал · Б ${num(p.p)} Ж ${num(p.f)} У ${num(p.c)}${p.qty ? ` · упаковка ${esc(p.qty)}` : ''}</small></button>`;
function webList() {
  const w = sheet.web || [], local = w.filter(p => p.from === 'base').length;
  const live = {
    load: '<p class="sub">Ищу ещё в интернете, до 20 секунд…</p>',
    error: w.length ? '<p class="sub">Живой поиск сейчас не ответил, показаны продукты из скачанной базы.</p>' : '<p class="sub">Не нашлось ни в скачанной базе, ни в интернете: живой поиск сейчас не отвечает. Попробуй другое название или впиши блюдо вручную.</p>',
    empty: w.length ? '' : '<p class="sub">Не нашлось. Попробуй короче, например одно слово и марку, или впиши блюдо вручную.</p>',
  }[sheet.webState] || '';
  if (!w.length) return live;
  const parts = [local && `в скачанной базе ${local}${sheet.webDate ? ` (от ${new Date(sheet.webDate).toLocaleDateString('ru-RU')})` : ''}`, w.length > local && `в живом поиске ${w.length - local}`].filter(Boolean);
  return `<p class="sub webhead">Open Food Facts, нашлось ${parts.join(', ')}. Значения от покупателей, сверяй с упаковкой.</p>`
    + w.map(webPick).join('') + live;
}
async function webSearch() {
  const q = sheet.q.trim();
  if (q.length < 2) { toast('Сначала впиши название в поиск'); return; }
  const run = sheet.webRun = (sheet.webRun || 0) + 1, mine = () => sheet && sheet.webRun === run;
  const seen = new Set(), add = list => {
    const fresh = list.filter(p => {
      const key = `${keyText(label(p))}|${Math.round(p.k)}`;
      if (!p.n || !p.k || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    sheet.web = [...(sheet.web || []), ...fresh];
  };
  const show = () => { if (mine() && $('webBox')) $('webBox').innerHTML = webList(); };
  sheet.web = [];
  sheet.webState = 'load';
  show();
  // The downloaded base answers at once.
  try {
    const base = await loadOff();
    if (!mine()) return;
    sheet.webDate = base.date;
    add(matchOff(base.items, q).map(p => ({ n: p.n, brand: p.brand, freq: '', base: 100, u: 'г', p: p.p, f: p.f, c: p.c, k: p.k, qty: p.qty, from: 'base' })));
    show();
  } catch (e) { /* no base on this phone yet: the live search still runs */ }
  // The live search: both sections, a few tries while the server is busy.
  const ask = host => fetch(`https://${host}.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=30&fields=product_name,product_name_ru,brands,nutriments,quantity&search_terms=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
  const until = Date.now() + 20000;
  let answers = [];
  for (let n = 0; Date.now() < until && mine(); n++) {
    answers = await Promise.allSettled([ask('ru'), ask('world')]);
    if (answers.some(a => a.status === 'fulfilled')) break;
    await new Promise(r => setTimeout(r, 1500 + n * 1500));
  }
  if (!mine()) return;
  const got = answers.filter(a => a.status === 'fulfilled');
  if (got.length) {
    const words = keyText(q).split(' ');
    add(got.flatMap(a => a.value.products || []).map(x => {
      const t = x.nutriments || {}, p = t.proteins_100g || 0, f = t.fat_100g || 0, c = t.carbohydrates_100g || 0;
      // Many entries have macros but no calories: then they are counted from the macros.
      const k = t['energy-kcal_100g'] ?? (t['energy_100g'] ? t['energy_100g'] / 4.184 : p * 4 + f * 9 + c * 4);
      return { n: (x.product_name_ru || x.product_name || '').trim(), brand: (x.brands || '').split(',')[0].trim(), freq: '', base: 100, u: 'г', k: Math.round(k), p, f, c, qty: (x.quantity || '').slice(0, 20), from: 'live' };
    }).sort((a, b) => words.filter(w => keyText(label(b)).includes(w)).length - words.filter(w => keyText(label(a)).includes(w)).length).slice(0, 20));
  }
  sheet.webState = got.length ? (sheet.web.length ? '' : 'empty') : 'error';
  show();
}
function pickInfo() {
  const p = sheet.pick, a = Number($('xAmount').value) || 0, x = portionOf(p, a);
  $('xInfo').textContent = `${whole(x.k)} ккал · Б ${num(x.p)} Ж ${num(x.f)} У ${num(x.c)}`;
}
function renderSheet() {
  const s = $('sheet');
  s.hidden = false;
  lockPage();
  let title, body;
  if (sheet.mode === 'sync') {
    const on = Sync.mode === 'writer' || Sync.mode === 'shopper';
    s.innerHTML = sheetFrame('Синхронизация', `<p class="sub">${esc(Sync.mode === 'viewer' ? 'Этот телефон только смотрит. Чтобы отмечать покупки, вставь ключ и выбери «Только покупки».' : on ? Sync.buttonText() : 'Вставь ключ GitHub и выбери, какой это телефон.')}</p>
      ${on ? '<button type="button" class="btn ghost small" data-act="forgetkey">Убрать ключ с этого телефона</button>' : `<label class="field col"><span>Ключ GitHub</span><input type="password" id="syncKey" data-act="calcinput" autocomplete="off" aria-label="Ключ GitHub"></label>
      <button type="button" class="btn small" data-act="savekey" data-role="main">Основной телефон: отмечаю еду</button>
      <button type="button" class="btn ghost small" data-act="savekey" data-role="shop">Только покупки</button>`}`);
    return;
  }
  if (sheet.mode === 'rebalance') {
    const x = sheet.x, d = sheet.d, mealName = id => dayAt(d).meals[mealOf(id)].name.toLowerCase();
    const e = x.ev || x, why = {
      extra: `Добавлено: ${esc(x.n)}, ${whole(e.k)} ккал.`,
      swap: `Замена на «${esc(x.n)}»: ${sgn(e.k)} ккал, Б ${sgn(e.p)}, Ж ${sgn(e.f)}, У ${sgn(e.c)}.`,
      portion: `Порция «${esc(x.n)}»: ${sgn(e.k)} ккал.`,
      remove: `Убрано: ${esc(x.n)}, ${sgn(e.k)} ккал.`,
      restore: `Вернул: ${esc(x.n)}, ${sgn(e.k)} ккал.`,
      train: `День стал ${x.train ? 'тренировочным' : 'без тренировки'}.`,
    }[x.why] + (x.ev && Math.abs(x.k - e.k) >= 30 ? ` С прежними изменениями день ${x.k > 0 ? 'больше' : 'меньше'} плана на ${whole(Math.abs(x.k))} ккал.` : '') || '';
    if (sheet.custom) {
      const plan = customPlan(), rows = sliderItems().map(o => {
        const it = o.it, unit = unitOf(it.n, it.u, groupOf(it.n)), v = sheet.custom[o.id] ?? it.a;
        return `<div class="slrow"><div class="slhead"><span>${esc(it.n)}<small>${esc(mealName(o.id))}</small></span><b data-sv="${o.id}">${num(v)} ${esc(it.u)}${v !== it.a ? ` <em>было ${num(it.a)}</em>` : ''}</b></div>
          <input type="range" min="0" max="${sliderMax(it)}" step="${unit}" value="${v}" data-act="slider" data-id="${o.id}" aria-label="${esc(it.n)}, ${esc(it.u)}"></div>`;
      }).join('');
      s.innerHTML = sheetFrame('Свой вариант', `<p class="sub">${why} ${sheet.slAll ? 'Двигай порции того, что ещё впереди.' : 'Здесь то, что я предлагал поменять. Двигай порции.'}</p>
        ${(x.seed || []).map(c => `<div class="nextrow"><span>${esc(c.n)}</span><b>${num(c.to)} ${esc(c.u)}</b></div>`).join('')}
        ${rows || '<p class="sub">Впереди нечего менять.</p>'}
        ${sheet.ways.some(r => r.changes.some(c => !c.swap)) ? `<button type="button" class="btn ghost small" data-act="slall">${sheet.slAll ? 'Только предложенное' : 'Показать всё, что впереди'}</button>` : ''}
        <p class="sub rbfoot" id="rbFoot">${balanceText(x, plan)}</p>
        <button type="button" class="btn small" data-act="dorebalance">Применить</button>
        <button type="button" class="btn ghost small" data-act="rbcustom" data-v="0">Назад к вариантам</button>`);
      return;
    }
    const r = sheet.ways[sheet.way], meal = r.add ? dayAt(d).meals[r.add.m].name : '', more = balanceOf(x, { changes: (x.seed || []).map(c => ({ ...c, on: true })), add: null }).k > 0;
    const row = (i, on, name, what) => `<button type="button" class="rbrow${on ? '' : ' off'}" data-act="rbtoggle" data-i="${i}" aria-pressed="${on}"><span class="tick"><i>${on ? '✓' : ''}</i></span><span>${esc(name)}</span><b>${what}</b></button>`;
    const what = c => (c.swap ? `${num(c.to)} ${esc(c.u)}` : c.to <= 0 ? 'убрать' : `${num(c.from)} → ${num(c.to)} ${esc(c.u)}`);
    const any = r.changes.some(c => c.on) || (r.add && r.add.on);
    s.innerHTML = sheetFrame('Пересчитать остаток дня?', `<p class="sub">${why} ${more ? 'Чтобы день остался в плане, предлагаю:' : 'Чтобы добрать калории, предлагаю:'}</p>
      ${r.changes.map((c, i) => row(i, c.on, `${c.n}, ${mealName(c.id)}`, what(c))).join('')}
      ${r.add ? row('add', r.add.on, `${r.add.item.n}, в «${meal}»`, `+ ${r.add.item.a} г`) : ''}
      <p class="sub rbfoot">${balanceText(x, r)} Съеденное не трогаю, галочку можно снять.</p>
      ${sheet.ways.length > 1 ? `<button type="button" class="btn ghost small" data-act="rbnext">Другой вариант (${sheet.way + 1} из ${sheet.ways.length})</button>` : ''}
      <button type="button" class="btn ghost small" data-act="rbcustom" data-v="1">Свой вариант: выбрать порции самому</button>
      <button type="button" class="btn small" data-act="dorebalance"${any ? '' : ' disabled'}>Пересчитать</button>
      <button type="button" class="btn ghost small" data-act="closesheet">Оставить как есть</button>`);
    return;
  }
  if (sheet.mode === 'newday') {
    const dates = freeDates(), chip = (k, v, text, on) => `<button type="button" class="${on ? 'on' : ''}" data-act="nd" data-k="${k}" data-v="${v}" aria-pressed="${on}">${esc(text)}</button>`;
    s.innerHTML = sheetFrame('Новый день', `<p class="sub">День составляешь сам: продукты добавляются, заменяются и убираются.</p>
      <h3>Дата</h3><div class="chips cmode">${dates.map((dt, i) => chip('date', i, `${WSHORT[dt.getDay()]} ${dt.getDate()}`, sheet.date === i)).join('')}</div>
      <h3>День</h3><div class="chips cmode">${chip('train', 1, 'Тренировка', sheet.train)}${chip('train', 0, 'Без тренировки', !sheet.train)}</div>
      <h3>Взять за основу</h3><div class="chips cmode">${chip('from', 'gen', 'Собрать по шаблону', sheet.from === 'gen')}${chip('from', '', 'Пустой', sheet.from === null)}${dayIds().map(d => chip('from', d, dayAt(d).tab, sheet.from === d)).join('')}</div>
      ${sheet.from === 'gen' ? `<h3>Гарнир</h3><div class="chips cmode">${SIDE_CHOICES().map((p, i) => chip('side', i, shortName(p.n), sheet.side === i)).join('')}</div>
      <h3>Мясо</h3><div class="chips cmode">${MEAT_CHOICES().map((p, i) => chip('meat', i, label(p), sheet.meat === i)).join('')}</div>
      <p class="sub">Завтраки, фрукты и сладкое чередуются сами, гарнир подгоняется под 3000–3150 ккал. Потом всё можно поменять.</p>` : ''}
      <button type="button" class="btn small" data-act="createday" style="margin-top:14px">Создать день</button>`);
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
    const it = findItem(sheet.id), cat = (productOf(it.n) || {}).cat, g = GROUPS[groupOf(it.n, cat)], byP = g && g.by === 'p' && !sheet.all;
    title = `Заменить: ${it.n}`;
    body = `<div class="chips cmode" role="group" aria-label="Что показать">
        <button type="button" class="${sheet.all ? '' : 'on'}" data-act="swapall" data-v="0" aria-pressed="${!sheet.all}">${esc(g ? g.title[0].toUpperCase() + g.title.slice(1) : cat || 'Похожие')}</button>
        <button type="button" class="${sheet.all ? 'on' : ''}" data-act="swapall" data-v="1" aria-pressed="${!!sheet.all}">Все продукты</button></div>
      <p class="sub">${byP ? `Порции на тот же белок, ${whole(it.p)} г, в скобках разница в калориях.` : `Порции на те же ${whole(it.k)} ккал.`} Если калории или БЖУ сдвинутся, предложу пересчитать день.</p>`;
  } else {
    title = sheet.target === undefined ? 'Съел вне плана' : `Добавить в «${dayAt(state.day).meals[sheet.target].name}»`;
    body = '';
  }
  if (sheet.pick && sheet.editing) {
    // The user's own product list on the phone: rename or hide a table product, fully edit his own dish.
    const p = sheet.pick;
    body = `<h3>Изменить: ${esc(label(p))}</h3>
      <label class="field col"><span>Название</span><input type="text" id="eName" value="${esc(p.n)}" data-act="calcinput" aria-label="Название"></label>
      ${p.mine ? `<p class="sub">БЖУ на ${num(p.base)} ${esc(p.u)}</p>${macroInputs(p)}` : `<p class="sub">БЖУ этого продукта из таблицы, их меняю я по твоей просьбе. Здесь можно поменять название или скрыть продукт из списка.</p>`}
      <button type="button" class="btn small" data-act="saveprod">Сохранить</button>
      ${p.orig ? '<button type="button" class="btn ghost small" data-act="origprod">Вернуть название из таблицы</button>' : ''}
      ${p.mine ? '<button type="button" class="btn ghost small" data-act="delmyfood">Удалить из моих блюд</button>' : '<button type="button" class="btn ghost small" data-act="hideprod">Скрыть из списка</button>'}
      <button type="button" class="btn ghost small" data-act="editcancel">Отмена</button>`;
    s.innerHTML = sheetFrame(title, body);
    return;
  }
  if (sheet.pick) {
    const p = sheet.pick, start = p.start || (p.base === 100 ? 100 : 1);
    body = `<h3>${esc(label(p))}</h3>
      <label class="field"><span>${sheet.target === undefined ? 'Сколько съел' : 'Порция'}</span><input type="number" inputmode="decimal" min="0" id="xAmount" value="${start}" data-act="xamount" aria-label="Количество"><span>${esc(p.u)}</span></label>
      <p class="sub" id="xInfo"></p>
      <button type="button" class="btn small" data-act="addpicked">Добавить</button>
      <button type="button" class="btn ghost small" data-act="backpick">Другой продукт</button>
      ${p.ref || p.from ? '' : '<button type="button" class="btn ghost small" data-act="editprod">Изменить или скрыть</button>'}`;
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
// Food goes either into a meal of the plan (the user builds the day) or to "outside the plan" (then the rest is recounted).
function addExtra(x) {
  const d = state.day;
  if (sheet.target !== undefined) {
    const key = `d${d}m${sheet.target}`;
    (state.adds[key] = state.adds[key] || []).push(x);
    save();
    closeSheet();
    return;
  }
  (state.extras[d] = state.extras[d] || []).push(x);
  save();
  if (!offerRebalance({ ...x, why: 'extra', kind: groupOf(x.n, x.cat) === 'sweet' ? 'sweet' : 'meal' }, d, x)) closeSheet();
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
  lockPage();
}

function shoppingList() {
  const sums = new Map();
  // shopFrom: when days are added to a running plan, shop only for the new days, with their own ticks.
  const from = PLAN.shopFrom || 0;
  dayIds().filter(d => d >= from).forEach(d => dayItems(d).forEach(({ it }) => {
    const rule = SHOP.find(r => r.re.test(it.n));
    if (!rule) return;
    const name = rule.name || it.n;
    const row = sums.get(name) || { name, key: from ? `${from}:${name}` : name, g: 0, fmt: rule.fmt };
    row.g += it.a;
    sums.set(name, row);
  }));
  return [...sums.values()];
}

function renderShop() {
  const rows = shoppingList().map(r => {
    const done = !!state.shop[r.key];
    return `<button type="button" class="shop ${done ? 'done' : ''}" data-act="shop" data-name="${esc(r.key)}" aria-pressed="${done}">
      <span class="tick"><i>${done ? '✓' : ''}</i></span><span>${esc(r.name)}</span><span class="amt">${r.fmt(r.g)}</span></button>`;
  }).join('');
  const days = dayIds().filter(d => d >= (PLAN.shopFrom || 0)).map(dayAt), span = days.length > 1 ? `${days[0].tab}–${days[days.length - 1].tab}` : days[0].tab;
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
    const before = DRY.test(n) || MASH.test(n) ? 'до варки' : 'до готовки';
    const rawLine = rawEdit === n
      ? `<label class="rawedit"><span>Вес ${before}</span><input type="number" inputmode="numeric" min="1" value="${raw ? raw.g : ''}" data-act="rawsave" data-name="${esc(n)}" aria-label="${esc(dishName(n))}: вес ${before}, г"><span>г</span></label>`
      : `<button type="button" class="rawbtn" data-act="rawedit" data-name="${esc(n)}">${raw ? `Вес ${before}: ${raw.g} г · ${shortDate(raw.at)}` : `+ Записать вес ${before}`}</button>`;
    return `<section class="card cook" data-name="${esc(n)}">
      <h2>${esc(dishName(n))}</h2>
      <label class="field"><span>Вес готового продукта<small class="note">из 100 г ${rawWord(n)}${y && at ? ` · обновлено ${shortDate(at)}` : ''}</small></span>
        <input type="number" inputmode="numeric" min="1" value="${y || ''}" placeholder="—" data-act="yield" data-name="${esc(n)}" aria-label="${esc(dishName(n))}: вес готового из 100 г ${rawWord(n)}"><span>г</span></label>
      ${rawLine}
      <details><summary>Посчитать по весам</summary>
        <label class="field"><span>Вес ${MASH.test(n) ? 'всех продуктов' : 'продукта'} ${before}</span><input type="number" inputmode="numeric" min="1" value="${raw ? raw.g : ''}" data-f="raw" data-act="calcinput" aria-label="Вес продукта ${before}, г"><span>г</span></label>
        <label class="field"><span>Вес готового вместе с посудой</span><input type="number" inputmode="numeric" min="1" data-f="scale" data-act="calcinput" aria-label="Вес готового вместе с посудой, г"><span>г</span></label>
        ${vesselPick}
        <button type="button" class="btn small" data-act="calc">Посчитать</button>
      </details>
      ${y || raw ? `<button type="button" class="btn ghost small" data-act="clearyield" data-name="${esc(n)}">Стереть, сварю новые</button>` : ''}
      <button type="button" class="rawbtn" data-act="hidecook" data-name="${esc(n)}">Убрать блюдо из граммовок</button>
    </section>`;
  };
  const all = cookables(), isSide = n => ((shared.cookAdd || []).find(x => x.n === n) || { side: SIDE.test(n) }).side;
  const others = [...new Set(dayIds().flatMap(d => dayItems(d).map(o => o.it.n)))].filter(n => !all.includes(n)).sort((a, b) => a.localeCompare(b, 'ru'));
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
    ${group('side', 'Гарниры', all.filter(n => isSide(n)))}
    ${group('main', 'Мясо и основные блюда', all.filter(n => !isSide(n)))}
    <details class="group"><summary><span><b>Добавить блюдо</b><small>Своё блюдо в гарниры или в основные</small></span></summary>
      <section class="card cook">
        <label class="field col"><span>Из плана</span><select id="cookPick" data-act="calcinput" aria-label="Блюдо из плана"><option value="">Выбери блюдо</option>${others.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
        <label class="field col"><span>Или своё название</span><input type="text" id="cookName" data-act="calcinput" placeholder="Например, плов" aria-label="Название блюда"></label>
        <div class="chips cmode" role="group" aria-label="Куда добавить">
          <button type="button" class="on" data-act="cmode" data-m="main" aria-pressed="true">Мясо и основные блюда</button>
          <button type="button" data-act="cmode" data-m="side" aria-pressed="false">Гарниры</button>
        </div>
        <button type="button" class="btn small" data-act="addcook">Добавить в граммовки</button>
      </section></details>
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
  if (!dayIds().includes(state.day)) state.day = dayIds()[0];
  $('days').innerHTML = dayIds().map(d =>
    `<button type="button" class="day" role="tab" data-act="day" data-d="${d}" aria-selected="${d === state.day}">${esc(dayAt(d).tab)}</button>`).join('')
    + (window.Sync && Sync.viewer ? '' : '<button type="button" class="day dayadd" data-act="newday" aria-label="Добавить день">+</button>');
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
  const v = Math.max(0, Math.min(it.a, pieces(it.u) ? Math.round(n * 2) / 2 : Math.round(n)));
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
  const day = dayAt(d), { t, plan } = totals(d), lines = [`${day.title}`];
  day.meals.forEach((meal, m) => {
    const list = mealItems(d, m);
    if (!list.length) return;
    lines.push(`${meal.name}:`);
    list.forEach(({ id, it }) => {
      const got = eatenOf(id, it);
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
  if (!el || ['input', 'amt', 'slider', 'cookedinput', 'yield', 'rawsave', 'calcinput', 'sheetsearch', 'xamount', 'vphoto'].includes(el.dataset.act)) return;
  const { act, id } = el.dataset;
  if (act === 'viewphoto') { openPhoto(shared.vessels[+el.dataset.i]); return; }
  if (act === 'closephoto') { document.querySelectorAll('.photoview').forEach(b => b.remove()); if (!sheet) unlockPage(); return; }
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
  if (act === 'addto') { sheet = { mode: 'extra', q: '', target: +el.dataset.m }; renderSheet(); return; }
  if (act === 'newday') {
    if (!freeDates().length) { toast('На ближайшие две недели дни уже есть'); return; }
    sheet = { mode: 'newday', date: 0, train: false, from: 'gen', side: 0, meat: 0 };
    renderSheet();
    return;
  }
  if (act === 'nd') {
    const v = el.dataset.v;
    sheet[el.dataset.k] = el.dataset.k === 'from' ? (v === '' ? null : v === 'gen' ? 'gen' : +v) : el.dataset.k === 'train' ? v === '1' : +v;
    renderSheet();
    return;
  }
  if (act === 'createday') { createDay(); save(); closeSheet(); open = null; render(); window.scrollTo(0, 0); return; }
  if (act === 'delday') {
    if (dayIds().length < 2) { toast('Это последний день, его нельзя удалить'); return; }
    if (state.day < MY) {
      if (!confirm('Убрать этот день из списка? Отметки сохранятся, вернуть его можно внизу любого дня.')) return;
      state.hidden[state.day] = true;
      state.day = dayIds()[0];
      open = null;
      save();
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (!confirm('Удалить этот день вместе с отметками?')) return;
    deleteDay(state.day);
    save();
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (act === 'dorebalance') { applyRebalance(sheet.holder, sheet.d, sheet.custom ? customPlan() : sheet.ways[sheet.way]); save(); closeSheet(); render(); toast('Остаток дня пересчитан'); return; }
  if (act === 'rbcustom') {
    if (el.dataset.v === '1') {
      // Sliders start from the variant on screen, so it can be fine-tuned.
      sheet.custom = {};
      for (const c of sheet.ways[sheet.way].changes) if (c.on && !c.swap) sheet.custom[c.id] = Math.max(0, c.to);
    } else sheet.custom = null;
    renderSheet();
    return;
  }
  if (act === 'daykind') { const train = el.dataset.v === '1'; if (isTrain(state.day) !== train) switchDay(state.day, train); return; }
  if (act === 'slall') {
    // Sliders that were moved keep their place; the list only grows or shrinks.
    sheet.slAll = !sheet.slAll;
    renderSheet();
    return;
  }
  if (act === 'restore') {
    const d = state.day, it = itemAt(d, mealOf(id), +id.match(/i(\d+)$/)[1]);
    delete state.removed[id];
    save();
    render();
    if (Math.abs(it.k) < 40 || !offerRebalance({ n: it.n, why: 'restore', kind: 'meal', id, m: mealOf(id), p: it.p, f: it.f, c: it.c, k: it.k }, d, {})) toast('Вернул в день');
    return;
  }
  if (act === 'unhide') {
    const d = +el.dataset.d;
    delete state.hidden[d];
    state.day = d;
    save();
    render();
    window.scrollTo(0, 0);
    toast('День вернулся');
    return;
  }
  if (act === 'eatenportion') {
    const id = el.dataset.id, it = findItem(id);
    setPortion(id, eatenOf(id, it));
    return;
  }
  if (act === 'resetday') {
    if (!confirm('Вернуть день к плану? Замены, порции, убранное и добавленное в этом дне сбросятся. Съеденное и «Съел вне плана» останутся.')) return;
    resetDay(state.day);
    open = null;
    save();
    render();
    toast('День вернулся к плану');
    return;
  }
  if (act === 'swapall') { sheet.all = el.dataset.v === '1'; renderSheet(); return; }
  if (act === 'rbnext') { sheet.way = (sheet.way + 1) % sheet.ways.length; renderSheet(); return; }
  if (act === 'rbtoggle') {
    const r = sheet.ways[sheet.way], c = el.dataset.i === 'add' ? r.add : r.changes[+el.dataset.i];
    c.on = !c.on;
    renderSheet();
    return;
  }
  if (act === 'remove') {
    const it = findItem(id), left = it.a - eatenOf(id, it), d = state.day, part = {};
    for (const m of MACROS) part[m] = -(it[m] || 0) * left / it.a;
    state.removed[id] = true;
    delete state.eaten[id];
    open = null;
    save();
    render();
    if (Math.abs(part.k) < 40 || !offerRebalance({ n: it.n, why: 'remove', kind: 'meal', id, m: mealOf(id), ...part }, d, {})) toast('Убрано из дня');
    return;
  }
  if (act === 'hidecook') {
    const n = el.dataset.name;
    shared.cookAdd = (shared.cookAdd || []).filter(x => x.n !== n);
    if (!(shared.cookHide || []).includes(n)) (shared.cookHide = shared.cookHide || []).push(n);
    saveShared();
    render();
    return;
  }
  if (act === 'addcook') {
    const n = $('cookName').value.trim() || $('cookPick').value;
    if (!n) { toast('Выбери блюдо или впиши название'); return; }
    shared.cookHide = (shared.cookHide || []).filter(x => x !== n);
    shared.cookAdd = (shared.cookAdd || []).filter(x => x.n !== n).concat({ n, side: el.closest('.cook').querySelector('.cmode .on').dataset.m === 'side' });
    gramsOpen[shared.cookAdd[shared.cookAdd.length - 1].side ? 'side' : 'main'] = true;
    saveShared();
    render();
    return;
  }
  if (act === 'swap') { sheet = { mode: 'swap', id, q: '' }; renderSheet(); return; }
  if (act === 'closesheet') { closeSheet(); return; }
  if (act === 'pickextra') { sheet.pick = PRODUCTS[+el.dataset.i]; renderSheet(); return; }
  if (act === 'pickweb') { sheet.pick = sheet.web[+el.dataset.i]; renderSheet(); return; }
  if (act === 'websearch') { webSearch(); return; }
  if (act === 'backpick') { sheet.pick = null; sheet.editing = false; renderSheet(); return; }
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
    // The per-100 toggle lives in the sheet; the day page has its own .cmode chips (training / rest) above it.
    const per100 = $('sheet').querySelector('[data-act="cmode"][data-m="100"]').classList.contains('on');
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
  if (act === 'editprod') { sheet.editing = true; renderSheet(); return; }
  if (act === 'editcancel') { sheet.editing = false; renderSheet(); return; }
  if (act === 'saveprod' || act === 'origprod' || act === 'hideprod') {
    const p = sheet.pick, key = p.orig || p.n, edit = shared.prodEdit = shared.prodEdit || {};
    const n = act === 'origprod' ? key : $('eName').value.trim().replace(/\s+/g, ' ');
    if (!n) { toast('Впиши название'); return; }
    if (act === 'hideprod') {
      if (!confirm(`Скрыть «${p.n}» из списка продуктов? Вернуть можно внизу списка.`)) return;
      edit[key] = { hidden: true };
    } else if (p.mine) {
      const v = readMacros();
      if (!v.k) { toast('Впиши калории'); return; }
      if (norm(n) !== norm(p.n) && PRODUCTS.some(x => norm(x.n) === norm(n))) { toast('Продукт с таким названием уже есть'); return; }
      shared.myfoods = (shared.myfoods || []).map(x => (x.n === p.n ? { ...x, n, ...v } : x));
    } else {
      if (norm(n) !== norm(p.n) && PRODUCTS.some(x => x !== p && norm(x.n) === norm(n))) { toast('Продукт с таким названием уже есть'); return; }
      if (n === key) delete edit[key]; else edit[key] = { n };
    }
    saveShared();
    rebuildProducts();
    sheet.editing = false;
    sheet.pick = act === 'hideprod' ? null : PRODUCTS.find(x => x.n === n && !!x.mine === !!p.mine) || null;
    renderSheet();
    toast(act === 'hideprod' ? 'Скрыл из списка' : 'Сохранил');
    return;
  }
  if (act === 'unhideprod') {
    delete (shared.prodEdit || {})[el.dataset.n];
    saveShared();
    rebuildProducts();
    renderSheet();
    toast('Продукт вернулся в список');
    return;
  }
  if (act === 'delmyfood') {
    if (!confirm('Убрать это блюдо из списка? Уже добавленные записи останутся.')) return;
    const n = sheet.pick.n;
    shared.myfoods = (shared.myfoods || []).filter(p => p.n !== n);
    saveShared();
    rebuildProducts();
    sheet.pick = null;
    sheet.editing = false;
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
      list[sheet.i] = { ...portionOf({ n, brand: '', base: src.base, u: src.u, ...v }, g), ...(x.adj ? { adj: x.adj } : {}) };
    } else {
      list[sheet.i] = { ...x, n, ...v };
    }
    save();
    closeSheet();
    render();
    return;
  }
  if (act === 'doswap') {
    const o = swapOptions()[+el.dataset.i], sid = sheet.id, was = findItem(sid), d = state.day;
    if (state.swaps[sid]) undoRebalance(state.swaps[sid]);
    state.swaps[sid] = o.x;
    delete state.amt[sid];
    delete state.eaten[sid];
    save();
    closeSheet();
    render();
    // A swap that moves calories, carbs or fat is evened out by the rest of the day, like food from outside the plan.
    const diff = diffOf(o.x, was);
    if (Math.abs(diff.k) >= 40 || diff.c > 8 || diff.f > 8) offerRebalance({ n: o.x.n, why: 'swap', kind: 'swap', id: sid, m: mealOf(sid), ...diff }, d, o.x);
    return;
  }
  if (act === 'unswap') { if (state.swaps[id]) undoRebalance(state.swaps[id]); delete state.swaps[id]; delete state.amt[id]; delete state.eaten[id]; save(); render(); return; }
  if (act === 'delextra') { undoRebalance(extrasOf(state.day).splice(+el.dataset.i, 1)[0]); save(); render(); return; }
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
  if (act === 'slider' && sheet && sheet.custom) {
    const id = e.target.dataset.id, v = +e.target.value, o = sliderItems().find(x => x.id === id);
    sheet.custom[id] = v;
    const out = document.querySelector(`[data-sv="${id}"]`);
    if (out && o) out.innerHTML = `${num(v)} ${esc(o.it.u)}${v !== o.it.a ? ` <em>было ${num(o.it.a)}</em>` : ''}`;
    $('rbFoot').textContent = balanceText(sheet.x, customPlan());
    return;
  }
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
// The user's own portion for a product; the rest of the day is rebalanced if the change is big enough.
function setPortion(id, value) {
  const it = findItem(id), a = Math.round((Number(value) || 0) * 10) / 10;
  if (a <= 0) { toast('Чтобы убрать продукт, нажми «Убрать из дня»'); render(); return; }
  if (a === (it.was || it.a) && !state.amt[id]) return;
  const before = findItem(id);
  state.amt[id] = a;
  if (state.eaten[id] > a) state.eaten[id] = a;
  save();
  render();
  // A smaller portion is made up elsewhere, a bigger one paid for, if the user wants.
  const diff = diffOf(findItem(id), before);
  if (Math.abs(diff.k) >= 40) offerRebalance({ n: it.n, why: 'portion', kind: groupOf(it.n) === 'sweet' ? 'sweet' : 'meal', id, m: mealOf(id), ...diff }, state.day, {});
  else toast(`Порция теперь ${a} ${it.u}`);
}

document.addEventListener('change', e => {
  const t = e.target, act = t.dataset.act;
  if (window.Sync && Sync.viewer && ['input', 'amt', 'vphoto', 'cookedinput', 'yield', 'rawsave'].includes(act)) {
    toast('Менять можно только на основном телефоне');
    render();
    return;
  }
  if (act === 'input') { setEaten(t.dataset.id, t.value); render(); }
  if (act === 'amt') setPortion(t.dataset.id, Number(t.value));
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

if (fixNames()) { save(); saveShared(); }
// Chicken cutlets are eaten whole, by the piece, so they have no weights card (user, 2026-11-27).
(function dropCutletCard() {
  const n = 'Котлета куриная домашняя', KEY = 'pitanie:nocutlet';
  try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, '1'); } catch (e) { return; }
  shared.cookSeen = (shared.cookSeen || []).filter(x => x !== n);
  if (shared.yield) delete shared.yield[n];
  if (shared.yieldAt) delete shared.yieldAt[n];
  saveShared();
})();

// Cooked weight the user named for a new dish (g of cooked from 100 g raw), set once; after that the weights tab is his.
(function seedYield() {
  const SEED = { 'Голень куриная без кожи и кости': 65 }, KEY = 'pitanie:yseed';
  let done = [];
  try { done = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return; }
  const todo = Object.keys(SEED).filter(n => !done.includes(n));
  if (!todo.length) return;
  todo.forEach(n => { if (!shared.yield[n]) { shared.yield[n] = SEED[n]; (shared.yieldAt = shared.yieldAt || {})[n] = new Date().toISOString(); } });
  try { localStorage.setItem(KEY, JSON.stringify(done.concat(todo))); } catch (e) { /* set again next time */ }
  saveShared();
})();

// One-off fix, 23 Nov 2026: these two dishes were entered with БЖУ per 100 g, but a bug saved them per whole portion.
(function fixPer100() {
  const FLAG = 'pitanie:fix100-2026-11-23', names = ['Пицца Спар с курицей и грибами', 'Роллы Спар Филадельфия лайт'];
  try { if (localStorage.getItem(FLAG)) return; } catch (e) { return; }
  const hit = x => x && x.u === 'г' && names.includes(x.n);
  let changed = false;
  (shared.myfoods || []).forEach(p => { if (hit(p) && p.base !== 100) { p.base = 100; changed = true; } });
  const fix = list => (list || []).forEach((x, i) => {
    if (!hit(x) || !x.src || x.src.base === 100) return;
    list[i] = { ...portionOf({ ...x.src, n: x.n, brand: '', base: 100 }, x.a), ...(x.adj ? { adj: x.adj } : {}) };
    changed = true;
  });
  Object.values(state.extras || {}).forEach(fix);
  Object.values(state.adds || {}).forEach(fix);
  try { localStorage.setItem(FLAG, '1'); } catch (e) { /* runs again next time, nothing left to fix */ }
  if (changed) { save(); saveShared(); rebuildProducts(); }
})();

if (!dayIds().includes(state.day)) {
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  state.day = dayIds().find(d => dayAt(d).title.includes(' ' + today)) ?? dayIds()[0];
}
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
