"use strict";

const SOURCE_LABELS = {
  arxiv: "arXiv",
  hf_papers: "Hugging Face",
  github: "GitHub",
  hn: "Hacker News",
  reddit: "Reddit",
  pwc: "Papers With Code",
};
const SOURCE_COLORS = {
  arxiv: "#b31b1b",
  hf_papers: "#ffcc4d",
  github: "#c9d1e0",
  hn: "#ff6600",
  reddit: "#ff4500",
  pwc: "#21cbce",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const state = {
  data: null,
  items: [],        // flat list, each with .date
  weeks: [],        // [{ key, monday, days:[digest], itemCount }] newest first
  weekIndex: 0,
  view: "digest",   // "digest" | "overview"
  search: "",
  sources: new Set(),
  tags: new Set(),
  minTopic: 0,
};

const charts = {};
let chartsBuilt = false;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const app = document.getElementById("app");
  try {
    const res = await fetch("./data/digests.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
  } catch (err) {
    app.dataset.state = "error";
    document.getElementById("loading").textContent =
      "Could not load digest data (" + err.message + ").";
    return;
  }

  state.items = flatten(state.data);
  state.weeks = buildWeeks(state.data.digests || []);
  renderUpdated();
  renderStats();
  buildFilters();
  renderArchive();
  bindEvents();
  render();
  app.dataset.state = "ready";
}

function flatten(data) {
  const out = [];
  for (const day of data.digests || []) {
    for (const it of day.items || []) out.push(Object.assign({ date: day.date }, it));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Week bucketing (ISO, Monday-based)                                  */
/* ------------------------------------------------------------------ */
function isoMonday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmtISO(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function buildWeeks(digests) {
  const map = new Map();
  for (const day of digests) {
    const monday = isoMonday(day.date);
    const key = fmtISO(monday);
    if (!map.has(key)) map.set(key, { key, monday, days: [], itemCount: 0 });
    const w = map.get(key);
    w.days.push(day);
    w.itemCount += day.items.length;
  }
  const weeks = Array.from(map.values());
  weeks.sort((a, b) => (a.key < b.key ? 1 : -1));
  weeks.forEach((w) => w.days.sort((a, b) => (a.date < b.date ? 1 : -1)));
  return weeks;
}

function weekLabel(monday) {
  const sun = addDays(monday, 6);
  const y = sun.getFullYear();
  if (monday.getMonth() === sun.getMonth()) {
    return `${MONTHS[monday.getMonth()]} ${monday.getDate()} &ndash; ${sun.getDate()}, ${y}`;
  }
  return `${MONTHS[monday.getMonth()]} ${monday.getDate()} &ndash; ${MONTHS[sun.getMonth()]} ${sun.getDate()}, ${y}`;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */
function renderUpdated() {
  const el = document.getElementById("updated");
  if (!state.data.generated_at) return;
  const d = new Date(state.data.generated_at);
  el.textContent = "updated " + d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function renderStats() {
  const days = state.data.digest_count || 0;
  const items = state.data.item_count || state.items.length;
  const tags = new Set();
  state.items.forEach((i) => (i.tags || []).forEach((t) => tags.add(t)));
  const cards = [
    { num: state.weeks.length, label: "Weeks" },
    { num: days, label: "Days tracked" },
    { num: items, label: "Total items" },
    { num: days ? (items / days).toFixed(1) : "0", label: "Avg / day" },
    { num: tags.size, label: "Unique topics" },
  ];
  document.getElementById("stats").innerHTML = cards
    .map((c) => `<div class="stat"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>`)
    .join("");
}

/* ------------------------------------------------------------------ */
/* Filters + archive                                                   */
/* ------------------------------------------------------------------ */
function tagCounts() {
  const counts = {};
  state.items.forEach((i) => (i.tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  return counts;
}

function buildFilters() {
  const srcCount = {};
  state.items.forEach((i) => (srcCount[i.source] = (srcCount[i.source] || 0) + 1));
  document.getElementById("sourceFilters").innerHTML = Object.keys(srcCount)
    .sort((a, b) => srcCount[b] - srcCount[a])
    .map((s) => `<span class="pill" data-source="${s}">${SOURCE_LABELS[s] || s} <span>${srcCount[s]}</span></span>`)
    .join("");

  const counts = tagCounts();
  document.getElementById("tagFilters").innerHTML = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .map((t) => `<span class="pill" data-tag="${t}">#${t} <span>${counts[t]}</span></span>`)
    .join("");
}

function renderArchive() {
  const groups = [];
  let cur = null;
  for (const w of state.weeks) {
    const label = `${MONTHS_LONG[w.monday.getMonth()]} ${w.monday.getFullYear()}`;
    if (!cur || cur.label !== label) { cur = { label, weeks: [] }; groups.push(cur); }
    cur.weeks.push(w);
  }
  const html = groups.map((g) => `
    <div class="arch-month">
      <div class="arch-month-label">${g.label}</div>
      ${g.weeks.map((w) => `<button class="arch-week" data-week="${w.key}">
        <span>${weekLabel(w.monday)}</span><span class="n">${w.itemCount}</span>
      </button>`).join("")}
    </div>`).join("");
  document.getElementById("archiveList").innerHTML = html;
}

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.view = btn.dataset.view;
      render();
    });
  });

  document.getElementById("prevWeek").addEventListener("click", () => {
    if (state.weekIndex < state.weeks.length - 1) { state.weekIndex++; render(); scrollTop(); }
  });
  document.getElementById("nextWeek").addEventListener("click", () => {
    if (state.weekIndex > 0) { state.weekIndex--; render(); scrollTop(); }
  });

  document.getElementById("archiveList").addEventListener("click", (e) => {
    const btn = e.target.closest(".arch-week");
    if (!btn) return;
    const idx = state.weeks.findIndex((w) => w.key === btn.dataset.week);
    if (idx < 0) return;
    state.weekIndex = idx;
    clearFiltersSilently();
    setView("digest");
    render();
    scrollTop();
  });

  const search = document.getElementById("search");
  search.addEventListener("input", () => { state.search = search.value.trim().toLowerCase(); render(); });

  const minTopic = document.getElementById("minTopic");
  minTopic.addEventListener("input", () => {
    state.minTopic = Number(minTopic.value);
    document.getElementById("minTopicVal").textContent = minTopic.value;
    render();
  });

  document.getElementById("sourceFilters").addEventListener("click", (e) => {
    const pill = e.target.closest(".pill"); if (!pill) return;
    toggleSet(state.sources, pill.dataset.source, pill); render();
  });
  document.getElementById("tagFilters").addEventListener("click", (e) => {
    const pill = e.target.closest(".pill"); if (!pill) return;
    toggleSet(state.tags, pill.dataset.tag, pill); render();
  });

  document.getElementById("clearFilters").addEventListener("click", () => { clearFiltersSilently(); render(); });

  document.getElementById("feed").addEventListener("click", (e) => {
    const tagEl = e.target.closest(".tag");
    if (tagEl) { selectTag(tagEl.dataset.tag); return; }
    const more = e.target.closest(".more-btn");
    if (more) {
      const sum = more.previousElementSibling;
      sum.classList.toggle("clamp");
      more.textContent = sum.classList.contains("clamp") ? "Show more" : "Show less";
    }
  });
}

function scrollTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }
function setView(v) {
  state.view = v;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
}
function toggleSet(set, val, pill) {
  if (set.has(val)) { set.delete(val); pill.classList.remove("active"); }
  else { set.add(val); pill.classList.add("active"); }
}
function selectTag(t) {
  if (!state.tags.has(t)) {
    state.tags.add(t);
    document.querySelectorAll('#tagFilters .pill').forEach((p) => { if (p.dataset.tag === t) p.classList.add("active"); });
  }
  render();
  document.querySelector(".sidebar").scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearFiltersSilently() {
  state.search = ""; state.sources.clear(); state.tags.clear(); state.minTopic = 0;
  document.getElementById("search").value = "";
  document.getElementById("minTopic").value = 0;
  document.getElementById("minTopicVal").textContent = "0";
  document.querySelectorAll(".pill.active").forEach((p) => p.classList.remove("active"));
}
function filterActive() {
  return !!(state.search || state.sources.size || state.tags.size || state.minTopic > 0);
}

/* ------------------------------------------------------------------ */
/* Filtering + rendering                                               */
/* ------------------------------------------------------------------ */
function matches(it) {
  if (state.sources.size && !state.sources.has(it.source)) return false;
  if (state.minTopic && (it.topic || 0) < state.minTopic) return false;
  if (state.tags.size) {
    const its = new Set(it.tags || []);
    let ok = false;
    for (const t of state.tags) if (its.has(t)) { ok = true; break; }
    if (!ok) return false;
  }
  if (state.search) {
    const hay = (it.title + " " + it.summary + " " + it.details + " " +
      (it.tags || []).join(" ") + " " + it.judge).toLowerCase();
    if (!hay.includes(state.search)) return false;
  }
  return true;
}

function render() {
  const overview = document.getElementById("overviewPanel");
  const weekNav = document.getElementById("weekNav");
  const feed = document.getElementById("feed");
  const empty = document.getElementById("empty");
  const banner = document.getElementById("filterBanner");
  const clearBtn = document.getElementById("clearFilters");
  const active = filterActive();

  clearBtn.hidden = !active;

  // Overview mode: charts only.
  if (state.view === "overview") {
    overview.hidden = false;
    weekNav.hidden = true;
    banner.hidden = true;
    feed.innerHTML = "";
    empty.hidden = true;
    buildChartsOnce();
    return;
  }
  overview.hidden = true;

  // Filtered results: flat, grouped by date across all weeks.
  if (active) {
    weekNav.hidden = true;
    const results = state.items.filter(matches);
    banner.hidden = false;
    banner.innerHTML = `Showing <b>${results.length}</b> ${results.length === 1 ? "item" : "items"} across all weeks matching your filters.`;
    if (!results.length) { feed.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    feed.innerHTML = renderGroupedByDate(results);
    return;
  }

  // Default: one week at a time (blog style).
  banner.hidden = true;
  empty.hidden = true;
  if (!state.weeks.length) { weekNav.hidden = true; feed.innerHTML = ""; empty.hidden = false; return; }
  weekNav.hidden = false;

  const week = state.weeks[state.weekIndex];
  document.getElementById("weekLabel").innerHTML = weekLabel(week.monday);
  document.getElementById("weekCount").textContent =
    `${week.itemCount} items \u00b7 ${week.days.length} ${week.days.length === 1 ? "day" : "days"}`;
  document.getElementById("prevWeek").disabled = state.weekIndex >= state.weeks.length - 1;
  document.getElementById("nextWeek").disabled = state.weekIndex <= 0;

  document.querySelectorAll(".arch-week").forEach((b) => b.classList.toggle("active", b.dataset.week === week.key));

  feed.innerHTML = week.days.map((day) => postSection(day)).join("");
}

function postSection(day) {
  const items = day.items.slice().sort((a, b) => (b.topic || 0) - (a.topic || 0));
  return `<article class="post">
    <div class="post-head">
      <span class="post-date">${day.date}</span>
      <span class="post-weekday">${weekday(day.date)}</span>
      <span class="post-count">${items.length} items</span>
    </div>
    <div class="items">${items.map(itemCard).join("")}</div>
  </article>`;
}

function renderGroupedByDate(items) {
  const byDate = {};
  for (const it of items) (byDate[it.date] = byDate[it.date] || []).push(it);
  const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));
  return dates.map((date) => {
    const list = byDate[date].slice().sort((a, b) => (b.topic || 0) - (a.topic || 0));
    return `<article class="post">
      <div class="post-head">
        <span class="post-date">${date}</span>
        <span class="post-weekday">${weekday(date)}</span>
        <span class="post-count">${list.length} items</span>
      </div>
      <div class="items">${list.map(itemCard).join("")}</div>
    </article>`;
  }).join("");
}

function weekday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { weekday: "long" });
}
function scoreClass(v) {
  if (v == null) return "";
  if (v >= 8) return "s-good";
  if (v >= 6) return "s-mid";
  return "s-low";
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function itemCard(it) {
  const scores = [];
  if (it.topic != null) scores.push(`<span class="score-chip ${scoreClass(it.topic)}">T <b>${it.topic}</b></span>`);
  if (it.quality != null) scores.push(`<span class="score-chip ${scoreClass(it.quality)}">Q <b>${it.quality}</b></span>`);

  const tags = (it.tags || []).map((t) => `<span class="tag" data-tag="${esc(t)}">#${esc(t)}</span>`).join("");
  const links = (it.links || [])
    .filter((l) => l.url && l.url !== it.url)
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
    .join("");

  const summaryLong = (it.summary || "").length > 240;
  const moreBtn = summaryLong ? `<button class="more-btn" type="button">Show more</button>` : "";
  const summaryHtml = it.summary
    ? `<p class="item-summary${summaryLong ? " clamp" : ""}">${esc(it.summary)}</p>${moreBtn}`
    : "";

  return `<article class="item">
    <div class="item-top">
      <span class="badge-source src-${it.source}">${esc(SOURCE_LABELS[it.source] || it.source)}</span>
      <div class="scores">${scores.join("")}</div>
    </div>
    <h3 class="item-title"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
    ${it.details ? `<div class="item-details">${esc(it.details)}</div>` : ""}
    ${tags ? `<div class="item-tags">${tags}</div>` : ""}
    ${summaryHtml}
    ${it.judge ? `<div class="item-judge">${esc(it.judge)}</div>` : ""}
    ${links ? `<div class="item-links">${links}</div>` : ""}
  </article>`;
}

/* ------------------------------------------------------------------ */
/* Charts (lazy: built the first time Overview is opened)              */
/* ------------------------------------------------------------------ */
function buildChartsOnce() {
  if (chartsBuilt || typeof Chart === "undefined") return;
  chartsBuilt = true;
  Chart.defaults.color = "#8a95a8";
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.borderColor = "rgba(255,255,255,0.05)";
  renderDailyChart();
  renderSourceChart();
  renderTagChart();
}

function renderDailyChart() {
  const days = (state.data.digests || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const labels = days.map((d) => d.date.slice(5));
  const totals = days.map((d) => d.items.length);
  const ctx = document.getElementById("chartDaily");
  const grad = ctx.getContext("2d").createLinearGradient(0, 0, 0, 230);
  grad.addColorStop(0, "rgba(124,156,255,0.9)");
  grad.addColorStop(1, "rgba(185,139,255,0.4)");
  charts.daily = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: totals, backgroundColor: grad, borderRadius: 6, maxBarThickness: 34 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (t) => days[t[0].dataIndex].date } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { precision: 0 } },
      },
    },
  });
}

function renderSourceChart() {
  const counts = {};
  state.items.forEach((i) => (counts[i.source] = (counts[i.source] || 0) + 1));
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  charts.source = new Chart(document.getElementById("chartSource"), {
    type: "doughnut",
    data: {
      labels: keys.map((k) => SOURCE_LABELS[k] || k),
      datasets: [{
        data: keys.map((k) => counts[k]),
        backgroundColor: keys.map((k) => SOURCE_COLORS[k] || "#7c9cff"),
        borderColor: "#0b0e14", borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
    },
  });
}

function renderTagChart() {
  const counts = tagCounts();
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 15);
  charts.tags = new Chart(document.getElementById("chartTags"), {
    type: "bar",
    data: {
      labels: top.map((t) => "#" + t),
      datasets: [{ data: top.map((t) => counts[t]), backgroundColor: "rgba(185,139,255,0.7)", borderRadius: 5 }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { precision: 0 } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}
