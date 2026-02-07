// Dog Calendar PWA (local-only)
// - Lenta: Upcoming/Overdue/History
// - Add/Edit events
// - Done/Undo
// - Reschedule
// - Generate .ics calendar event with VALARM -P7D

const DOGS = {
  bonny: { id: "bonny", name: "Бонни" },
  nola: { id: "nola", name: "Нола" },
  both: { id: "both", name: "Бонни + Нола" },
};

const TYPES = {
  vaccination: "Прививки",
  flea_collar_order: "Заказать ошейник от блох",
  deworming: "Entwurmung",
  shower: "Duschen 🚿",
  food_order: "Заказать еду",
  order_deworming: "Заказать Entwurmung",
  order_wurmtest: "Заказать Wurmtest",
  do_wurmtest: "Сделать Wurmtest",
  medkit_check: "Проверка аптечки",
  order_medkit: "Заказать всё для аптечки",
  order_pawbalm: "Заказать Pfotenbalsam",
  order_nosebalm: "Заказать Nasenbalsam",
  apply_paws: "Смазать лапы",
  apply_nose: "Смазать нос",
  blood_test: "Анализ крови",
  nails: "Проверка и стрижка ногтей",
};

const STORAGE_KEY = "dogcal.events.v1";
const SETTINGS_KEY = "dogcal.settings.v1";

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(e);
    return [];
  }
}
function saveEvents(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { defaultReminderDays: 7 };
  } catch {
    return { defaultReminderDays: 7 };
  }
}
function uid() {
  // Simple unique id
  return "e_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseISODate(iso) {
  // iso: YYYY-MM-DD -> local date at noon to avoid DST edge cases for comparisons
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function repeatLabel(rule){
  const map = {
    none: "",
    yearly: "ежегодно",
    monthly: "ежемесячно",
    every3days: "раз в 3 дня",
    twiceWeek: "2 раза в неделю",
    quarterly: "раз в квартал",
    sixWeeks: "раз в полтора месяца",
  };
  return map[rule] || "";
}
function formatDate(iso) {
  const d = parseISODate(iso);
  return d.toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" });
}
function daysDiff(aISO, bISO) {
  // b - a in days
  const a = parseISODate(aISO);
  const b = parseISODate(bISO);
  const ms = (b - a);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
function addYearsISO(iso, years) {
  const d = parseISODate(iso);
  d.setFullYear(d.getFullYear() + years);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(dateISO, days){
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function addMonthsISO(dateISO, months){
  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // handle month rollover
  if (d.getDate() !== day){
    d.setDate(0); // last day previous month
  }
  return d.toISOString().slice(0,10);
}
function addSixWeeksISO(dateISO){
  return addDaysISO(dateISO, 42);
}
function nextTwiceWeekISO(dateISO){
  const d = new Date(dateISO + "T00:00:00");
  const wd = d.getDay(); // 0 Sun..6 Sat
  // roughly Mon/Thu rhythm; if earlier in week -> +3, else +4
  const delta = (wd === 0) ? 3 : (wd <= 3 ? 3 : 4);
  return addDaysISO(dateISO, delta);
}
function nextByRule(dateISO, rule){
  switch(rule){
    case "yearly": return addYearsISO(dateISO, 1);
    case "monthly": return addMonthsISO(dateISO, 1);
    case "quarterly": return addMonthsISO(dateISO, 3);
    case "sixWeeks": return addSixWeeksISO(dateISO);
    case "every3days": return addDaysISO(dateISO, 3);
    case "twiceWeek": return nextTwiceWeekISO(dateISO);
    default: return null;
  }
}


function statusBadge(event, settings) {
  const isDone = !!event.doneAt;
  if (isDone) return { text: "Выполнено", cls: "ok" };

  const t = todayISO();
  const diff = daysDiff(t, event.date); // event.date - today
  if (diff < 0) return { text: "Просрочено", cls: "bad" };
  if (diff <= settings.defaultReminderDays) return { text: `Скоро (≤ ${settings.defaultReminderDays}д)`, cls: "warn" };
  return { text: "Запланировано", cls: "" };
}

function eventTitle(event) {
  return `${DOGS[event.dogId].name} — ${TYPES[event.type]}`;
}

function escapeICS(str) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function isoToYYYYMMDD(iso) {
  return iso.replaceAll("-", "");
}
function utcStamp() {
  const d = new Date();
  // YYYYMMDDTHHMMSSZ
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function makeICS({ title, dateISO, note, reminderDays, uidValue }) {
  const dt = isoToYYYYMMDD(dateISO);
  // All-day event: DTSTART:DATE and DTEND next day
  const dtendISO = addYearsISO(dateISO, 0); // clone
  const end = parseISODate(dateISO);
  end.setDate(end.getDate() + 1);
  const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  const dtEnd = isoToYYYYMMDD(endISO);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dog Calendar PWA//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeICS(uidValue)}`,
    `DTSTAMP:${utcStamp()}`,
    `SUMMARY:${escapeICS(title)}`,
    `DTSTART;VALUE=DATE:${dt}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
  ];

  if (note && note.trim()) {
    lines.push(`DESCRIPTION:${escapeICS(note.trim())}`);
  }

  // Alarm -P7D by default
  const rd = Number.isFinite(reminderDays) ? reminderDays : 7;
  lines.push(
    "BEGIN:VALARM",
    `TRIGGER:-P${rd}D`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeICS("Напоминание: " + title)}`,
    "END:VALARM"
  );

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
}

// UI state
let state = {
  tab: "upcoming",
  dogFilter: "all",
  events: loadEvents(),
  settings: loadSettings(),
};

// Elements
const listEl = document.getElementById("list");
const dogFilterEl = document.getElementById("dogFilter");
const tabs = Array.from(document.querySelectorAll(".tab"));

const modal = document.getElementById("modal");
const addBtn = document.getElementById("addBtn");
const closeModalBtn = document.getElementById("closeModal");
const cancelBtn = document.getElementById("cancelBtn");
const form = document.getElementById("eventForm");
const editingIdEl = document.getElementById("editingId");
const dogIdEl = document.getElementById("dogId");
const typeEl = document.getElementById("type");
const dateEl = document.getElementById("date");
const repeatEl = document.getElementById("repeatRule");
const noteEl = document.getElementById("note");

function openModal(editEvent = null) {
  modal.classList.remove("hidden");
  if (editEvent) {
    document.getElementById("modalTitle").textContent = "Редактировать событие";
    editingIdEl.value = editEvent.id;
    dogIdEl.value = editEvent.dogId;
    typeEl.value = editEvent.type;
    dateEl.value = editEvent.date;
    repeatEl.value = editEvent.repeatRule || (editEvent.repeatYearly ? "yearly" : "none");
    noteEl.value = editEvent.note || "";
  } else {
    document.getElementById("modalTitle").textContent = "Добавить событие";
    editingIdEl.value = "";
    dogIdEl.value = "bonny";
    typeEl.value = "food_order";
    dateEl.value = todayISO();
    repeatEl.value = "none";
    noteEl.value = "";
  }
}
function closeModal() {
  modal.classList.add("hidden");
}
function upsertEvent(e) {
  const idx = state.events.findIndex(x => x.id === e.id);
  if (idx >= 0) state.events[idx] = e;
  else state.events.push(e);
  saveEvents(state.events);
  render();
}

function removeEvent(id) {
  state.events = state.events.filter(e => e.id !== id);
  saveEvents(state.events);
  render();
}

function markDone(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  ev.doneAt = new Date().toISOString();

  // If repeat yearly: auto-create next year's event (not done)
  {
    const rule = ev.repeatRule || (ev.repeatYearly ? "yearly" : "none");
    const nextDate = nextByRule(ev.date, rule);
    if(nextDate){
      const next = {
        ...ev,
        id: uid(),
        date: nextDate,
        doneAt: null,
        repeatRule: rule,
      };
      state.events.push(next);
    }
  }

  saveEvents(state.events);
  render();
}
function undoDone(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  ev.doneAt = null;
  saveEvents(state.events);
  render();
}
function reschedule(id) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  const newDate = prompt("Новая дата (ГГГГ-ММ-ДД):", ev.date);
  if (!newDate) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    alert("Формат даты должен быть ГГГГ-ММ-ДД");
    return;
  }
  ev.date = newDate;
  saveEvents(state.events);
  render();
}
function addReminderICSForEvent(ev) {
  const title = eventTitle(ev);
  const ics = makeICS({
    title,
    dateISO: ev.date,
    note: ev.note || "",
    reminderDays: state.settings.defaultReminderDays,
    uidValue: `${ev.id}@dogcal.local`,
  });
  const fname = `${title} (${ev.date}).ics`.replace(/[\\/:*?"<>|]/g, "_");
  downloadText(fname, ics, "text/calendar");
}

function addReminderICSForBoth(dogId, type, dateISO, note, repeatYearly) {
  // used when dogId === both
  ["bonny", "nola"].forEach(did => {
    const temp = { id: uid(), dogId: did, type, date: dateISO, note, repeatYearly, doneAt: null };
    const title = eventTitle(temp);
    const ics = makeICS({
      title,
      dateISO,
      note: note || "",
      reminderDays: state.settings.defaultReminderDays,
      uidValue: `${temp.id}@dogcal.local`,
    });
    const fname = `${title} (${dateISO}).ics`.replace(/[\\/:*?"<>|]/g, "_");
    downloadText(fname, ics, "text/calendar");
  });
}

function filteredEvents() {
  let events = [...state.events];

  if (state.dogFilter !== "all") {
    events = events.filter(e => e.dogId === state.dogFilter);
  }

  // classify
  const t = todayISO();
  if (state.tab === "upcoming") {
    events = events.filter(e => !e.doneAt);
    events = events.filter(e => daysDiff(t, e.date) >= 0);
    events.sort((a, b) => parseISODate(a.date) - parseISODate(b.date));
  } else if (state.tab === "overdue") {
    events = events.filter(e => !e.doneAt);
    events = events.filter(e => daysDiff(t, e.date) < 0);
    events.sort((a, b) => parseISODate(a.date) - parseISODate(b.date));
  } else if (state.tab === "history") {
    events = events.filter(e => !!e.doneAt);
    events.sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt));
  }

  return events;
}

function emptyStateText() {
  if (state.tab === "upcoming") return "Нет ближайших событий. Добавь новое 👇";
  if (state.tab === "overdue") return "Просроченных событий нет 🎉";
  return "История пока пустая.";
}

function render() {
  const events = filteredEvents();
  listEl.innerHTML = "";

  if (!events.length) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<div class="cardTitle">${emptyStateText()}</div>
                     <div class="cardMeta">Подсказка: нажми “+ Добавить”.</div>`;
    listEl.appendChild(div);
    return;
  }

  
  // Group by month (Январь 2026 -> tasks...)
  let currentMonthKey = null;
  events.forEach(ev => {
    const monthKey = ev.date.slice(0,7); // YYYY-MM
    if(monthKey !== currentMonthKey){
      currentMonthKey = monthKey;
      const [y,m] = monthKey.split("-");
      const monthName = new Date(Number(y), Number(m)-1, 1).toLocaleString("ru-RU", { month:"long" });
      const hdr = document.createElement("div");
      hdr.className = "monthHeader";
      hdr.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1) + " " + y;
      listEl.appendChild(hdr);
    }

    const badge = statusBadge(ev, state.settings);
    const card = document.createElement("div");
    card.className = "card";
    const meta = [
      `<div>${formatDate(ev.date)}</div>`,
      repeatLabel(ev.repeatRule || (ev.repeatYearly ? "yearly" : "none")) ? `<div>Повтор: ${repeatLabel(ev.repeatRule || (ev.repeatYearly ? "yearly" : "none"))}</div>` : "",
      ev.note ? `<div>Комментарий: ${escapeHtml(ev.note)}</div>` : "",
      state.tab === "history" && ev.doneAt ? `<div>Выполнено: ${new Date(ev.doneAt).toLocaleString("ru-RU")}</div>` : "",
    ].filter(Boolean).join("");

    card.innerHTML = 
      `
      <div class="row1">
        <div>
          <div class="cardTitle">${escapeHtml(eventTitle(ev))}</div>
          <div class="cardMeta">${meta}</div>
        </div>
        <div class="badge ${badge.cls}">${badge.text}</div>
      </div>
      <div class="btnRow">
        ${state.tab !== "history" ? `<button class="btn primary" data-action="done" data-id="${ev.id}">Сделано</button>` : `<button class="btn primary" data-action="undo" data-id="${ev.id}">Снять отметку</button>`}
        ${state.tab !== "history" ? `<button class="btn" data-action="move" data-id="${ev.id}">Перенести</button>` : ""}
        <button class="btn" data-action="ics" data-id="${ev.id}">Добавить напоминание</button>
        <button class="btn" data-action="edit" data-id="${ev.id}">Редактировать</button>
        <button class="btn danger" data-action="del" data-id="${ev.id}">Удалить</button>
      </div>
    `;
    listEl.appendChild(card);
  });
;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// Events
dogFilterEl.addEventListener("change", () => {
  state.dogFilter = dogFilterEl.value;
  render();
});

tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    tabs.forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    state.tab = btn.dataset.tab;
    render();
  });
});

addBtn.addEventListener("click", () => openModal(null));
closeModalBtn.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);

// close modal on backdrop click
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const editingId = editingIdEl.value.trim();
  const dogId = dogIdEl.value;
  const type = typeEl.value;
  const date = dateEl.value;
  const repeatYearly = repeatEl.checked;
  const note = noteEl.value;

  if (!date) {
    alert("Укажи дату");
    return;
  }

  if (dogId === "both") {
    // create two events (bonny and nola)
    const e1 = { id: uid(), dogId: "bonny", type, date, repeatYearly, note, doneAt: null };
    const e2 = { id: uid(), dogId: "nola", type, date, repeatYearly, note, doneAt: null };
    state.events.push(e1, e2);
    saveEvents(state.events);

    // also offer .ics downloads immediately (optional comfort)
    // comment out if you don't want auto-download
    // addReminderICSForEvent(e1); addReminderICSForEvent(e2);
  } else {
    if (editingId) {
      const old = state.events.find(x => x.id === editingId);
      if (!old) return;
      old.dogId = dogId;
      old.type = type;
      old.date = date;
      old.repeatYearly = repeatYearly;
      old.note = note;
    } else {
      const ev = { id: uid(), dogId, type, date, repeatYearly, note, doneAt: null };
      state.events.push(ev);
    }
    saveEvents(state.events);
  }

  closeModal();
  render();
});

listEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "done") return markDone(id);
  if (action === "undo") return undoDone(id);
  if (action === "move") return reschedule(id);
  if (action === "delete") {
    if (confirm("Удалить событие?")) removeEvent(id);
    return;
  }
  if (action === "edit") {
    const ev = state.events.find(x => x.id === id);
    if (ev) openModal(ev);
    return;
  }
  if (action === "ics") {
    const ev = state.events.find(x => x.id === id);
    if (ev) addReminderICSForEvent(ev);
    return;
  }
});

// Init
(function init() {
  // set defaults
  if (!state.events || !Array.isArray(state.events)) state.events = [];
  // auto-suggest initial date in modal
  dateEl.value = todayISO();

  registerSW();
  render();
})();
