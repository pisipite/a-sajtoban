const state = {
  items: [],
  meta: {},
  integration: {},
  view: "incoming",
  visible: 20,
  decisions: JSON.parse(localStorage.getItem("kmonitor-decisions") || "{}"),
  synced: JSON.parse(localStorage.getItem("kmonitor-sheet-synced") || "{}"),
  syncing: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const els = {
  list: $("#resultsList"),
  empty: $("#emptyState"),
  loadMore: $("#loadMore"),
  search: $("#searchInput"),
  source: $("#sourceFilter"),
  period: $("#periodFilter"),
  decided: $("#showDecided"),
  summary: $("#resultsSummary"),
  toast: $("#toast"),
};

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[char]));

function normalize(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function highlightTerm(value = "") {
  return escapeHtml(value).replace(/(k[\s\-–—‑]+monitor(?:ról|ről|nak|nek|ban|ben|ral|rel|t|hoz|hez|höz|ért|os|nál|nél)?)/gi, "<mark>$1</mark>");
}

function dateLabel(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { full: value || "–", relative: "" };
  const diff = Math.floor((Date.now() - date.getTime()) / 86400000);
  let relative = "";
  if (diff === 0) relative = "ma";
  else if (diff === 1) relative = "tegnap";
  else if (diff > 1 && diff < 14) relative = `${diff} napja`;
  return {
    full: new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "short", day: "numeric" }).format(date),
    relative,
  };
}

function filteredItems() {
  const query = normalize(els.search.value.trim());
  const source = els.source.value;
  const days = els.period.value === "all" ? 0 : Number(els.period.value);
  const cutoff = days ? Date.now() - days * 86400000 : 0;

  return state.items
    .filter((item) => state.view === "incoming" ? item.kind === "candidate" : item.kind === "curated")
    .filter((item) => !source || item.source === source)
    .filter((item) => !query || normalize([item.title, item.source, item.topic, item.article_type, item.context].join(" ")).includes(query))
    .filter((item) => !days || new Date(`${item.date}T23:59:59`).getTime() >= cutoff)
    .filter((item) => state.view === "archive" || els.decided.checked || !state.decisions[item.id])
    .sort((a, b) => b.date.localeCompare(a.date) || (b.score || 0) - (a.score || 0));
}

function decisionButtons(item) {
  if (item.kind === "curated") return `<span class="archive-type">${escapeHtml(item.article_type || "válogatott")}</span>`;
  const decision = state.decisions[item.id];
  const syncing = state.syncing.has(item.id);
  return `<div class="decision" role="group" aria-label="Döntés a találatról">
    <button class="${decision === "yes" ? "active-yes" : ""} ${syncing ? "is-syncing" : ""}" data-decision="yes" data-id="${item.id}" type="button" title="Releváns – mentés az ai munkalapra" aria-label="Releváns – mentés az ai munkalapra" ${syncing ? "disabled aria-busy=\"true\"" : ""}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>
    </button>
    <button class="${decision === "no" ? "active-no" : ""} ${syncing ? "is-syncing" : ""}" data-decision="no" data-id="${item.id}" type="button" title="Kihagyás" aria-label="Kihagyás" ${syncing ? "disabled" : ""}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
  </div>`;
}

function rowTemplate(item) {
  const date = dateLabel(item.date);
  const high = (item.score || 0) >= 60;
  const scoreText = item.kind === "curated" ? "válogatott" : high ? "erős egyezés" : "ellenőrizendő";
  const scoreClass = item.kind === "curated" ? "curated" : high ? "high" : "";
  const topic = item.topic ? `<span class="topic-tag">${escapeHtml(item.topic)}</span>` : "";
  const reasons = item.kind === "candidate" && item.reasons?.length
    ? `<span class="reasons" title="${escapeHtml(item.reasons.join("; "))}">${escapeHtml(item.reasons.slice(0, 2).join(" · "))}</span>` : "";
  const contextLabels = {
    article: "Cikkből kiemelve",
    meta: "Cikkajánlóból kiemelve",
    title: "Cím alapján",
    unavailable: "Korlátozott hozzáférés",
  };
  const context = item.kind === "candidate" && item.context
    ? `<div class="context-box">
        <span class="context-label">${contextLabels[item.context_source] || "Szövegkörnyezet"}</span>
        <p>${highlightTerm(item.context)}</p>
      </div>` : "";
  return `<article class="result-row" data-id="${item.id}">
    <div class="result-main">
      <a class="result-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
      <svg class="external" aria-hidden="true" viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8M18 13v6H5V6h6"/></svg>
      <div class="result-meta"><span class="source-name">${escapeHtml(item.source || "Ismeretlen forrás")}</span>${topic}</div>
      ${context}
    </div>
    <div class="date-cell"><span>${escapeHtml(date.full)}</span>${date.relative ? `<small>${date.relative}</small>` : ""}</div>
    <div class="score-cell"><span class="score ${scoreClass}">${scoreText}</span>${reasons}</div>
    ${decisionButtons(item)}
  </article>`;
}

function render() {
  const items = filteredItems();
  const shown = items.slice(0, state.visible);
  els.list.innerHTML = shown.map(rowTemplate).join("");
  els.empty.hidden = items.length !== 0;
  els.loadMore.hidden = state.visible >= items.length;
  els.summary.textContent = `${items.length.toLocaleString("hu-HU")} ${state.view === "incoming" ? "ellenőrizhető találat" : "korábban relevánsnak talált cikk"}`;
  updateStats();
}

function updateSources() {
  const sources = [...new Set(state.items
    .filter((item) => state.view === "incoming" ? item.kind === "candidate" : item.kind === "curated")
    .map((item) => item.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, "hu"));
  const current = els.source.value;
  els.source.innerHTML = `<option value="">Minden forrás</option>${sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join("")}`;
  if (sources.includes(current)) els.source.value = current;
}

function updateStats() {
  const candidates = state.items.filter((item) => item.kind === "candidate");
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  $("#statNew").textContent = candidates.filter((item) => new Date(`${item.date}T23:59:59`).getTime() >= sevenDaysAgo).length;
  $("#statReview").textContent = candidates.filter((item) => !state.decisions[item.id]).length;
  $("#statAccepted").textContent = Object.values(state.decisions).filter((value) => value === "yes").length;
  $("#statArchive").textContent = state.items.filter((item) => item.kind === "curated").length;
}

function saveLocalState() {
  localStorage.setItem("kmonitor-decisions", JSON.stringify(state.decisions));
  localStorage.setItem("kmonitor-sheet-synced", JSON.stringify(state.synced));
}

function sheetPayload(item, action) {
  return {
    action,
    id: item.id,
    date: item.date || "",
    title: item.title || "",
    source: item.source || "",
    url: item.url || "",
    topic: item.topic || "",
    article_type: item.article_type || "",
    score: item.score ?? "",
    context: item.context || "",
    accepted_at: new Date().toISOString(),
  };
}

function submitToSheet(payload) {
  const endpoint = String(state.integration.google_apps_script_url || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint)) {
    return Promise.reject(new Error("A Google Táblázatok-kapcsolat még nincs beállítva."));
  }

  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const frameName = `sheet-sync-${requestId}`;
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    iframe.name = frameName;
    iframe.hidden = true;
    form.method = "POST";
    form.action = endpoint;
    form.target = frameName;
    form.hidden = true;

    const fields = { request_id: requestId, payload: JSON.stringify(payload) };
    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    });

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      form.remove();
      iframe.remove();
    };
    const onMessage = (event) => {
      if (event.data?.source !== "kmonitor-sheet" || event.data?.requestId !== requestId) return;
      const result = event.data;
      cleanup();
      if (result.ok) resolve(result);
      else reject(new Error(result.error || "A táblázatmentés sikertelen."));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("A táblázat nem válaszolt. Próbáld újra."));
    }, 15000);

    window.addEventListener("message", onMessage);
    document.body.append(iframe, form);
    form.submit();
  });
}

async function syncDecision(item, action, { quiet = false } = {}) {
  state.syncing.add(item.id);
  if (!quiet) {
    showToast(action === "accept" ? "Mentés az ai munkalapra…" : "Táblázat frissítése…");
    render();
  }
  try {
    await submitToSheet(sheetPayload(item, action));
    if (action === "accept") state.synced[item.id] = true;
    else delete state.synced[item.id];
    saveLocalState();
    return true;
  } catch (error) {
    if (!quiet) showToast(error.message);
    return false;
  } finally {
    state.syncing.delete(item.id);
    if (!quiet) render();
  }
}

async function setDecision(id, value) {
  if (state.syncing.has(id)) return;
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;

  const previous = state.decisions[id];
  const next = previous === value ? null : value;
  const sheetAction = next === "yes" ? "accept" : previous === "yes" ? "remove" : null;
  if (sheetAction && !await syncDecision(item, sheetAction)) return;

  if (next) state.decisions[id] = next;
  else delete state.decisions[id];
  saveLocalState();
  showToast(next === "yes" ? "Mentve az ai munkalapra" : next === "no" ? "Találat kihagyva" : "Döntés visszavonva");
  render();
}

async function syncStoredAccepted() {
  if (!state.integration.google_apps_script_url) return;
  const pending = state.items.filter((item) => state.decisions[item.id] === "yes" && !state.synced[item.id]);
  for (const item of pending) await syncDecision(item, "accept", { quiet: true });
  if (pending.length) render();
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function exportCsv() {
  const accepted = state.items.filter((item) => state.decisions[item.id] === "yes");
  const items = accepted.length ? accepted : filteredItems();
  const headers = ["dátum", "cím", "forrás", "link", "téma", "típus", "pontszám", "szövegkörnyezet"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = items.map((item) => [item.date, item.title, item.source, item.url, item.topic, item.article_type, item.score, item.context].map(quote).join(","));
  const blob = new Blob(["\ufeff", headers.map(quote).join(","), "\n", rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `kmonitor-talalatok-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(`${items.length} sor exportálva`);
}

async function loadData() {
  try {
    const [itemsResponse, metaResponse, integrationResponse] = await Promise.all([
      fetch("data/items.json"),
      fetch("data/meta.json"),
      fetch("data/integration.json", { cache: "no-store" }),
    ]);
    if (!itemsResponse.ok) throw new Error("Az adatfájl nem érhető el.");
    state.items = await itemsResponse.json();
    state.meta = metaResponse.ok ? await metaResponse.json() : {};
    state.integration = integrationResponse.ok ? await integrationResponse.json() : {};
    const updated = state.meta.updated_at ? new Date(state.meta.updated_at) : null;
    $("#lastUpdated").textContent = updated && !Number.isNaN(updated.getTime())
      ? `Utoljára ellenőrizve: ${new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeStyle: "short" }).format(updated)}`
      : "Az utolsó ellenőrzés ideje ismeretlen";
    updateSources();
    render();
    void syncStoredAccepted();
  } catch (error) {
    els.summary.textContent = "Az adatok betöltése sikertelen.";
    els.empty.hidden = false;
    els.empty.querySelector("h3").textContent = "Nem sikerült betölteni az adatokat";
    els.empty.querySelector("p").textContent = error.message;
  }
}

$(".view-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-view]");
  if (!tab) return;
  state.view = tab.dataset.view;
  state.visible = 20;
  document.querySelectorAll(".view-tab").forEach((button) => {
    const active = button === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.decided.closest("label").style.visibility = state.view === "incoming" ? "visible" : "hidden";
  updateSources();
  render();
});

$("#filters").addEventListener("input", () => { state.visible = 20; render(); });
els.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-decision]");
  if (button) void setDecision(button.dataset.id, button.dataset.decision);
});
els.loadMore.addEventListener("click", () => { state.visible += 20; render(); });
$("#clearFilters").addEventListener("click", () => {
  els.search.value = ""; els.source.value = ""; els.period.value = "all"; els.decided.checked = false; render();
});
$("#exportButton").addEventListener("click", exportCsv);
$("#copyQuery").addEventListener("click", async () => {
  await navigator.clipboard.writeText('"K-Monitor" OR "K Monitor"');
  showToast("Keresőkifejezés másolva");
});

loadData();
