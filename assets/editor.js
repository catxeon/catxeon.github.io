"use strict";
// Редактор коллекции. Всё состояние -- в data/cards.json на диске;
// браузер держит копию и после каждой правки отправляет её обратно на сервер.

const SIDES = ["front", "back"];
const SIDE_RU = { front: "Лицевая сторона", back: "Оборот" };
const PREVIEW_W = 1400;

let db = { version: 1, cards: [] };
let allScans = [];
let idx = 0;
let activeSide = "front";
let saveTimer = null;
let pending = null; // куда положить скан, выбранный в модалке

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const card = () => db.cards[idx];

/* ---------------------------------------------------------------- загрузка */

async function boot() {
  db = await (await fetch("/api/cards")).json();
  allScans = await (await fetch("/api/scans")).json();
  if (!db.cards.length) {
    $("#work").append(el("p", "muted", "В базе нет карт. Запусти: python tools/ingest.py"));
    return;
  }
  bindGlobal();
  renderAll();
}

function renderAll() {
  renderList();
  renderSides();
  renderForm();
  renderProgress();
}

/* -------------------------------------------------------------- сохранение */

function touch() {
  $("#saved").textContent = "не сохранено";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

async function save() {
  clearTimeout(saveTimer);
  try {
    const r = await fetch("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(db),
    });
    const j = await r.json();
    $("#saved").textContent = j.ok
      ? "сохранено " + new Date().toLocaleTimeString("ru-RU")
      : "ошибка: " + j.error;
  } catch (e) {
    $("#saved").textContent = "ошибка сохранения: " + e.message;
  }
}

/* ------------------------------------------------------------------ список */

function usedFiles() {
  const s = new Set();
  db.cards.forEach((c) => SIDES.forEach((k) => c[k].file && s.add(c[k].file)));
  return s;
}

// "маски проверены" -- у каждой имеющейся стороны есть маски
// или явная отметка «маскировать нечего»
function maskState(c) {
  const ok = SIDES.every((k) => !c[k].file || c[k].masks.length || c[k].nomask);
  return ok ? "masked" : "";
}

function matches(c, q, f) {
  if (f === "todo" && c.status === "done") return false;
  if (f === "done" && c.status !== "done") return false;
  if (f === "nomasks" && maskState(c)) return false;
  if (f === "single" && c.front.file && c.back.file) return false;
  if (!q) return true;
  const hay = [c.bank, c.title, c.notes, c.network, c.type, c.country,
    (c.tags || []).join(" "), c.front.file, c.back.file].join(" ").toLowerCase();
  return hay.includes(q);
}

function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const f = $("#filter").value;
  const ol = $("#cards");
  ol.textContent = "";
  db.cards.forEach((c, i) => {
    if (!matches(c, q, f)) return;
    const li = el("li");
    if (i === idx) li.className = "sel";
    const side = c.front.file ? c.front : c.back;
    if (side.file) {
      const im = el("img");
      im.loading = "lazy";
      im.src = "/preview/" + encodeURIComponent(side.file) + "?w=220&r=" + (side.rotate || 0);
      li.append(im);
    } else {
      li.append(el("div", "dot"));
    }
    const t = el("div", "t");
    t.append(el("b", null, c.bank || c.title || c.id));
    t.append(el("span", null, [c.network, c.type].filter(Boolean).join(" · ") ||
      (c.back.file ? "" : "только лицо")));
    li.append(t);
    const state = c.status === "done" ? "done" : maskState(c);
    const d = el("div", "dot " + state);
    d.title = state === "done" ? "готово"
      : state === "masked" ? "маски проверены" : "маски не расставлены";
    li.append(d);
    li.onclick = () => { idx = i; renderAll(); };
    ol.append(li);
  });
}

function renderProgress() {
  const done = db.cards.filter((c) => c.status === "done").length;
  $("#progress").textContent = done + " / " + db.cards.length + " готово";
}

/* ------------------------------------------------------------- две стороны */

function renderSides() {
  const box = $("#sides");
  box.textContent = "";
  const c = card();
  SIDES.forEach((k) => box.append(sideBlock(c, k)));
}

function sideBlock(c, k) {
  const side = c[k];
  const wrap = el("div", "side");
  wrap.onmousedown = () => { activeSide = k; };

  const head = el("div", "sidehead");
  head.append(el("b", null, SIDE_RU[k]));
  head.append(el("span", "file", side.file || "—"));
  head.append(el("span", "grow"));

  if (side.file) {
    const rot = el("button", null, "⟳");
    rot.title = "Повернуть на 90°";
    rot.onclick = () => rotate(k);
    head.append(rot);

    const swap = el("button", null, "⇄");
    swap.title = "Поменять стороны местами";
    swap.onclick = () => {
      const t = c.front; c.front = c.back; c.back = t;
      touch(); renderAll();
    };
    head.append(swap);

    const off = el("button", null, "открепить");
    off.title = "Вернуть скан в список свободных";
    off.onclick = () => {
      c[k] = { file: null, rotate: 0, masks: [], nomask: false };
      touch(); renderAll();
    };
    head.append(off);
  } else {
    const pick = el("button", null, "выбрать скан");
    pick.onclick = () => openPicker(k);
    head.append(pick);
  }
  wrap.append(head);

  if (!side.file) {
    wrap.append(el("div", "empty", "сторона не отсканирована"));
    return wrap;
  }

  const canvas = el("div", "canvas");
  const img = el("img");
  img.src = "/preview/" + encodeURIComponent(side.file) + "?w=" + PREVIEW_W + "&r=" + (side.rotate || 0);
  img.draggable = false;
  canvas.append(img);
  side.masks.forEach((m, mi) => canvas.append(maskEl(side, m, mi)));
  drawable(canvas, side);
  wrap.append(canvas);

  const foot = el("div", "sidehead");
  foot.style.marginTop = "8px";
  const lab = el("label", "chk");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = !!side.nomask;
  cb.onchange = () => { side.nomask = cb.checked; touch(); renderList(); };
  lab.append(cb, document.createTextNode("маскировать нечего"));
  foot.append(lab);
  foot.append(el("span", "grow"));
  if (side.masks.length) {
    const cl = el("button", null, "очистить маски (" + side.masks.length + ")");
    cl.onclick = () => { side.masks = []; touch(); renderSides(); renderList(); };
    foot.append(cl);
  } else if (!side.nomask) {
    foot.append(el("span", "warn", "не опубликуется без масок"));
  }
  const cp = el("button", null, "маски как у предыдущей");
  cp.title = "Скопировать маски этой же стороны с предыдущей карты";
  cp.onclick = () => copyMasks(k);
  foot.append(cp);
  wrap.append(foot);
  return wrap;
}

function maskEl(side, m, mi) {
  const d = el("div", "mask");
  d.style.left = m[0] * 100 + "%";
  d.style.top = m[1] * 100 + "%";
  d.style.width = m[2] * 100 + "%";
  d.style.height = m[3] * 100 + "%";
  d.title = "Клик — удалить маску";
  d.onmousedown = (e) => e.stopPropagation();
  d.onclick = (e) => {
    e.stopPropagation();
    side.masks.splice(mi, 1);
    touch();
    renderSides();
    renderList();
  };
  return d;
}

function drawable(canvas, side) {
  canvas.onmousedown = (e) => {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    const x0 = (e.clientX - r.left) / r.width;
    const y0 = (e.clientY - r.top) / r.height;
    const draft = el("div", "draft");
    canvas.append(draft);
    let rect = null;
    const move = (ev) => {
      const x1 = (ev.clientX - r.left) / r.width;
      const y1 = (ev.clientY - r.top) / r.height;
      const x = Math.max(0, Math.min(x0, x1));
      const y = Math.max(0, Math.min(y0, y1));
      const w = Math.min(1, Math.max(x0, x1)) - x;
      const h = Math.min(1, Math.max(y0, y1)) - y;
      rect = [x, y, w, h];
      draft.style.left = x * 100 + "%";
      draft.style.top = y * 100 + "%";
      draft.style.width = w * 100 + "%";
      draft.style.height = h * 100 + "%";
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      draft.remove();
      if (rect && rect[2] > 0.012 && rect[3] > 0.012) {
        side.masks.push(rect.map((v) => Math.round(v * 1e4) / 1e4));
        touch();
        renderSides();
        renderList();
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
}

// Поворот по часовой на 90°: точка (x,y) уходит в (1-y-h, x), ширина и высота меняются местами.
function rotate(k) {
  const side = card()[k];
  if (!side.file) return;
  side.rotate = ((side.rotate || 0) + 90) % 360;
  side.masks = side.masks.map((m) => [
    Math.round((1 - m[1] - m[3]) * 1e4) / 1e4,
    Math.round(m[0] * 1e4) / 1e4,
    m[3],
    m[2],
  ]);
  touch();
  renderSides();
  renderList();
}

function copyMasks(k) {
  const prev = db.cards[idx - 1];
  if (!prev || !prev[k].masks.length) return;
  card()[k].masks = prev[k].masks.map((m) => m.slice());
  touch();
  renderSides();
  renderList();
}

/* ------------------------------------------------------------------- форма */

const FIELDS = { bank: "bank", country: "country", network: "network", type: "type", title: "title" };

function renderForm() {
  const c = card();
  for (const id of Object.keys(FIELDS)) $("#f-" + id).value = c[FIELDS[id]] || "";
  $("#f-tags").value = (c.tags || []).join(", ");
  $("#f-notes").value = c.notes || "";
  $("#doneBtn").textContent = c.status === "done" ? "Снять «готово»" : "Готово";
  fillDatalist("#banks", "bank");
  fillDatalist("#countries", "country");
}

function fillDatalist(sel, key) {
  const values = [...new Set(db.cards.map((c) => c[key]).filter(Boolean))].sort();
  const dl = $(sel);
  dl.textContent = "";
  values.forEach((v) => { const o = el("option"); o.value = v; dl.append(o); });
}

function bindForm() {
  for (const id of Object.keys(FIELDS)) {
    const key = FIELDS[id];
    $("#f-" + id).oninput = () => {
      card()[key] = $("#f-" + id).value;
      touch();
      renderList();
    };
  }
  $("#f-tags").oninput = () => {
    card().tags = $("#f-tags").value.split(",").map((s) => s.trim()).filter(Boolean);
    touch();
  };
  $("#f-notes").oninput = () => { card().notes = $("#f-notes").value; touch(); };
  $("#copyPrev").onclick = () => {
    const prev = db.cards[idx - 1];
    if (!prev) return;
    ["bank", "country", "network", "type"].forEach((k) => { card()[k] = prev[k]; });
    touch();
    renderForm();
    renderList();
  };
  $("#doneBtn").onclick = toggleDone;
}

function toggleDone() {
  const c = card();
  c.status = c.status === "done" ? "todo" : "done";
  touch();
  renderForm();
  renderList();
  renderProgress();
  if (c.status === "done") move(1);
}

function move(step) {
  const n = db.cards.length;
  idx = (idx + step + n) % n;
  renderAll();
  const sel = $("#cards li.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

/* ----------------------------------------------------------------- модалка */

function openPicker(k) {
  pending = k;
  const used = usedFiles();
  const free = allScans.filter((f) => !used.has(f));
  const list = $("#pickList");
  list.textContent = "";
  if (!free.length) list.append(el("p", "muted", "Свободных сканов нет."));
  free.forEach((f) => {
    const fig = el("figure");
    const im = el("img");
    im.loading = "lazy";
    im.src = "/preview/" + encodeURIComponent(f) + "?w=300";
    fig.append(im, el("figcaption", null, f));
    fig.onclick = () => {
      card()[pending] = { file: f, rotate: 0, masks: [], nomask: false };
      $("#picker").hidden = true;
      touch();
      renderAll();
    };
    list.append(fig);
  });
  $("#picker").hidden = false;
}

/* -------------------------------------------------------------- клавиатура */

function bindGlobal() {
  bindForm();
  $("#search").oninput = renderList;
  $("#filter").onchange = renderList;
  $("#pickClose").onclick = () => { $("#picker").hidden = true; };
  $("#addCard").onclick = () => {
    const n = db.cards.length + 1;
    db.cards.push({
      id: "c" + String(n).padStart(3, "0"),
      front: { file: null, rotate: 0, masks: [], nomask: false },
      back: { file: null, rotate: 0, masks: [], nomask: false },
      bank: "", country: "RU", network: "", type: "", title: "",
      notes: "", tags: [], status: "todo",
    });
    idx = db.cards.length - 1;
    touch();
    renderAll();
  };
  $("#buildBtn").onclick = async () => {
    await save();
    const b = $("#buildBtn");
    b.disabled = true;
    b.textContent = "Собираю…";
    const r = await fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json();
    b.disabled = false;
    b.textContent = "Собрать сайт";
    alert(j.out || "готово");
  };

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (inField || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    else if (k === "d") { e.preventDefault(); toggleDone(); }
    else if (k === "r") { e.preventDefault(); rotate(activeSide); }
    else if (e.key === "Escape") { $("#picker").hidden = true; }
  });

  window.addEventListener("beforeunload", (e) => {
    if ($("#saved").textContent === "не сохранено") { e.preventDefault(); e.returnValue = ""; }
  });
}

boot();
