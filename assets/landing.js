"use strict";
// Лендинг: подставляет реальное число карт, раскладывает веер случайных
// сканов из коллекции и собирает адрес почты в рантайме.

// Адрес не лежит в HTML целиком, чтобы его не выгребли спам-боты со страницы.
const MAIL = ["petya", "petya.cc"];

function mail() {
  const a = document.getElementById("mail");
  const addr = MAIL[0] + String.fromCharCode(64) + MAIL[1];
  document.getElementById("mailaddr").textContent = addr;
  a.href = "mailto:" + addr;
}

function fan(cards) {
  const box = document.getElementById("fan");
  const wide = window.matchMedia("(min-width: 900px)").matches;
  const n = wide ? 7 : 5;

  // берём только лицевые стороны — веер из оборотов выглядит уныло
  const pool = cards.filter((c) => c.front && c.front.thumb);
  if (pool.length < n) return;

  const pick = [];
  const used = new Set();
  while (pick.length < n) {
    const i = Math.floor(Math.random() * pool.length);
    if (used.has(i)) continue;
    used.add(i);
    pick.push(pool[i]);
  }

  const mid = (n - 1) / 2;
  pick.forEach((c, i) => {
    const off = i - mid;
    const im = new Image();
    im.src = c.front.thumb;
    im.alt = "";
    im.style.transform =
      "translateX(-50%) translateX(" + off * (wide ? 168 : 96) + "px)" +
      " translateY(" + Math.abs(off) * 13 + "px)" +
      " rotate(" + off * 6 + "deg)";
    im.style.zIndex = String(10 - Math.abs(off));
    im.style.animationDelay = (0.05 * Math.abs(off)) + "s";
    box.append(im);
  });
}

async function boot() {
  mail();
  try {
    const data = await (await fetch("data/site.json", { cache: "no-cache" })).json();
    const cards = data.cards || [];
    if (cards.length) document.getElementById("count").textContent = cards.length;
    fan(cards);
  } catch (e) {
    // без site.json лендинг просто остаётся без веера — это нормально
  }
}

boot();
