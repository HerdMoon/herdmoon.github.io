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

const state = {
  data: null,
  items: [],            // flat list, each with .date
  search: "",
  sources: new Set(),   // empty = all
  tags: new Set(),      // empty = all
  minTopic: 0,
  sort: "date",
};

const charts = {};

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
  renderUpdated();
  renderStats();
  buildFilters();
  renderCharts();
  bindEvents();
  render();
  app.dataset.state = "ready";
}

function flatten(data) {
  const out = [];
  for (const day of data.digests || []) {
    for (const it of day.items || []) {
      out.push(Object.assign({ date: day.date }, it));
    }
  }
  return out;
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
  const sources = new Set(state.items.map((i) => i.source)).size;
  const tags = new Set();
  state.items.forEach((i) => (i.tags || []).forEach((t) => tags.add(t)));
  const avg = days ? (items / days).toFixed(1) : "0";

  const cards = [
    { num: days, label: "Days tracked" },
    { num: items, label: "Total items" },
    { num: avg, label: "Avg / day" },
    { num: sources, label: "Sources" },
    { num: tags.size, label: "Unique topics" },
  ];
  document.getElementById("stats").innerHTML = cards
    .map((c) => `<div class="stat"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>`)
    .join("");
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */
function tagCounts() {
  const counts = {};
  state.items.forEach((i) => (i.tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  return counts;
}

function buildFilters() {
  // Sources present in the data, ordered by frequency.
  const srcCount = {};
  state.items.forEach((i) => (srcCount[i.source] = (srcCount[i.source] || 0) + 1));
  const srcHtml = Object.keys(srcCount)
    .sort((a, b) => srcCount[b] - srcCount[a])
    .map((s) => `<span class="pill" data-source="${s}">${SOURCE_LABELS[s] || s} <span style="opacity:.6">${srcCount[s]}</span></span>`)
    .join("");
  document.getElementById("sourceFilters").innerHTML = srcHtml;

  const counts = tagCounts();
  const tagHtml = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .map((t) => `<span class="pill" data-tag="${t}">#${t} <span style="opacity:.6">${counts[t]}</span></span>`)
    .join("");
  document.getElementById("tagFilters").innerHTML = tagHtml;
}

function bindEvents() {
  const search = document.getElementById("search");
  search.addEventListener("input", () => {
    state.search = search.value.trim().toLowerCase();
    render();
  });

  document.getElementById("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });

  const minTopic = document.getElementById("minTopic");
  minTopic.addEventListener("input", () => {
    state.minTopic = Number(minTopic.value);
    document.getElementById("minTopicVal").textContent = minTopic.value;
    render();
  });

  document.getElementById("sourceFilters").addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    toggleSet(state.sources, pill.dataset.source, pill);
    render();
  });

  document.getElementById("tagFilters").addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    toggleSet(state.tags, pill.dataset.tag, pill);
    render();
  });

  document.getElementById("clearFilters").addEventListener("click", clearFilters);

  // Clicking a tag inside an item feeds the tag filter.
  document.getElementById("feed").addEventListener("click", (e) => {
    const tagEl = e.target.closest(".tag");
    if (tagEl) {
      const t = tagEl.dataset.tag;
      selectTag(t);
      return;
    }
    const more = e.target.closest(".more-btn");
    if (more) {
      const sum = more.previousElementSibling;
      sum.classList.toggle("clamp");
      more.textContent = sum.classList.contains("clamp") ? "Show more" : "Show less";
    }
  });
}

function toggleSet(set, val, pill) {
  if (set.has(val)) { set.delete(val); pill.classList.remove("active"); }
  else { set.add(val); pill.classList.add("active"); }
}

function selectTag(t) {
  state.tags.add(t);
  document.querySelectorAll('#tagFilters .pill').forEach((p) => {
    if (p.dataset.tag === t) p.classList.add("active");
  });
  document.querySelector(".controls").scrollIntoView({ behavior: "smooth", block: "start" });
  render();
}

function clearFilters() {
  state.search = "";
  state.sources.clear();
  state.tags.clear();
  state.minTopic = 0;
  state.sort = "date";
  document.getElementById("search").value = "";
  document.getElementById("sort").value = "date";
  document.getElementById("minTopic").value = 0;
  document.getElementById("minTopicVal").textContent = "0";
  document.querySelectorAll(".pill.active").forEach((p) => p.classList.remove("active"));
  render();
}

/* ------------------------------------------------------------------ */
/* Filtering + rendering                                               */
/* ------------------------------------------------------------------ */
function filteredItems() {
  return state.items.filter((it) => {
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
  });
}

function render() {
  const items = filteredItems();
  const feed = document.getElementById("feed");
  const empty = document.getElementById("empty");

  document.getElementById("resultCount").textContent =
    items.length + (items.length === 1 ? " item" : " items");

  if (!items.length) {
    feed.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  if (state.sort === "date") {
    feed.innerHTML = renderGroupedByDate(items);
  } else {
    const key = state.sort;
    const sorted = items.slice().sort((a, b) => (b[key] || 0) - (a[key] || 0) || (a.date < b.date ? 1 : -1));
    feed.innerHTML = `<div class="day-group"><div class="items">${sorted.map(itemCard).join("")}</div></div>`;
  }
}

function renderGroupedByDate(items) {
  const byDate = {};
  for (const it of items) (byDate[it.date] = byDate[it.date] || []).push(it);
  const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));
  return dates.map((date) => {
    const list = byDate[date].slice().sort((a, b) => (b.topic || 0) - (a.topic || 0));
    return `<section class="day-group">
      <div class="day-head">
        <span class="date">${date}</span>
        <span class="weekday">${weekday(date)}</span>
        <span class="count">${list.length} items</span>
      </div>
      <div class="items">${list.map(itemCard).join("")}</div>
    </section>`;
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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
/* Charts                                                              */
/* ------------------------------------------------------------------ */
function chartBase() {
  Chart.defaults.color = "#8a95a8";
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.borderColor = "rgba(255,255,255,0.05)";
}

function renderCharts() {
  if (typeof Chart === "undefined") return;
  chartBase();
  renderDailyChart();
  renderSourceChart();
  renderTagChart();
}

function renderDailyChart() {
  const days = (state.data.digests || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const labels = days.map((d) => d.date.slice(5));
  const totals = days.map((d) => d.items.length);
  const ctx = document.getElementById("chartDaily");
  const grad = ctx.getContext("2d").createLinearGradient(0, 0, 0, 240);
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
        y: { grid: { display: false }, ticks: { font: { family: "var(--mono)", size: 11 } } },
      },
    },
  });
}
