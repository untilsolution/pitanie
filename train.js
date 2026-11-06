'use strict';
// Вкладка «Тренировка», вес и напоминание о замерах. Журнал лежит в Sync.journal.
// Данные программы приходят из training.js: его сама публикует BodyLab.
// schedule, lineText и warmup повторяют BodyLab/web/js/core.js, менять их нужно вместе.
const T = window.TRAINING || null;
const ui = { slot: null, res: {}, note: '', loaded: null, editWeight: false };

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const plusDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const showDay = s => { const d = parseDay(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; };
const journal = () => Sync.journal;
const doneMap = () => (journal().workouts[T.file] = journal().workouts[T.file] || {});

function slotList() {
  const out = [];
  for (const mz of T.mezocycles) for (const w of mz.weeks) for (const d of mz.days) out.push(`M${mz.n}-W${w.n}-D${d.n}`);
  return out;
}
const slotParts = id => { const x = /^M(\d+)-W(\d+)-D(\d+)$/.exec(id); return { m: +x[1], w: +x[2], d: +x[3] }; };
const slotTitle = id => { const s = slotParts(id); return `Мезоцикл ${s.m} · неделя ${s.w} · день ${s.d}`; };
function slotPlanOf(id) {
  const s = slotParts(id), mz = T.mezocycles.find(x => x.n === s.m), d = mz.days.find(x => x.n === s.d);
  return { week: mz.weeks[s.w - 1].name, exercises: d.exercises.map(e => ({ name: e.name, lines: e.weeks[s.w - 1] || [] })).filter(e => e.lines.length) };
}
function nextDay(from) {
  for (let i = 0; i < 14; i++) {
    const s = plusDays(from, i), w = parseDay(s).getDay() || 7;
    if (T.days.includes(w)) return s;
  }
  return from;
}
function scheduleList() {
  const slots = slotList(), a = Math.max(0, slots.indexOf(T.anchor.slot)), today = todayStr(), done = doneMap(), out = [];
  let cursor = null, next = null;
  slots.forEach((id, i) => {
    if (i < a && !done[id]) return;
    if (done[id]) { out.push({ id, status: 'done', date: done[id].date }); cursor = done[id].date; return; }
    let date = T.moved[id];
    if (!date) {
      date = cursor ? nextDay(plusDays(cursor, 1)) : T.anchor.date;
      if (date < today) date = today;
    }
    cursor = date;
    const item = { id, status: 'planned', date };
    if (!next) next = item;
    out.push(item);
  });
  return { items: out, next };
}

function scheme(line) {
  if (line.amrap) return 'до отказа';
  if (line.rir != null) return `RIR ${line.rir}`;
  if (line.reps) return `${line.sets ?? 1}×${line.reps}`;
  return line.scheme ?? '';
}
function lineText(line) {
  const w = line.bodyweight ? 'свой вес' : line.weight != null ? `${num(line.weight)} кг` : '';
  return `${w}${line.tolerance ? ` (±${num(line.tolerance)})` : ''} ${scheme(line)}`.trim();
}

const LIFTS = [[/^жим штанги лёжа/i, true], [/^приседания со штангой/i, false], [/^становая тяга/i, false]];
function ladder(t) {
  const out = [20];
  let add = 30;
  while (out[out.length - 1] < t) { out.push(out[out.length - 1] + add); add = add === 30 ? 20 : 30; }
  return out.filter(w => w < t);
}
function warmupSteps(t) {
  const below = ladder(t);
  if (!below.length) return [];
  const top = below[below.length - 1], prev = below[below.length - 2];
  let last = top;
  if (t - top < 20 && prev != null) last = Math.min(top, Math.floor((prev + t) / 2 / 5 + 0.5) * 5);
  return [...below.filter(w => w < last), last];
}
function warmupFor(e) {
  const lift = LIFTS.find(([re]) => re.test(e.name)), line = e.lines.find(l => l.weight);
  if (!lift || !line) return null;
  const pts = warmupSteps(line.weight), n = pts.length;
  const reps = line.reps ?? 1, big = reps >= 8, cap = big ? 12 : 6, add = big ? 2 : 1, end = Math.min(reps, cap);
  return { target: line.weight, sets: pts.map((w, i) => {
    const r = Math.min(cap, end + add * (n - 1 - i));
    return `${num(w)} кг ${lift[1] && (n > 1 ? i < 2 : line.weight >= 50) ? 2 : 1}×${r}`;
  }) };
}

function lastWeight() {
  const dates = Object.keys(journal().weights).sort();
  return dates.length ? journal().weights[dates[dates.length - 1]] : (T ? T.weight : null);
}
const asksReps = e => e.lines.some(l => l.amrap);
const asksWeight = e => e.lines.some(l => l.tolerance || l.warning);

function loadResults(id, plan) {
  if (ui.loaded === id) return;
  ui.loaded = id;
  ui.res = {};
  const log = doneMap()[id];
  ui.note = log?.data?.note ?? '';
  for (const e of plan.exercises) {
    const sets = log?.data?.exercises?.[e.name]?.sets ?? [];
    ui.res[e.name] = { r: sets.find(s => s.amrap)?.r ?? null, w: asksWeight(e) ? sets[0]?.w ?? null : null };
  }
}

function exerciseHtml(e, done) {
  const wu = warmupFor(e), top = e.lines.find(l => l.weight), bw = lastWeight(), r = ui.res[e.name] || {};
  const warn = e.lines.find(l => l.warning), dis = done ? 'disabled' : '';
  const belt = /отягощ/i.test(e.name) && top && bw ? `<small class="trnote">На поясе ${num(Math.max(0, top.weight - bw))} кг при весе ${num(bw)} кг</small>` : '';
  const field = (f, text, unit, step) => `<label class="field"><span>${text}</span><input type="number" inputmode="decimal" step="${step}" min="0" data-tf="${f}" data-ex="${esc(e.name)}" value="${r[f] ?? ''}" ${dis}><span>${unit}</span></label>`;
  return `<section class="card trex"><h2>${esc(e.name)}</h2>
    <div class="trlines">${e.lines.map(l => `<span>${esc(lineText(l))}</span>`).join('')}</div>${belt}
    ${warn ? `<p class="trwarn">${esc(warn.warning)}</p>${done ? '' : `<button type="button" class="btn ghost small" data-tr="fix" data-ex="${esc(e.name)}" data-w="${warn.suggested.weight}">Взять ${num(warn.suggested.weight)} кг</button>`}` : ''}
    ${wu && wu.sets.length ? `<div class="trwarm"><small>Разминка к ${num(wu.target)} кг</small><ol>${wu.sets.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
    ${asksWeight(e) ? field('w', 'Какой вес взял', 'кг', 0.5) : ''}${asksReps(e) ? field('r', 'Вышло до отказа', 'повт.', 1) : ''}
  </section>`;
}

window.renderTrain = () => {
  if (!T) { $('main').innerHTML = '<h1>Тренировка</h1><p class="sub">Программа ещё не загружена. Открой BodyLab на компьютере.</p>'; return; }
  const { items, next } = scheduleList();
  if (!items.length) { $('main').innerHTML = '<h1>Тренировка</h1><p class="sub">Программа пройдена.</p>'; return; }
  if (!ui.slot || !items.some(i => i.id === ui.slot)) ui.slot = next ? next.id : items[items.length - 1].id;
  const at = items.findIndex(i => i.id === ui.slot), item = items[at], plan = slotPlanOf(item.id), done = item.status === 'done';
  loadResults(item.id, plan);
  $('main').innerHTML = `<h1>${esc(slotTitle(item.id))}</h1>
    <p class="sub">${esc(T.title)} · ${esc(plan.week)} · ${esc(showDay(item.date))}${item === next ? ' · ближайшая' : ''}${done ? ' · выполнена' : ''}</p>
    <div class="trnav">
      <button type="button" class="btn ghost small" data-tr="go" data-i="${at - 1}" ${at ? '' : 'disabled'}>Предыдущая</button>
      <button type="button" class="btn ghost small" data-tr="go" data-i="${at + 1}" ${at < items.length - 1 ? '' : 'disabled'}>Следующая</button>
    </div>
    ${plan.exercises.map(e => exerciseHtml(e, done)).join('')}
    <section class="card trex">
      <label class="field col"><span>Заметка</span><input type="text" data-tf="note" value="${esc(ui.note)}" ${done ? 'disabled' : ''} placeholder="Если было не по плану"></label>
      ${done ? '<button type="button" class="btn ghost small" data-tr="undo">Отменить отметку</button>' : `<label class="field"><span>Дата</span><input type="date" id="trDate" value="${todayStr()}"></label>
      <button type="button" class="btn" data-tr="finish">Тренировка выполнена</button>`}
    </section>`;
};

function buildLog(plan) {
  const exercises = {};
  for (const e of plan.exercises) {
    const r = ui.res[e.name] || {}, sets = [];
    for (const line of e.lines) {
      for (let i = 0; i < (line.sets ?? 1); i++) {
        sets.push({ w: line.weight ?? null, r: line.reps ?? null, planW: line.weight ?? null, planR: line.reps ?? null, amrap: !!line.amrap, rir: line.rir ?? null, done: !!line.reps || line.rir != null });
      }
    }
    if (r.w) sets[0].w = r.w;
    for (const s of sets) if (s.amrap) { s.r = r.r || null; s.done = !!r.r; }
    exercises[e.name] = { sets };
  }
  return { exercises, note: ui.note };
}

const seenList = () => { try { return JSON.parse(localStorage.getItem('pitanie:seen')) || []; } catch (e) { return []; } };

// Плашки: напоминание о замерах считается здесь, чтобы работать при выключенном компьютере,
// а остальные присылает BodyLab. Замер, записанный в BodyLab, убирает напоминание сам.
function notices() {
  const out = [], today = todayStr(), day = new Date().getDay(), last = T?.lastMeasure;
  const gap = last ? Math.round((parseDay(today) - parseDay(last)) / 864e5) : null;
  if (last !== today) {
    if (day === 5) out.push({ id: `measure-${today}`, text: 'Сегодня пятница: замеры, вес и обхваты' });
    else if (gap >= 8) out.push({ id: `measure-${today}`, text: `Прошло ${gap} дн. с замера, пятничный пропущен` });
    else if (day === 4) out.push({ id: `measure-${today}`, text: 'Завтра утром замеры: вес и обхваты' });
  }
  return [...out, ...(T?.notices || [])];
}

// Кнопка внизу рациона, когда форма веса уже скрыта
window.weightLink = () => {
  const w = journal().weights[todayStr()];
  return w && !ui.editWeight ? `<button type="button" class="btn ghost" data-tr="wedit">Вес сегодня ${num(w)} кг, изменить</button>` : '';
};

// Верх вкладки «Рацион»: плашки и вес
window.trainTop = () => {
  const today = todayStr();
  const hint = notices().filter(n => !seenList().includes(n.id)).map(n => `<section class="card trhint"><span>${esc(n.text)}</span><button type="button" data-tr="seen" data-id="${esc(n.id)}">Закрыть</button></section>`).join('');
  const w = journal().weights[today];
  if (w && !ui.editWeight) return hint;
  const start = w ?? lastWeight() ?? '';
  return `${hint}<section class="card wcard"><span>Вес</span>
    <div class="step"><button type="button" data-tr="wstep" data-d="-0.1" aria-label="Меньше">−</button>
    <input type="number" inputmode="decimal" step="0.1" id="wVal" value="${start}" aria-label="Вес, кг">
    <button type="button" data-tr="wstep" data-d="0.1" aria-label="Больше">+</button></div>
    <button type="button" class="wsave" data-tr="wsave">Записать</button></section>`;
};

// Хорошая новость только после ответа GitHub
function report(text) {
  Sync.saveJournal().then(error => toast(error ? `Сохранено на телефоне, не отправлено: ${error}` : text));
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-tr]');
  if (!el) return;
  const act = el.dataset.tr;
  if (act === 'seen') {
    try { localStorage.setItem('pitanie:seen', JSON.stringify([...seenList(), el.dataset.id].slice(-60))); } catch (x) { /* покажем ещё раз */ }
  } else if (act === 'wedit') {
    ui.editWeight = true;
    window.scrollTo(0, 0);
  } else if (act === 'wstep') {
    const box = $('wVal');
    box.value = (Math.round(((Number(box.value) || 0) + Number(el.dataset.d)) * 10) / 10).toFixed(1);
    return;
  } else if (act === 'wsave') {
    const v = Math.round(Number($('wVal').value) * 10) / 10;
    if (!(v > 30 && v < 300)) { toast('Проверь вес'); return; }
    journal().weights[todayStr()] = v;
    ui.editWeight = false;
    report('Вес записан');
  } else if (act === 'go') {
    ui.slot = scheduleList().items[+el.dataset.i].id;
    window.scrollTo(0, 0);
  } else if (act === 'fix') {
    ui.res[el.dataset.ex].w = +el.dataset.w;
  } else if (act === 'finish') {
    const plan = slotPlanOf(ui.slot);
    doneMap()[ui.slot] = { date: $('trDate').value || todayStr(), data: buildLog(plan) };
    report('Тренировка записана');
    ui.slot = null;
    ui.loaded = null;
    window.scrollTo(0, 0);
  } else if (act === 'undo') {
    if (!confirm('Отменить отметку этой тренировки?')) return;
    delete doneMap()[ui.slot];
    Sync.saveJournal();
    ui.loaded = null;
  }
  render();
});
document.addEventListener('input', e => {
  const f = e.target.dataset.tf;
  if (!f) return;
  if (f === 'note') ui.note = e.target.value;
  else ui.res[e.target.dataset.ex][f] = e.target.value === '' ? null : Number(e.target.value);
});
