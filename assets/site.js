"use strict";
// Публичная галерея. Читает data/site.json, который собирает tools/build.py.

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

let cards = [];
let view = [];        // отфильтрованный и отсортированный список
let activeTags = new Set();

const FILTERS = ["bank", "network", "type", "country"];
const LABELS = {
  bank: "Банк", country: "Страна", network: "Платёжная система",
  type: "Тип", title: "Название", tags: "Теги",
};

async function boot() {
  let data;
  try {
    data = await (await fetch("data/site.json", { cache: "no-cache" })).json();
  } catch (e) {
    $("#grid").append(el("p", "muted", "Не удалось загрузить data/site.json"));
    return;
  }
  cards = data.cards || [];
  $("#generated").textContent = data.generated
    ? "Обновлено: " + new Date(data.generated).toLocaleString("ru-RU")
    : "";
  if (!cards.length) {
    $("#count").textContent = "Пока не опубликовано ни одной карты.";
    return;
  }
  fillFilters();
  fillTags();
  bind();
  apply();
  if (location.hash) openCard(location.hash.slice(1));
}

function fillFilters() {
  FILTERS.forEach((k) => {
    const sel = $("#f-" + k);
    [...new Set(cards.map((c) => c[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"))
      .forEach((v) => { const o = el("option", null, v); o.value = v; sel.append(o); });
  });
}

function fillTags() {
  const counts = new Map();
  cards.forEach((c) => (c.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const box = $("#tags");
  [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    const b = el("button", "tag", t + " · " + n);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => {
      if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
      b.setAttribute("aria-pressed", String(activeTags.has(t)));
      apply();
    };
    box.append(b);
  });
}

function bind() {
  $("#q").oninput = apply;
  FILTERS.forEach((k) => { $("#f-" + k).onchange = apply; });
  $("#sort").onchange = apply;
  $("#reset").onclick = () => {
    $("#q").value = "";
    FILTERS.forEach((k) => { $("#f-" + k).value = ""; });
    activeTags.clear();
    document.querySelectorAll(".tag").forEach((b) => b.setAttribute("aria-pressed", "false"));
    apply();
  };
  $(".close").onclick = () => $("#detail").close();
  $("#detail").addEventListener("close", () => {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  });
  $("#d-prev").onclick = () => step(-1);
  $("#d-next").onclick = () => step(1);
  document.addEventListener("keydown", (e) => {
    if (!$("#detail").open) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
}

function apply() {
  const q = $("#q").value.trim().toLowerCase();
  const want = {};
  FILTERS.forEach((k) => { want[k] = $("#f-" + k).value; });

  view = cards.filter((c) => {
    for (const k of FILTERS) if (want[k] && c[k] !== want[k]) return false;
    for (const t of activeTags) if (!(c.tags || []).includes(t)) return false;
    if (!q) return true;
    const hay = [c.bank, c.title, c.notes, c.network, c.type, c.country,
      (c.tags || []).join(" ")].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  const key = $("#sort").value;
  view.sort((a, b) => key === "id"
    ? a.id.localeCompare(b.id)
    : (a[key] || "яя").localeCompare(b[key] || "яя", "ru") || a.id.localeCompare(b.id));

  render();
}

function render() {
  const grid = $("#grid");
  grid.textContent = "";
  view.forEach((c) => {
    const b = el("button", "item");
    b.type = "button";
    const shot = c.front || c.back;
    const im = el("img");
    im.loading = "lazy";
    im.src = shot ? shot.thumb : "";
    im.alt = [c.bank, c.title].filter(Boolean).join(" — ") || c.id;
    b.append(im);
    const cap = el("div", "cap");
    cap.append(el("b", null, c.bank || c.title || c.id));
    cap.append(el("span", null, [c.title, c.network].filter(Boolean).join(" · ")));
    b.append(cap);
    b.onclick = () => openCard(c.id);
    grid.append(b);
  });
  $("#count").textContent = view.length === cards.length
    ? "Карт в коллекции: " + cards.length
    : "Показано " + view.length + " из " + cards.length;
  $("#none").hidden = view.length > 0;
}

function openCard(id) {
  const c = cards.find((x) => x.id === id);
  if (!c) return;

  $("#d-title").textContent = [c.bank, c.title].filter(Boolean).join(" — ") || c.id;

  const shots = $("#d-shots");
  shots.textContent = "";
  [["front", "Лицевая сторона"], ["back", "Оборот"]].forEach(([k, label]) => {
    if (!c[k]) return;
    const fig = el("figure");
    const a = el("a");
    a.href = c[k].img;
    a.target = "_blank";
    a.rel = "noopener";
    const im = el("img");
    im.src = c[k].img;
    im.alt = label;
    im.width = c[k].w;
    im.height = c[k].h;
    a.append(im);
    fig.append(a, el("figcaption", null, label + " — открыть в полном размере"));
    shots.append(fig);
  });
  if (!c.back) shots.append(el("p", "muted", "Оборот не отсканирован."));

  const dl = $("#d-meta");
  dl.textContent = "";
  ["bank", "country", "network", "type", "title"].forEach((k) => {
    if (!c[k]) return;
    dl.append(el("dt", null, LABELS[k]), el("dd", null, c[k]));
  });
  if ((c.tags || []).length) dl.append(el("dt", null, LABELS.tags), el("dd", null, c.tags.join(", ")));
  $("#d-notes").textContent = c.notes || "";

  history.replaceState(null, "", "#" + c.id);
  if (!$("#detail").open) $("#detail").showModal();
}

// Листание внутри текущей выборки. Если карта открыта по прямой ссылке и
// отфильтрована, листать некуда -- ничего не делаем.
function step(d) {
  const i = view.findIndex((c) => c.id === location.hash.slice(1));
  if (i < 0) return;
  openCard(view[(i + d + view.length) % view.length].id);
}

boot();
