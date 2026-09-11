/* ==========================================================================
   PCPlayground app.js
   --------------------------------------------------------------------------
   Sections:
     1. Cookie storage helpers
     2. State (builds, settings, theme) + persistence
     3. Calculation engine (FPS, bottleneck, power, score, upgrade advice)
     4. Rendering for every view
     5. Event wiring
   ========================================================================== */

/* ---------------------------------------------------------- 1. COOKIES */
const Cookie = {
  set(name, value, days = 365) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  },
  get(name) {
    const match = document.cookie.split("; ").find(row => row.startsWith(name + "="));
    if (!match) return null;
    try { return JSON.parse(decodeURIComponent(match.split("=").slice(1).join("="))); }
    catch { return null; }
  },
  remove(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Lax`;
  }
};

const COOKIE_KEYS = {
  builds: "pcpg_builds",
  active: "pcpg_active",
  settings: "pcpg_settings",
  theme: "pcpg_theme",
};

/* ---------------------------------------------------------- 2. STATE */
const DEFAULT_SETTINGS = { resolution: "1080p", targetFps: 60, quality: "high" };
const DEFAULT_THEME = { mode: "dark", accent1: "#3b82f6", accent2: "#8b5cf6" };

const State = {
  builds: Cookie.get(COOKIE_KEYS.builds) || [],
  activeId: Cookie.get(COOKIE_KEYS.active) || null,
  settings: Object.assign({}, DEFAULT_SETTINGS, Cookie.get(COOKIE_KEYS.settings) || {}),
  theme: Object.assign({}, DEFAULT_THEME, Cookie.get(COOKIE_KEYS.theme) || {}),
};

function saveBuilds() { Cookie.set(COOKIE_KEYS.builds, State.builds); }
function saveActive() { Cookie.set(COOKIE_KEYS.active, State.activeId); }
function saveSettings() { Cookie.set(COOKIE_KEYS.settings, State.settings); }
function saveTheme() { Cookie.set(COOKIE_KEYS.theme, State.theme); }

function getActiveBuild() { return State.builds.find(b => b.id === State.activeId) || null; }
function uid() { return Math.random().toString(36).slice(2, 9); }

/* ---------------------------------------------------------- 3. ENGINE */
const RES_MULT = { "1080p": 1, "1440p": 0.66, "4K": 0.4 };
const QUALITY_MULT = { low: 1.55, medium: 1.25, high: 1, ultra: 0.78 };
const QUALITY_LABEL = { low: "Low", medium: "Medium", high: "High", ultra: "Ultra" };

function findGpu(name) { return PCDB.gpus.find(g => g.name === name); }
function findCpu(name) { return PCDB.cpus.find(c => c.name === name); }

function ramMultiplier(ramGB, ramHeavy) {
  if (ramGB < 8) return 0.65;
  if (ramGB < 16) return ramHeavy ? 0.88 : 0.97;
  if (ramGB < 32) return 1.0;
  return ramHeavy ? 1.03 : 1.0;
}

// Returns { fps, gpuFps, cpuFps, bound } for one game under current settings
function estimateGame(build, game, resolution, quality) {
  const gpu = findGpu(build.gpu), cpu = findCpu(build.cpu);
  if (!gpu || !cpu) return { fps: 0, gpuFps: 0, cpuFps: 0, bound: "gpu" };

  const gpuFps = game.refFps
    * Math.pow(gpu.score / PCDB.REF.gpuScore, 0.92)
    * RES_MULT[resolution]
    * QUALITY_MULT[quality];

  const cpuFps = game.cpuCeiling * Math.pow(cpu.score / PCDB.REF.cpuScore, 0.55);

  const raw = Math.min(gpuFps, cpuFps) * ramMultiplier(build.ram, game.ramHeavy);
  const fps = Math.max(1, Math.round(raw));
  const bound = cpuFps < gpuFps * 0.92 ? "cpu" : (gpuFps < cpuFps * 0.85 ? "gpu" : "balanced");
  return { fps, gpuFps: Math.round(gpuFps), cpuFps: Math.round(cpuFps), bound };
}

function ratingFor(fps, targetFps) {
  const ratio = fps / targetFps;
  if (ratio >= 1.5) return "Excellent";
  if (ratio >= 1.1) return "Great";
  if (ratio >= 0.9) return "Good";
  if (ratio >= 0.6) return "Playable";
  if (ratio >= 0.35) return "Poor";
  return "Unplayable";
}

function allGameEstimates(build, resolution, quality, targetFps) {
  return PCDB.games.map(game => {
    const est = estimateGame(build, game, resolution, quality);
    return Object.assign({ game: game.name, rating: ratingFor(est.fps, targetFps) }, est);
  });
}

// Overall 0-100 score: blend of raw GPU/CPU tier + RAM adequacy
function overallScore(build) {
  const gpu = findGpu(build.gpu), cpu = findCpu(build.cpu);
  if (!gpu || !cpu) return 0;
  const ramScore = build.ram >= 32 ? 100 : build.ram >= 16 ? 88 : build.ram >= 8 ? 55 : 25;
  const raw = gpu.score * 0.55 + cpu.score * 0.35 + ramScore * 0.10;
  return Math.max(1, Math.min(100, Math.round(raw)));
}

function scoreVerdict(score) {
  if (score >= 80) return { label: "Excellent", color: "var(--good)" };
  if (score >= 60) return { label: "Great", color: "#7dd3fc" };
  if (score >= 40) return { label: "Good", color: "var(--accent-1)" };
  if (score >= 22) return { label: "Entry-level", color: "var(--warn)" };
  return { label: "Outdated", color: "var(--bad)" };
}

// Aggregate bottleneck across the whole library at current settings
function bottleneckSummary(build, resolution, quality) {
  const results = PCDB.games.map(g => estimateGame(build, g, resolution, quality));
  const gpuCount = results.filter(r => r.bound === "gpu").length;
  const cpuCount = results.filter(r => r.bound === "cpu").length;
  const total = results.length;
  const gpuPct = Math.round((gpuCount / total) * 100);
  const cpuPct = Math.round((cpuCount / total) * 100);
  let verdict = "balanced";
  if (gpuPct > cpuPct + 10) verdict = "gpu";
  else if (cpuPct > gpuPct + 10) verdict = "cpu";
  return { gpuPct, cpuPct, verdict };
}

function estimatePower(build) {
  const gpu = findGpu(build.gpu), cpu = findCpu(build.cpu);
  if (!gpu || !cpu) return null;
  const cpuW = Math.round(cpu.tdp * 0.85);
  const gpuW = Math.round(gpu.tdp * 0.95);
  const ramW = Math.max(3, Math.round(build.ram * 0.4));
  const otherW = 45; // motherboard, fans, storage, RGB tax
  const total = cpuW + gpuW + ramW + otherW;
  const psuRecommend = Math.ceil((total * 1.4) / 50) * 50;
  return { cpuW, gpuW, ramW, otherW, total, psuRecommend };
}

// Suggest the single most impactful upgrade
function upgradeAdvice(build) {
  const gpu = findGpu(build.gpu), cpu = findCpu(build.cpu);
  const bl = bottleneckSummary(build, State.settings.resolution, State.settings.quality);
  const ramLow = build.ram < 16;

  const gpuNorm = gpu.score / 100, cpuNorm = cpu.score / 100;
  const ramNorm = build.ram >= 32 ? 1 : build.ram >= 16 ? 0.88 : build.ram >= 8 ? 0.55 : 0.25;

  const candidates = [
    { part: "GPU", norm: gpuNorm, reason: `Your GPU is the primary bottleneck in ${bl.gpuPct}% of tested games.` },
    { part: "CPU", norm: cpuNorm, reason: `Your CPU is capping FPS in ${bl.cpuPct}% of tested games.` },
    { part: "RAM", norm: ramNorm, reason: ramLow ? `${build.ram}GB is below the 16GB most current games expect, causing stutter in RAM-heavy titles.` : "RAM is comfortably ahead of your other components." },
  ];
  candidates.sort((a, b) => a.norm - b.norm);
  const top = candidates[0];

  // suggest a concrete next-tier part ~15-25 score points above current
  let suggestion = null;
  if (top.part === "GPU") {
    const target = Math.min(100, gpu.score + 20);
    suggestion = PCDB.gpus.filter(g => g.score > gpu.score && g.score <= target + 15)
      .sort((a, b) => a.score - b.score)[0] || PCDB.gpus.filter(g => g.score > gpu.score).sort((a, b) => a.score - b.score)[0];
  } else if (top.part === "CPU") {
    const target = Math.min(100, cpu.score + 20);
    suggestion = PCDB.cpus.filter(c => c.score > cpu.score && c.score <= target + 15)
      .sort((a, b) => a.score - b.score)[0] || PCDB.cpus.filter(c => c.score > cpu.score).sort((a, b) => a.score - b.score)[0];
  }

  return { top, candidates, suggestion, bottleneck: bl };
}

/* ---------------------------------------------------------- 4. RENDER HELPERS */
function fmtSpecGpu(name) { const g = findGpu(name); return g ? `${g.name} · ${g.vram}GB` : name; }
function fmtSpecCpu(name) { const c = findCpu(name); return c ? `${c.name} · ${c.cores}C/${c.threads}T` : name; }

function barColorForRating(rating) {
  return {
    Excellent: "var(--good)", Great: "#7dd3fc", Good: "var(--accent-1)",
    Playable: "var(--warn)", Poor: "#fb923c", Unplayable: "var(--bad)",
  }[rating];
}

function renderGameRow(est, targetFps) {
  const pct = Math.max(4, Math.min(100, Math.round((est.fps / (targetFps * 1.5)) * 100)));
  const color = barColorForRating(est.rating);
  return `
    <div class="game-row">
      <div class="game-name">${est.game}</div>
      <div class="game-fps">${est.fps} <span style="color:var(--text-2); font-weight:500;">fps</span></div>
      <div class="game-bar-track"><div class="game-bar-fill" style="width:${pct}%; background:${color};"></div></div>
      <div class="game-rating rating-${est.rating}">${est.rating}</div>
    </div>`;
}

/* ---------------------------------------------------------- VIEW: onboarding / build form */
function buildFormHtml(existing) {
  const b = existing || { name: "", cpu: "", gpu: "", ram: 16, storage: "" };
  const gpuOpts = PCDB.gpus.map(g => `<option value="${g.name}" ${g.name === b.gpu ? "selected" : ""}>${g.name}</option>`).join("");
  const cpuOpts = PCDB.cpus.map(c => `<option value="${c.name}" ${c.name === b.cpu ? "selected" : ""}>${c.name}</option>`).join("");
  const ramOpts = [4, 8, 12, 16, 24, 32, 64].map(r => `<option value="${r}" ${r === b.ram ? "selected" : ""}>${r} GB</option>`).join("");
  return `
    <label>Build name
      <input class="input" id="fName" type="text" value="${b.name}" placeholder="e.g. Main Rig">
    </label>
    <label>Graphics card (GPU)
      <select class="input" id="fGpu"><option value="">Select a GPU…</option>${gpuOpts}</select>
    </label>
    <label>Processor (CPU)
      <select class="input" id="fCpu"><option value="">Select a CPU…</option>${cpuOpts}</select>
    </label>
    <label>Memory (RAM)
      <select class="input" id="fRam">${ramOpts}</select>
    </label>
    <label>Storage (optional note)
      <input class="input" id="fStorage" type="text" value="${b.storage || ""}" placeholder="e.g. 1TB NVMe SSD">
    </label>`;
}

/* ---------------------------------------------------------- OPTIONS FOR SELECT FILTERS */
function fillResSelect(el, val) {
  el.innerHTML = Object.keys(RES_MULT).map(r => `<option value="${r}" ${r === val ? "selected" : ""}>${r}</option>`).join("");
}
function fillFpsSelect(el, val) {
  el.innerHTML = [30, 60, 90, 120, 144, 240].map(f => `<option value="${f}" ${f === val ? "selected" : ""}>${f} FPS</option>`).join("");
}
function fillQualitySelect(el, val) {
  el.innerHTML = Object.keys(QUALITY_LABEL).map(q => `<option value="${q}" ${q === val ? "selected" : ""}>${QUALITY_LABEL[q]}</option>`).join("");
}

/* ---------------------------------------------------------- RENDER: DASHBOARD */
function renderDashboard() {
  const build = getActiveBuild();
  const onboarding = document.getElementById("view-onboarding");
  const dashboard = document.getElementById("view-dashboard");

  if (!build) {
    document.getElementById("onboardingForm").innerHTML = "";
    switchView("onboarding");
    return;
  }

  const gpu = findGpu(build.gpu), cpu = findCpu(build.cpu);
  document.getElementById("dashSubtitle").textContent = `${build.name} — ${cpu.name} + ${gpu.name}`;
  document.getElementById("sidebarActiveBuild").textContent = build.name;

  document.getElementById("specList").innerHTML = `
    <div class="spec-row"><span class="k">CPU</span><span class="v">${fmtSpecCpu(build.cpu)}</span></div>
    <div class="spec-row"><span class="k">GPU</span><span class="v">${fmtSpecGpu(build.gpu)}</span></div>
    <div class="spec-row"><span class="k">RAM</span><span class="v">${build.ram} GB</span></div>
    <div class="spec-row"><span class="k">Storage</span><span class="v">${build.storage || "—"}</span></div>`;

  const score = overallScore(build);
  const verdict = scoreVerdict(score);
  const circumference = 2 * Math.PI * 52;
  document.getElementById("scoreNum").textContent = score;
  const fg = document.getElementById("scoreRingFg");
  fg.style.strokeDasharray = circumference;
  fg.style.strokeDashoffset = circumference - (score / 100) * circumference;
  fg.style.stroke = verdict.color;
  const verdictEl = document.getElementById("scoreVerdict");
  verdictEl.textContent = verdict.label;
  verdictEl.style.color = verdict.color;

  const bl = bottleneckSummary(build, State.settings.resolution, State.settings.quality);
  const blTagClass = bl.verdict === "gpu" ? "gpu" : bl.verdict === "cpu" ? "cpu" : "balanced";
  const blTagText = bl.verdict === "gpu" ? "GPU Limited" : bl.verdict === "cpu" ? "CPU Limited" : "Well Balanced";
  document.getElementById("bottleneckBody").innerHTML = `
    <span class="bottleneck-tag ${blTagClass}">${bl.verdict !== "balanced" ? "⚠ " : "✓ "}${blTagText}</span>
    <p class="muted">${bl.verdict === "gpu" ? `Your ${gpu.name} is the main bottleneck, especially at higher resolutions.` :
      bl.verdict === "cpu" ? `Your ${cpu.name} is holding back frame rates, mostly in fast-paced or CPU-heavy titles.` :
      "No single part is dragging the others down — a solid, balanced build."}</p>
    <div class="bottleneck-bars">
      <div class="bl-row"><span class="bl-label">GPU</span><div class="bl-track"><div class="bl-fill" style="width:${bl.gpuPct}%; background:var(--warn);"></div></div><span class="bl-pct">${bl.gpuPct}%</span></div>
      <div class="bl-row"><span class="bl-label">CPU</span><div class="bl-track"><div class="bl-fill" style="width:${bl.cpuPct}%; background:var(--accent-2);"></div></div><span class="bl-pct">${bl.cpuPct}%</span></div>
    </div>`;

  const power = estimatePower(build);
  document.getElementById("powerBody").innerHTML = `
    <div class="power-total">~${power.total} W</div>
    <div class="power-row"><span><span class="dot" style="background:var(--accent-1);"></span>GPU</span><span>${power.gpuW} W</span></div>
    <div class="power-row"><span><span class="dot" style="background:var(--accent-2);"></span>CPU</span><span>${power.cpuW} W</span></div>
    <div class="power-row"><span><span class="dot" style="background:var(--text-2);"></span>RAM + other</span><span>${power.ramW + power.otherW} W</span></div>
    <div class="psu-note">Recommended PSU: <strong style="color:var(--text-0);">${power.psuRecommend}W</strong> or higher</div>`;

  const estimates = allGameEstimates(build, State.settings.resolution, State.settings.quality, State.settings.targetFps)
    .sort((a, b) => b.fps - a.fps);
  const preview = estimates.slice(0, 6);
  document.getElementById("previewGames").innerHTML = preview.map(e => renderGameRow(e, State.settings.targetFps)).join("");

  switchView("dashboard");
}

/* ---------------------------------------------------------- RENDER: GAMES */
let gameFilterState = { search: "" };
function renderGames() {
  const build = getActiveBuild();
  if (!build) {
    document.getElementById("fullGameList").innerHTML = `<p class="muted" style="padding:16px 4px;">Add a build first to see FPS estimates.</p>`;
    return;
  }

  fillResSelect(document.getElementById("filterResolution"), State.settings.resolution);
  fillFpsSelect(document.getElementById("filterTargetFps"), State.settings.targetFps);
  fillQualitySelect(document.getElementById("filterQuality"), State.settings.quality);

  let estimates = allGameEstimates(build, State.settings.resolution, State.settings.quality, State.settings.targetFps);
  if (gameFilterState.search) {
    const q = gameFilterState.search.toLowerCase();
    estimates = estimates.filter(e => e.game.toLowerCase().includes(q));
  }
  const sort = document.getElementById("filterSort").value;
  if (sort === "fps-desc") estimates.sort((a, b) => b.fps - a.fps);
  else if (sort === "fps-asc") estimates.sort((a, b) => a.fps - b.fps);
  else estimates.sort((a, b) => a.game.localeCompare(b.game));

  document.getElementById("fullGameList").innerHTML = estimates.length
    ? estimates.map(e => renderGameRow(e, State.settings.targetFps)).join("")
    : `<p class="muted" style="padding:16px 4px;">No games match "${gameFilterState.search}".</p>`;
}

/* ---------------------------------------------------------- RENDER: UPGRADE */
function renderUpgrade() {
  const build = getActiveBuild();
  const body = document.getElementById("upgradeBody");
  if (!build) { body.innerHTML = `<p class="muted">Add a build first to get upgrade advice.</p>`; return; }

  const advice = upgradeAdvice(build);
  const gpu = findGpu(build.gpu), cpu = findCpu(build.cpu);

  let suggestionHtml = "";
  if (advice.suggestion) {
    const isGpu = advice.top.part === "GPU";
    const gain = Math.round(((advice.suggestion.score - (isGpu ? gpu.score : cpu.score)) / (isGpu ? gpu.score : cpu.score)) * 100);
    suggestionHtml = `
      <div class="card">
        <div class="card-title">Suggested upgrade</div>
        <p style="font-size:18px; font-weight:700; margin-bottom:6px;">${advice.suggestion.name}</p>
        <p class="muted">Roughly <strong style="color:var(--good);">+${gain}%</strong> performance over your current ${isGpu ? gpu.name : cpu.name}, resolving most of the bottleneck above.</p>
      </div>`;
  }

  body.innerHTML = `
    <div class="card">
      <div class="card-title">Priority #1</div>
      <p style="font-size:20px; font-weight:750; margin-bottom:6px;">Upgrade your ${advice.top.part}</p>
      <p class="muted">${advice.top.reason}</p>
    </div>
    ${suggestionHtml}
    <div class="card">
      <div class="card-title">Full breakdown</div>
      <div class="bottleneck-bars">
        ${advice.candidates.map(c => `
          <div class="bl-row">
            <span class="bl-label" style="width:60px;">${c.part}</span>
            <div class="bl-track"><div class="bl-fill" style="width:${Math.round(c.norm * 100)}%; background:${c.part === advice.top.part ? "var(--bad)" : "var(--accent-1)"};"></div></div>
            <span class="bl-pct" style="width:60px;">${Math.round(c.norm * 100)}/100</span>
          </div>`).join("")}
      </div>
      <p class="muted" style="margin-top:12px;">Lower bars mean more room to grow — that's usually where an upgrade pays off most.</p>
    </div>`;
}

/* ---------------------------------------------------------- RENDER: BUILDS */
function renderBuilds() {
  const grid = document.getElementById("buildsGrid");
  if (!State.builds.length) {
    grid.innerHTML = `<p class="muted">No builds saved yet. Click "New Build" to add one.</p>`;
    return;
  }
  grid.innerHTML = State.builds.map(b => {
    const active = b.id === State.activeId;
    return `
      <div class="build-card ${active ? "is-active" : ""}">
        <div class="build-card-title">
          <h3>${b.name}</h3>
          ${active ? '<span class="active-pill">ACTIVE</span>' : ""}
        </div>
        <div class="build-card-specs">
          ${fmtSpecCpu(b.cpu)}<br>${fmtSpecGpu(b.gpu)}<br>${b.ram}GB RAM · Score ${overallScore(b)}
        </div>
        <div class="build-card-actions">
          ${!active ? `<button class="btn btn-ghost btn-sm" data-action="activate" data-id="${b.id}">Set Active</button>` : ""}
          <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${b.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${b.id}">Delete</button>
        </div>
      </div>`;
  }).join("");
}

/* ---------------------------------------------------------- RENDER: COMPARE */
function renderCompareSelects() {
  const opts = State.builds.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
  const a = document.getElementById("compareA"), bSel = document.getElementById("compareB");
  const prevA = a.value, prevB = bSel.value;
  a.innerHTML = `<option value="">Select build A…</option>${opts}`;
  bSel.innerHTML = `<option value="">Select build B…</option>${opts}`;
  if (State.builds.some(b => b.id === prevA)) a.value = prevA;
  if (State.builds.some(b => b.id === prevB)) bSel.value = prevB;
}

function renderCompareBody() {
  const idA = document.getElementById("compareA").value, idB = document.getElementById("compareB").value;
  const body = document.getElementById("compareBody");
  if (State.builds.length < 2) { body.innerHTML = `<p class="muted">Save at least two builds to compare them.</p>`; return; }
  const a = State.builds.find(b => b.id === idA), b = State.builds.find(b => b.id === idB);
  if (!a || !b) { body.innerHTML = `<p class="muted">Pick two builds above to compare.</p>`; return; }

  const estA = allGameEstimates(a, State.settings.resolution, State.settings.quality, State.settings.targetFps);
  const estB = allGameEstimates(b, State.settings.resolution, State.settings.quality, State.settings.targetFps);
  let winsA = 0, winsB = 0;
  const rows = PCDB.games.map((g, i) => {
    const fA = estA[i].fps, fB = estB[i].fps;
    if (fA > fB) winsA++; else if (fB > fA) winsB++;
    return { name: g.name, fA, fB };
  }).sort((x, y) => (y.fA + y.fB) - (x.fA + x.fB)).slice(0, 20);

  body.innerHTML = `
    <div class="compare-summary">
      <div class="card"><div class="card-title">${a.name}</div><div class="num" style="color:${winsA >= winsB ? "var(--good)" : "var(--text-0)"};">${winsA}</div><div class="muted">games won</div></div>
      <div class="card"><div class="card-title">${b.name}</div><div class="num" style="color:${winsB >= winsA ? "var(--good)" : "var(--text-0)"};">${winsB}</div><div class="muted">games won</div></div>
    </div>
    <div class="card">
      <table class="compare-table">
        <thead><tr><th>Component</th><th>${a.name}</th><th>${b.name}</th></tr></thead>
        <tbody>
          <tr><td>CPU</td><td>${fmtSpecCpu(a.cpu)}</td><td>${fmtSpecCpu(b.cpu)}</td></tr>
          <tr><td>GPU</td><td>${fmtSpecGpu(a.gpu)}</td><td>${fmtSpecGpu(b.gpu)}</td></tr>
          <tr><td>RAM</td><td>${a.ram}GB</td><td>${b.ram}GB</td></tr>
          <tr><td>Score</td><td>${overallScore(a)}</td><td>${overallScore(b)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-title">Top 20 games — FPS at ${State.settings.resolution}, ${QUALITY_LABEL[State.settings.quality]}</div>
      <table class="compare-table">
        <thead><tr><th>Game</th><th>${a.name}</th><th>${b.name}</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr><td>${r.name}</td><td class="${r.fA > r.fB ? "win" : ""}">${r.fA} fps</td><td class="${r.fB > r.fA ? "win" : ""}">${r.fB} fps</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

/* ---------------------------------------------------------- RENDER: SETTINGS */
function renderSettings() {
  document.querySelectorAll(".theme-swatch").forEach(s => s.classList.toggle("active", s.dataset.theme === State.theme.mode));
  document.getElementById("customThemeRow").classList.toggle("show", State.theme.mode === "custom");
  document.getElementById("accentColor1").value = State.theme.accent1;
  document.getElementById("accentColor2").value = State.theme.accent2;

  fillResSelect(document.getElementById("settingsResolution"), State.settings.resolution);
  fillFpsSelect(document.getElementById("settingsTargetFps"), State.settings.targetFps);
  fillQualitySelect(document.getElementById("settingsQuality"), State.settings.quality);
}

/* ---------------------------------------------------------- THEME APPLY */
function applyTheme() {
  document.body.classList.toggle("theme-light", State.theme.mode === "light");
  const root = document.documentElement.style;
  if (State.theme.mode === "custom") {
    root.setProperty("--accent-1", State.theme.accent1);
    root.setProperty("--accent-2", State.theme.accent2);
  } else {
    root.setProperty("--accent-1", DEFAULT_THEME.accent1);
    root.setProperty("--accent-2", DEFAULT_THEME.accent2);
  }
}

/* ---------------------------------------------------------- VIEW SWITCHING */
function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.add("active");
  if (name === "dashboard") renderDashboard();
  if (name === "games") renderGames();
  if (name === "upgrade") renderUpgrade();
  if (name === "builds") renderBuilds();
  if (name === "compare") { renderCompareSelects(); renderCompareBody(); }
  if (name === "settings") renderSettings();
}

/* ---------------------------------------------------------- MODAL (add/edit build) */
let editingBuildId = null;
function openBuildModal(build) {
  editingBuildId = build ? build.id : null;
  document.getElementById("buildModalTitle").textContent = build ? "Edit Build" : "New Build";
  document.getElementById("buildModalBody").innerHTML = buildFormHtml(build);
  document.getElementById("buildModalBackdrop").classList.add("show");
}
function closeBuildModal() {
  document.getElementById("buildModalBackdrop").classList.remove("show");
  editingBuildId = null;
}
function saveBuildFromModal() {
  const name = document.getElementById("fName").value.trim() || "Unnamed Build";
  const gpu = document.getElementById("fGpu").value;
  const cpu = document.getElementById("fCpu").value;
  const ram = parseInt(document.getElementById("fRam").value, 10);
  const storage = document.getElementById("fStorage").value.trim();
  if (!gpu || !cpu) { alert("Please select both a CPU and a GPU."); return; }

  if (editingBuildId) {
    const b = State.builds.find(x => x.id === editingBuildId);
    Object.assign(b, { name, gpu, cpu, ram, storage });
  } else {
    const b = { id: uid(), name, gpu, cpu, ram, storage };
    State.builds.push(b);
    if (!State.activeId) State.activeId = b.id;
  }
  saveBuilds(); saveActive();
  closeBuildModal();
  switchView(document.querySelector(".nav-btn.active")?.dataset.view || "dashboard");
}

/* ---------------------------------------------------------- EVENT WIRING */
document.addEventListener("DOMContentLoaded", () => {
  applyTheme();

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.goto));
  });

  // Onboarding
  document.getElementById("onboardingStart").addEventListener("click", () => {
    document.getElementById("onboardingForm").innerHTML = `
      <div class="card" style="max-width:480px;">
        <div class="card-title">Your specs</div>
        <div style="display:flex; flex-direction:column; gap:14px;">
          ${buildFormHtml(null)}
          <button class="btn btn-primary" id="onboardingSave">Save & See Dashboard</button>
        </div>
      </div>`;
    document.getElementById("onboardingSave").addEventListener("click", () => {
      const name = document.getElementById("fName").value.trim() || "My PC";
      const gpu = document.getElementById("fGpu").value;
      const cpu = document.getElementById("fCpu").value;
      const ram = parseInt(document.getElementById("fRam").value, 10);
      const storage = document.getElementById("fStorage").value.trim();
      if (!gpu || !cpu) { alert("Please select both a CPU and a GPU."); return; }
      const b = { id: uid(), name, gpu, cpu, ram, storage };
      State.builds.push(b);
      State.activeId = b.id;
      saveBuilds(); saveActive();
      switchView("dashboard");
    });
  });

  // Dashboard edit button
  document.getElementById("editActiveBuildBtn").addEventListener("click", () => {
    const b = getActiveBuild();
    if (b) openBuildModal(b);
  });

  // Games filters
  document.getElementById("gameSearch").addEventListener("input", e => {
    gameFilterState.search = e.target.value;
    renderGames();
  });
  document.getElementById("filterResolution").addEventListener("change", e => {
    State.settings.resolution = e.target.value; saveSettings(); renderGames();
  });
  document.getElementById("filterTargetFps").addEventListener("change", e => {
    State.settings.targetFps = parseInt(e.target.value, 10); saveSettings(); renderGames();
  });
  document.getElementById("filterQuality").addEventListener("change", e => {
    State.settings.quality = e.target.value; saveSettings(); renderGames();
  });
  document.getElementById("filterSort").addEventListener("change", renderGames);

  // Builds
  document.getElementById("newBuildBtn").addEventListener("click", () => openBuildModal(null));
  document.getElementById("buildsGrid").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === "activate") {
      State.activeId = id; saveActive(); renderBuilds();
    } else if (btn.dataset.action === "edit") {
      openBuildModal(State.builds.find(b => b.id === id));
    } else if (btn.dataset.action === "delete") {
      if (!confirm("Delete this build?")) return;
      State.builds = State.builds.filter(b => b.id !== id);
      if (State.activeId === id) State.activeId = State.builds[0]?.id || null;
      saveBuilds(); saveActive(); renderBuilds();
    }
  });

  // Modal
  document.getElementById("buildModalClose").addEventListener("click", closeBuildModal);
  document.getElementById("buildModalCancel").addEventListener("click", closeBuildModal);
  document.getElementById("buildModalSave").addEventListener("click", saveBuildFromModal);
  document.getElementById("buildModalBackdrop").addEventListener("click", e => {
    if (e.target.id === "buildModalBackdrop") closeBuildModal();
  });

  // Compare
  document.getElementById("compareA").addEventListener("change", renderCompareBody);
  document.getElementById("compareB").addEventListener("change", renderCompareBody);

  // Settings — theme
  document.getElementById("themeOptions").addEventListener("click", e => {
    const btn = e.target.closest(".theme-swatch");
    if (!btn) return;
    State.theme.mode = btn.dataset.theme;
    saveTheme(); applyTheme(); renderSettings();
  });
  document.getElementById("accentColor1").addEventListener("input", e => {
    State.theme.accent1 = e.target.value; saveTheme(); applyTheme();
  });
  document.getElementById("accentColor2").addEventListener("input", e => {
    State.theme.accent2 = e.target.value; saveTheme(); applyTheme();
  });

  // Settings — defaults
  document.getElementById("settingsResolution").addEventListener("change", e => {
    State.settings.resolution = e.target.value; saveSettings();
  });
  document.getElementById("settingsTargetFps").addEventListener("change", e => {
    State.settings.targetFps = parseInt(e.target.value, 10); saveSettings();
  });
  document.getElementById("settingsQuality").addEventListener("change", e => {
    State.settings.quality = e.target.value; saveSettings();
  });

  // Data management
  document.getElementById("exportDataBtn").addEventListener("click", () => {
    const data = { builds: State.builds, activeId: State.activeId, settings: State.settings, theme: State.theme };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pcplayground-data.json"; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("clearDataBtn").addEventListener("click", () => {
    if (!confirm("This clears all saved builds and settings from this browser. Continue?")) return;
    Object.values(COOKIE_KEYS).forEach(k => Cookie.remove(k));
    location.reload();
  });

  // Initial view
  if (getActiveBuild()) switchView("dashboard");
  else switchView("onboarding");
});
