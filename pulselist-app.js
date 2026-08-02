// ── Firebase ───────────────────────────────────────────────────────────────
let auth = null;
let db = null;
let currentUser = null;
try {
  auth = firebase.auth();
  db = firebase.firestore();
} catch (e) {
  console.warn("Firebase failed to initialise:", e);
}

// ── State ──────────────────────────────────────────────────────────────────
const appState = {
  currentView: "grid",
  sidebarOpen: false,
  theme: "dark",
  tasks: [],
  categories: ["Personal", "Work", "School", "Business"],
  nextId: 1,
  filter: "all",
  categoryFilter: null,
  searchQuery: "",
  editingTaskId: null,
  celebrationEffect: "confetti",
};

// ── Subtask modal state ────────────────────────────────────────────────────
let modalSubtasks = [];
let draggingTaskId = null;
let modalSubtaskNextId = 1;
let gridSort = "time";
let timelineScale = "7d";

// ── Persistence ────────────────────────────────────────────────────────────
async function loadState() {
  // Try Firestore first (cross-device sync)
  if (db && currentUser) {
    try {
      const doc = await db.collection("users").doc(currentUser.uid).get();
      if (doc.exists) {
        const data = doc.data();
        appState.tasks = data.tasks ?? [];
        appState.categories = data.categories ?? ["Personal", "Work", "School", "Business"];
        appState.nextId = data.nextId ?? 1;
        appState.theme = data.theme ?? "dark";
        appState.celebrationEffect = data.celebrationEffect ?? "confetti";
        return;
      }
    } catch (e) {
      console.warn("Firestore load failed, falling back to localStorage:", e);
    }
  }
  // Fallback: localStorage (offline / no account)
  try {
    const raw = localStorage.getItem("pulselist");
    if (!raw) return;
    const data = JSON.parse(raw);
    appState.tasks = data.tasks ?? [];
    appState.categories = data.categories ?? ["Personal", "Work", "School", "Business"];
    appState.nextId = data.nextId ?? 1;
    appState.theme = data.theme ?? "dark";
    appState.celebrationEffect = data.celebrationEffect ?? "confetti";
    // Migrate existing localStorage data up to Firestore on first cloud login
    if (db && currentUser && appState.tasks.length > 0) saveState();
  } catch {}
}

function saveState() {
  const data = {
    tasks: appState.tasks,
    categories: appState.categories,
    nextId: appState.nextId,
    theme: appState.theme,
    celebrationEffect: appState.celebrationEffect,
  };
  // Always keep localStorage as offline cache
  try { localStorage.setItem("pulselist", JSON.stringify(data)); } catch {}
  // Sync to Firestore (fire-and-forget; UI already updated from in-memory state)
  if (db && currentUser) {
    db.collection("users").doc(currentUser.uid).set(data).catch(e => {
      console.warn("Firestore save failed:", e);
    });
  }
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const ui = {};

function buildUI() {
  ui.viewButtons = [...document.querySelectorAll("[data-view]")];
  ui.viewPanels = [...document.querySelectorAll("[data-panel]")];
  ui.sidebar = document.querySelector("[data-sidebar]");
  ui.sidebarToggle = document.querySelector("[data-sidebar-toggle]");
  ui.themeToggle = document.querySelector("[data-theme-toggle]");
  ui.taskModal = document.querySelector("[data-task-modal]");
  ui.categoryModal = document.querySelector("[data-category-modal]");
  ui.settingsModal = document.querySelector("[data-settings-modal]");
  ui.openSettingsModalBtn = document.querySelector("[data-open-settings-modal]");
  ui.closeSettingsModalBtns = [...document.querySelectorAll("[data-close-settings-modal]")];
  ui.openTaskModalBtn = document.querySelector("[data-open-task-modal]");
  ui.closeTaskModalBtns = [...document.querySelectorAll("[data-close-task-modal]")];
  ui.openCategoryModalBtn = document.querySelector("[data-open-category-modal]");
  ui.closeCategoryModalBtns = [...document.querySelectorAll("[data-close-category-modal]")];
  ui.taskForm = document.querySelector("[data-task-modal] form");
  ui.taskGrid = document.querySelector(".task-grid");
  ui.searchInput = document.querySelector('.toolbar input[type="search"]');
  ui.statCards = [...document.querySelectorAll(".stat-card strong")];
  ui.notifBanner = document.querySelector(".notification-banner");
  ui.enableNotifBtn = document.querySelector(".notification-banner .button");
  ui.taskModalTitle = document.querySelector("[data-task-modal] .modal-head h2");
  ui.categoriesSection = document.querySelector("[data-categories-section]");
  ui.categoryList = document.querySelector("[data-category-list]");
  ui.addCategoryForm = document.querySelector("[data-add-category-form]");
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStatus(task) {
  if (task.done) return "done";
  if (!task.dueDate) return "active";
  const due = new Date(task.dueDate + "T" + (task.dueTime || "23:59:59"));
  return due < new Date() ? "overdue" : "active";
}

function isToday(task) {
  if (!task.dueDate) return false;
  return task.dueDate === new Date().toISOString().slice(0, 10);
}

function computeCountdown(dueDate, dueTime) {
  const due = new Date(dueDate + "T" + (dueTime || "23:59:59"));
  const diff = due - Date.now();
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 864e5);
  const h = Math.floor((abs % 864e5) / 36e5);
  const m = Math.floor((abs % 36e5) / 60e3);
  const s = Math.floor((abs % 60e3) / 1e3);
  if (diff < 0) {
    const parts = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s}s`;
    return { text: `Overdue by ${parts}`, cls: "overdue" };
  }
  const text = d ? `${d}d ${h}h remaining` : h ? `${h}h ${m}m remaining` : `${m}m ${s}s remaining`;
  return { text, cls: "" };
}

function formatCountdown(task) {
  if (task.done) return `<span class="countdown done-text">Completed</span>`;
  if (!task.dueDate) return "";
  const { text, cls } = computeCountdown(task.dueDate, task.dueTime);
  return `<span class="countdown${cls ? " " + cls : ""}" data-due="${task.dueDate}" data-due-time="${task.dueTime || ""}">${text}</span>`;
}

function tickCountdowns() {
  document.querySelectorAll(".task-grid .countdown[data-due]").forEach(el => {
    const { text, cls } = computeCountdown(el.dataset.due, el.dataset.dueTime);
    el.textContent = text;
    el.className = `countdown${cls ? " " + cls : ""}`;
  });
}

// ── Filtering ──────────────────────────────────────────────────────────────
function getVisibleTasks() {
  const q = appState.searchQuery.toLowerCase();
  return appState.tasks.filter(task => {
    if (task.archived) return false;
    const status = getStatus(task);
    if (appState.filter === "today" && !isToday(task)) return false;
    if (appState.filter === "active" && status !== "active") return false;
    if (appState.filter === "overdue" && status !== "overdue") return false;
    if (appState.filter === "blocked") return false;
    if (appState.categoryFilter && task.category !== appState.categoryFilter) return false;
    if (q && !task.title.toLowerCase().includes(q) && !(task.description || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

// ── Subtask helpers ────────────────────────────────────────────────────────
function formatSubtaskDue(dueDate) {
  const d = new Date(dueDate + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = d - today;
  const label = diff < 0
    ? `Overdue · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : diff === 0 ? "Due today"
    : diff <= 864e5 ? "Due tomorrow"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { label, overdue: diff < 0 };
}

function renderModalSubtasks() {
  const list = document.querySelector("[data-subtask-list]");
  if (!list) return;
  list.innerHTML = modalSubtasks.map(s => `
    <li class="modal-subtask-item${s.done ? " done" : ""}">
      <input type="checkbox" ${s.done ? "checked" : ""} data-modal-toggle="${s.id}">
      <span>${esc(s.title)}</span>
      <input type="date" class="subtask-date-input" value="${s.dueDate || ""}" data-subtask-date="${s.id}" title="Set due date">
      <button type="button" class="icon-button danger" data-modal-remove="${s.id}" aria-label="Remove subtask">✕</button>
    </li>`).join("");
}

function addModalSubtask() {
  const input = document.querySelector("[data-subtask-input]");
  const title = input?.value.trim();
  if (!title) return;
  modalSubtasks.push({ id: modalSubtaskNextId++, title, done: false });
  input.value = "";
  renderModalSubtasks();
  input.focus();
}

function toggleSubtask(taskId, subtaskId) {
  const task = appState.tasks.find(t => t.id === taskId);
  if (!task?.subtasks) return;
  const sub = task.subtasks.find(s => s.id === subtaskId);
  if (!sub) return;
  sub.done = !sub.done;
  saveState();
  renderAll();
}

function renderSubtasksBlock(task) {
  const subs = task.subtasks || [];
  if (!subs.length) return "";
  const done = subs.filter(s => s.done).length;
  const pct = Math.round((done / subs.length) * 100);
  return `
    <div class="subtasks-block">
      <div class="subtasks-progress-row">
        <div class="subtasks-bar-track"><div class="subtasks-bar-fill" style="width:${pct}%"></div></div>
        <span class="subtasks-count">${done}/${subs.length}</span>
      </div>
      <ul class="subtask-items">
        ${subs.map(s => {
          const due = s.dueDate && !s.done ? formatSubtaskDue(s.dueDate) : null;
          return `<li class="subtask-item${s.done ? " done" : ""}">
            <input type="checkbox" ${s.done ? "checked" : ""} data-toggle-subtask="${task.id}" data-subtask-id="${s.id}">
            <span>${esc(s.title)}</span>
            ${due ? `<span class="subtask-due${due.overdue ? " overdue" : ""}">${due.label}</span>` : ""}
          </li>`;
        }).join("")}
      </ul>
    </div>`;
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") ? url : null;
  } catch { return null; }
}

// ── Category colours ───────────────────────────────────────────────────────
const PRESET_CAT_COLORS = {
  Personal: "hsl(283,50%,62%)",
  Work:     "hsl(204,65%,55%)",
  School:   "hsl(145,52%,50%)",
  Business: "hsl(28,72%,55%)",
};

function categoryColor(name) {
  if (PRESET_CAT_COLORS[name]) return PRESET_CAT_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},58%,58%)`;
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderTaskCard(task) {
  const priority = task.priority || "Medium";
  const catColor = categoryColor(task.category || "");
  return `
    <article class="task-card${task.done ? " done" : ""}" data-task-id="${task.id}" draggable="true" data-drag-task="${task.id}" style="--cat-color:${catColor}">
      <div class="task-top">
        <span class="pill">${esc(task.category)}</span>
        <div class="task-actions">
          <button class="icon-button" type="button" data-edit-task="${task.id}" aria-label="Edit task">&#9998;</button>
          <button class="icon-button" type="button" data-duplicate-task="${task.id}" aria-label="Duplicate task">&#10064;</button>
          <button class="icon-button danger" type="button" data-delete-task="${task.id}" aria-label="Delete task">&#10005;</button>
        </div>
      </div>
      <h2>${esc(task.title)}</h2>
      ${task.description ? `<p>${esc(task.description)}</p>` : ""}
      ${task.link && safeUrl(task.link) ? `<a class="task-link" href="${esc(task.link)}" target="_blank" rel="noopener noreferrer">↗ ${esc(task.link.replace(/^https?:\/\//, "").split("/")[0])}</a>` : ""}
      ${renderSubtasksBlock(task)}
      <div class="task-meta">
        <span class="priority ${priority.toLowerCase()}">${esc(priority)} priority</span>
        ${formatCountdown(task)}
        ${!task.done ? `<button class="button button-secondary" type="button" data-complete-task="${task.id}" style="padding:0.3rem 0.75rem;min-height:unset;font-size:0.78rem;">Mark done</button>` : ""}
      </div>
    </article>`;
}

function renderGrid() {
  if (!ui.taskGrid) return;
  const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
  let tasks = getVisibleTasks();
  if (gridSort === "priority") {
    tasks = [...tasks].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority || "Medium"] ?? 1;
      const pb = PRIORITY_ORDER[b.priority || "Medium"] ?? 1;
      return pa !== pb ? pa - pb : (a.dueDate || "").localeCompare(b.dueDate || "");
    });
  } else if (gridSort === "time") {
    tasks = [...tasks].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }
  document.querySelectorAll("[data-grid-sort]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.gridSort === gridSort);
  });
  ui.taskGrid.innerHTML = tasks.length
    ? tasks.map(renderTaskCard).join("")
    : `<p style="color:var(--muted);grid-column:1/-1;padding:2rem 0;">No tasks here. Hit <strong>New task</strong> to get started.</p>`;
}

function renderTodayPanel() {
  const panel = document.querySelector('[data-panel="today"]');
  if (!panel) return;
  const overdue = appState.tasks.filter(t => !t.archived && getStatus(t) === "overdue");
  const today = appState.tasks.filter(t => !t.archived && isToday(t) && getStatus(t) !== "overdue");
  let html = "";
  if (overdue.length) {
    html += `<article class="group-card"><div class="group-head"><h2>Overdue</h2><span>${overdue.length} task${overdue.length > 1 ? "s" : ""}</span></div>${overdue.map(t => `<div class="list-card">${esc(t.title)} — ${formatCountdown(t)}</div>`).join("")}</article>`;
  }
  if (today.length) {
    html += `<article class="group-card"><div class="group-head"><h2>Due today</h2><span>${today.length} task${today.length > 1 ? "s" : ""}</span></div>${today.map(t => `<div class="list-card">${esc(t.title)} — ${formatCountdown(t)}</div>`).join("")}</article>`;
  }
  if (!html) html = `<p style="color:var(--muted);padding:2rem 0;">Nothing overdue or due today!</p>`;
  panel.innerHTML = `<div class="stack-group">${html}</div>`;
}

function generateTimelineTicks(scaleKey, now, rangeStart, rangeMs) {
  const ticks = [];
  const add = (ts, label) => {
    const pct = (ts - rangeStart) / rangeMs * 100;
    if (pct >= -1 && pct <= 101) ticks.push({ pct, label });
  };
  const fmt = (ts, opts) => new Date(ts).toLocaleDateString("en-US", opts);
  if (scaleKey === "12h") {
    for (let h = 0; h <= 12; h += 3)
      add(now + h * 36e5, h === 0 ? "Now" : new Date(now + h * 36e5).toLocaleTimeString("en-US", { hour: "numeric", hour12: true }));
  } else if (scaleKey === "7d") {
    for (let d = 0; d <= 7; d++)
      add(now + d * 864e5, d === 0 ? "Today" : fmt(now + d * 864e5, { weekday: "short", month: "short", day: "numeric" }));
  } else if (scaleKey === "1mo") {
    for (let w = 0; w <= 5; w++)
      add(now + w * 7 * 864e5, w === 0 ? "Today" : fmt(now + w * 7 * 864e5, { month: "short", day: "numeric" }));
  } else if (scaleKey === "6mo") {
    for (let m = 0; m <= 6; m++) {
      const d = new Date(now); d.setMonth(d.getMonth() + m);
      add(d.getTime(), m === 0 ? "Now" : fmt(d.getTime(), { month: "short", year: "numeric" }));
    }
  }
  return ticks;
}

function renderTimelinePanel() {
  const panel = document.querySelector('[data-panel="timeline"]');
  if (!panel) return;

  const SCALES = {
    "12h": { label: "12 Hours", ms: 12 * 36e5       },
    "7d":  { label: "7 Days",   ms: 7 * 864e5        },
    "1mo": { label: "1 Month",  ms: 30 * 864e5       },
    "6mo": { label: "6 Months", ms: 6 * 30 * 864e5   },
  };

  const scaleBar = `<div class="sort-bar">
    <span>View by:</span>
    ${Object.entries(SCALES).map(([key, s]) =>
      `<button class="sort-btn${timelineScale === key ? " is-active" : ""}" data-timeline-scale="${key}">${s.label}</button>`
    ).join("")}
  </div>`;

  const allTasks = [...appState.tasks].filter(t => t.dueDate && !t.archived).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!allTasks.length) {
    panel.innerHTML = `${scaleBar}<p style="color:var(--muted);padding:2rem 0;">No tasks with due dates yet.</p>`;
    return;
  }

  const now = Date.now();
  const scale = SCALES[timelineScale] ?? SCALES["7d"];
  const windowEnd = now + scale.ms;

  const tasks = allTasks.filter(t => new Date(t.dueDate + "T" + (t.dueTime || "23:59:59")).getTime() <= windowEnd);
  if (!tasks.length) {
    panel.innerHTML = `${scaleBar}<p style="color:var(--muted);padding:2rem 0;">No tasks due in the ${scale.label.toLowerCase()}.</p>`;
    return;
  }

  // Extend range left so overdue tasks are visible before the "now" line
  const taskTimes = tasks.map(t => new Date(t.dueDate + "T" + (t.dueTime || "23:59:59")).getTime());
  const rangeStart = Math.min(now, ...taskTimes);
  const rangeMs = windowEnd - rangeStart;
  const nowPct = (now - rangeStart) / rangeMs * 100;

  // Ruler
  const ticks = generateTimelineTicks(timelineScale, now, rangeStart, rangeMs);
  const rulerHtml = `<div class="tl-ruler">
    <div class="tl-now-mark" style="left:${nowPct.toFixed(2)}%"></div>
    ${ticks.map(t => `<div class="tl-tick" style="left:${Math.min(98, t.pct).toFixed(2)}%"><span>${t.label}</span></div>`).join("")}
  </div>`;

  // Task rows
  const rowsHtml = tasks.map(t => {
    const ts = new Date(t.dueDate + "T" + (t.dueTime || "23:59:59")).getTime();
    const taskPct = (ts - rangeStart) / rangeMs * 100;
    const isOverdue = !t.done && ts < now;
    const barColor = isOverdue ? "var(--danger)" : categoryColor(t.category || "");

    const chipPct = Math.max(1, Math.min(97, taskPct));

    return `<div class="tl-task-row">
      <div class="tl-track">
        <div class="tl-now-line" style="left:${nowPct.toFixed(2)}%"></div>
        <div class="tl-chip" style="left:${chipPct.toFixed(2)}%;background:${barColor}28;border:1.5px solid ${barColor};color:${barColor}">${esc(t.title)}</div>
      </div>
    </div>`;
  }).join("");

  panel.innerHTML = `${scaleBar}<article class="timeline-card">
    <div class="tl-ruler-row">
      ${rulerHtml}
    </div>
    ${rowsHtml}
  </article>`;
}

function renderCategorySelect() {
  const select = ui.taskForm?.querySelector('[name="category"]');
  if (!select) return;
  const current = select.value;
  select.innerHTML = appState.categories
    .map(c => `<option value="${esc(c)}"${c === current ? " selected" : ""}>${esc(c)}</option>`)
    .join("");
}

function renderSidebarCategories() {
  if (!ui.categoriesSection) return;
  const manageBtn = ui.categoriesSection.querySelector("[data-open-category-modal]");
  ui.categoriesSection.querySelectorAll("[data-category-btn]").forEach(b => b.remove());

  const fragment = document.createDocumentFragment();
  appState.categories.forEach(cat => {
    const count = appState.tasks.filter(t => t.category === cat).length;
    const btn = document.createElement("button");
    btn.className = "sidebar-item" + (appState.categoryFilter === cat ? " is-active" : "");
    btn.type = "button";
    btn.dataset.categoryBtn = cat;
    btn.innerHTML = `${esc(cat)} <span>${count}</span>`;
    btn.addEventListener("click", () => {
      appState.categoryFilter = appState.categoryFilter === cat ? null : cat;
      appState.filter = "all";
      document.querySelectorAll("[data-status-item]").forEach(b => b.classList.remove("is-active"));
      if (!appState.categoryFilter) {
        document.querySelector('[data-status-item="all"]')?.classList.add("is-active");
      }
      renderAll();
    });
    fragment.appendChild(btn);
  });

  if (manageBtn) {
    ui.categoriesSection.insertBefore(fragment, manageBtn);
  } else {
    ui.categoriesSection.appendChild(fragment);
  }
}

function renderCategoryModal() {
  if (!ui.categoryList) return;
  const canDelete = appState.categories.length > 1;
  ui.categoryList.innerHTML = appState.categories.map(cat => {
    const count = appState.tasks.filter(t => t.category === cat).length;
    return `
      <div class="list-card" style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
        <span>${esc(cat)}${count ? ` <span style="color:var(--muted);font-size:0.8rem;">(${count})</span>` : ""}</span>
        ${canDelete ? `<button class="icon-button danger" type="button" data-delete-category="${esc(cat)}" aria-label="Delete ${esc(cat)}" style="min-width:2rem;min-height:2rem;flex-shrink:0;">&#10005;</button>` : ""}
      </div>`;
  }).join("");
}

function updateStats() {
  const live = appState.tasks.filter(t => !t.archived);
  const total = live.length;
  const active = live.filter(t => getStatus(t) === "active").length;
  const overdue = live.filter(t => getStatus(t) === "overdue").length;
  const archived = appState.tasks.filter(t => t.archived).length;
  const todayCount = live.filter(t => isToday(t)).length;

  if (ui.statCards[0]) ui.statCards[0].textContent = total;
  if (ui.statCards[1]) ui.statCards[1].textContent = active;
  if (ui.statCards[2]) ui.statCards[2].textContent = overdue;
  if (ui.statCards[3]) ui.statCards[3].textContent = archived;

  const statusCounts = { all: total, today: todayCount, active, blocked: 0, overdue, done: archived };
  document.querySelectorAll("[data-status-item]").forEach(btn => {
    const span = btn.querySelector("span");
    if (span) span.textContent = statusCounts[btn.dataset.statusItem] ?? 0;
  });
}

function renderArchivePanel() {
  const panel = document.querySelector('[data-panel="archive"]');
  if (!panel) return;
  const archived = appState.tasks.filter(t => t.archived);
  if (!archived.length) {
    panel.innerHTML = `<p style="color:var(--muted);padding:2rem 0;">Your archive is empty — completed tasks will appear here.</p>`;
    return;
  }
  panel.innerHTML = `<div class="stack-group">${archived.map(t => `
    <div class="archive-card list-card">
      <div class="archive-card-info">
        <strong>${esc(t.title)}</strong>
        <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.35rem;flex-wrap:wrap;">
          <span class="pill">${esc(t.category)}</span>
          ${t.dueDate ? `<span style="font-size:0.78rem;color:var(--muted);">Due ${t.dueDate}</span>` : ""}
        </div>
        ${t.description ? `<p style="margin:0.4rem 0 0;font-size:0.83rem;color:var(--muted);">${esc(t.description)}</p>` : ""}
      </div>
      <div class="archive-card-actions">
        <button class="button button-secondary" type="button" data-recreate-task="${t.id}">Recreate</button>
        <button class="button button-secondary" type="button" data-restore-task="${t.id}">Restore</button>
        <button class="button" type="button" data-archive-delete="${t.id}" style="background:var(--danger);color:white;">Delete</button>
      </div>
    </div>`).join("")}</div>`;
}

function renderAll() {
  renderGrid();
  renderTodayPanel();
  renderTimelinePanel();
  renderArchivePanel();
  renderSidebarCategories();
  renderCategorySelect();
  updateStats();
}

// ── Celebration effects ────────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  const colors = ["#ff6b6b","#ffd93d","#6bcb77","#4d96ff","#c77dff","#ff9a3c","#ff6392","#00d2ff"];
  const pieces = Array.from({length: 160}, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    w: 7 + Math.random() * 9,
    h: 5 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 5,
    rot: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.18,
  }));
  const duration = 3500;
  let start = null;
  let raf;
  function draw(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fade = elapsed > duration * 0.55 ? Math.max(0, 1 - (elapsed - duration * 0.55) / (duration * 0.45)) : 1;
    if (fade <= 0) { canvas.remove(); return; }
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotV;
      if (p.y > canvas.height + 20) p.y = -20;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
}

function launchSparkles() {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:hidden;";
  document.body.appendChild(container);
  const symbols = ["✦","✧","★","✶","✸","✹","✺","❋","✿","❊"];
  const colors = ["#ffd93d","#ff6b6b","#6bcb77","#4d96ff","#c77dff","#ff9a3c","#00d2ff","#ff6392"];
  const count = 55;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const dist = 80 + Math.random() * Math.min(cx, cy) * 1.1;
    const size = 14 + Math.random() * 22;
    const delay = (Math.random() * 0.35).toFixed(3);
    const rotDeg = ((Math.random() - 0.5) * 720).toFixed(0);
    const shimmerSpeed = (0.12 + Math.random() * 0.18).toFixed(3);
    el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    el.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;font-size:${size}px;line-height:1;color:${colors[Math.floor(Math.random() * colors.length)]};transform:translate(-50%,-50%) scale(0);animation:sparkle-burst 1.1s ${delay}s ease-out forwards,sparkle-shimmer ${shimmerSpeed}s ${delay}s ease-in-out infinite;--dx:${(Math.cos(angle) * dist).toFixed(1)}px;--dy:${(Math.sin(angle) * dist).toFixed(1)}px;--rot:${rotDeg}deg;`;
    container.appendChild(el);
  }
  setTimeout(() => container.remove(), 2000);
}

function injectCelebrationStyles() {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes sparkle-burst{
      0%{transform:translate(-50%,-50%) scale(0) rotate(0deg);opacity:1}
      50%{opacity:1}
      100%{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.5) rotate(var(--rot));opacity:0}
    }
    @keyframes sparkle-shimmer{
      0%,100%{filter:brightness(1);}
      50%{filter:brightness(2.2) drop-shadow(0 0 6px currentColor) drop-shadow(0 0 12px currentColor);}
    }
  `;
  document.head.appendChild(style);
}

// ── Notion Integration ─────────────────────────────────────────────────────
// Deploy notion-worker.js to Cloudflare Workers, set NOTION_TOKEN and
// NOTION_DATABASE_ID as Worker environment variables, then paste the
// deployed Worker URL into Settings > Notion inside the app.

let notionProxyUrl = localStorage.getItem("notion_proxy_url") || "";

function isNotionConnected() {
  return !!notionProxyUrl;
}

async function connectNotion() {
  const input = document.getElementById("notionUrlInput");
  const url = (input?.value || "").trim().replace(/\/$/, "");
  if (!url) return;
  updateNotionUI("testing");
  try {
    const res = await fetch(url + "/ping");
    if (!res.ok) throw new Error();
  } catch {
    updateNotionUI("error");
    return;
  }
  notionProxyUrl = url;
  localStorage.setItem("notion_proxy_url", url);
  updateNotionUI("connected");
}

function disconnectNotion() {
  notionProxyUrl = "";
  localStorage.removeItem("notion_proxy_url");
  updateNotionUI();
}

function updateNotionUI(state) {
  const statusEl     = document.getElementById("notionStatus");
  const connectBtn   = document.getElementById("notionConnectBtn");
  const disconnectBtn = document.getElementById("notionDisconnectBtn");
  const urlInput     = document.getElementById("notionUrlInput");
  const connected    = state === "connected" || (!state && isNotionConnected());

  if (urlInput && state !== "testing") urlInput.value = notionProxyUrl;
  if (connectBtn)     connectBtn.hidden     = connected;
  if (disconnectBtn)  disconnectBtn.hidden  = !connected;
  if (!statusEl) return;

  if (state === "connected") {
    statusEl.textContent = "Connected!";
    statusEl.style.color = "var(--success)";
    setTimeout(() => updateNotionUI(), 2500);
    return;
  }
  if (state === "error") {
    statusEl.textContent = "Could not reach Worker — check the URL and try again.";
    statusEl.style.color = "var(--danger, #c0392b)";
    return;
  }
  if (state === "testing") {
    statusEl.textContent = "Connecting…";
    statusEl.style.color = "var(--muted)";
    return;
  }
  statusEl.textContent = connected ? "Connected" : "Not connected";
  statusEl.style.color = connected ? "var(--success)" : "var(--muted)";
}

async function notionRequest(method, path, body) {
  if (!isNotionConnected()) return null;
  try {
    const res = await fetch(notionProxyUrl + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) { console.warn("Notion proxy error:", res.status); return null; }
    return res.json();
  } catch (e) {
    console.warn("Notion request failed:", e);
    return null;
  }
}

async function syncTaskToNotion(task) {
  if (!isNotionConnected()) return;
  const payload = {
    title:       task.title,
    dueDate:     task.dueDate     || null,
    dueTime:     task.dueTime     || null,
    category:    task.category    || null,
    priority:    task.priority    || null,
    description: task.description || null,
    done:        !!task.done,
  };
  if (task.notionPageId) {
    await notionRequest("PATCH", `/task/${task.notionPageId}`, payload);
  } else {
    const result = await notionRequest("POST", "/task", payload);
    if (result?.id) {
      const i = appState.tasks.findIndex(t => t.id === task.id);
      if (i >= 0) { appState.tasks[i].notionPageId = result.id; saveState(); }
    }
  }
}

async function removeTaskFromNotion(task) {
  if (!isNotionConnected() || !task.notionPageId) return;
  await notionRequest("DELETE", `/task/${task.notionPageId}`);
}

// ── Settings modal ─────────────────────────────────────────────────────────
function openSettingsModal() {
  const sel = document.querySelector('[name="celebrationEffect"]');
  if (sel) sel.value = appState.celebrationEffect;
  updateNotionUI();
  if (ui.settingsModal) ui.settingsModal.hidden = false;
}

function closeSettingsModal() {
  if (ui.settingsModal) ui.settingsModal.hidden = true;
}

// ── CRUD ───────────────────────────────────────────────────────────────────
function createTask(data) {
  const task = { id: appState.nextId++, ...data, done: false, createdAt: Date.now() };
  appState.tasks.push(task);
  saveState();
  renderAll();
  syncTaskToNotion(task);
}

function updateTask(id, data) {
  const i = appState.tasks.findIndex(t => t.id === id);
  if (i < 0) return;
  appState.tasks[i] = { ...appState.tasks[i], ...data };
  saveState();
  renderAll();
  syncTaskToNotion(appState.tasks[i]);
}

function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  const task = appState.tasks.find(t => t.id === id);
  if (task) removeTaskFromNotion(task);
  appState.tasks = appState.tasks.filter(t => t.id !== id);
  saveState();
  renderAll();
}

function completeTask(id) {
  updateTask(id, { done: true, archived: true, archivedAt: Date.now() });
  if (appState.celebrationEffect === "confetti") launchConfetti();
  else if (appState.celebrationEffect === "sparkles") launchSparkles();
}

function restoreTask(id) {
  updateTask(id, { done: false, archived: false, archivedAt: null });
}

function deleteArchivedTask(id) {
  if (!confirm("Permanently delete this task? This cannot be undone.")) return;
  appState.tasks = appState.tasks.filter(t => t.id !== id);
  saveState();
  renderAll();
}

function duplicateTask(id) {
  const task = appState.tasks.find(t => t.id === id);
  if (!task) return;
  const copy = {
    ...task,
    id: appState.nextId++,
    title: `${task.title} (copy)`,
    done: false,
    archived: false,
    archivedAt: null,
    createdAt: Date.now(),
    subtasks: (task.subtasks || []).map(s => ({ ...s, done: false })),
  };
  appState.tasks.unshift(copy);
  saveState();
  renderAll();
}

function recreateFromArchive(id) {
  const task = appState.tasks.find(t => t.id === id);
  if (!task) return;
  const copy = {
    ...task,
    id: appState.nextId++,
    done: false,
    archived: false,
    archivedAt: null,
    createdAt: Date.now(),
    subtasks: (task.subtasks || []).map(s => ({ ...s, done: false })),
  };
  appState.tasks.unshift(copy);
  saveState();
  renderAll();
}

// ── Category CRUD ──────────────────────────────────────────────────────────
function addCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (appState.categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) return false;
  appState.categories.push(trimmed);
  saveState();
  renderAll();
  renderCategoryModal();
  return true;
}

function removeCategory(name) {
  if (appState.categories.length <= 1) return;
  const fallback = appState.categories.find(c => c !== name);
  appState.tasks = appState.tasks.map(t => t.category === name ? { ...t, category: fallback } : t);
  appState.categories = appState.categories.filter(c => c !== name);
  if (appState.categoryFilter === name) appState.categoryFilter = null;
  saveState();
  renderAll();
  renderCategoryModal();
}

// ── Task modal ─────────────────────────────────────────────────────────────
function openTaskModal(taskId = null) {
  appState.editingTaskId = taskId;
  if (ui.taskModalTitle) ui.taskModalTitle.textContent = taskId ? "Edit task" : "New task";
  if (ui.taskForm) {
    ui.taskForm.reset();
    renderCategorySelect();
    const task = taskId ? appState.tasks.find(t => t.id === taskId) : null;
    if (task) {
      ["title", "description", "category", "priority", "dueDate", "dueTime", "link"].forEach(name => {
        const el = ui.taskForm.querySelector(`[name="${name}"]`);
        if (el) el.value = task[name] ?? "";
      });
    }
    modalSubtasks = task?.subtasks ? task.subtasks.map(s => ({ ...s })) : [];
    modalSubtaskNextId = modalSubtasks.reduce((max, s) => Math.max(max, s.id + 1), 1);
    renderModalSubtasks();
  }
  if (ui.taskModal) ui.taskModal.hidden = false;
}

function closeTaskModal() {
  if (ui.taskModal) ui.taskModal.hidden = true;
  appState.editingTaskId = null;
}

function handleFormSubmit(e) {
  e.preventDefault();
  const f = ui.taskForm;
  const title = f.querySelector('[name="title"]')?.value?.trim();
  if (!title) { alert("Please enter a task title."); return; }
  const data = {
    title,
    description: f.querySelector('[name="description"]')?.value?.trim() || "",
    category: f.querySelector('[name="category"]')?.value || appState.categories[0],
    priority: f.querySelector('[name="priority"]')?.value || "Medium",
    dueDate: f.querySelector('[name="dueDate"]')?.value || "",
    dueTime: f.querySelector('[name="dueTime"]')?.value || "",
    link: f.querySelector('[name="link"]')?.value?.trim() || "",
    subtasks: modalSubtasks,
  };
  if (appState.editingTaskId) {
    updateTask(appState.editingTaskId, data);
  } else {
    createTask(data);
  }
  closeTaskModal();
}

// ── Views ──────────────────────────────────────────────────────────────────
function setView(name) {
  appState.currentView = name;
  ui.viewButtons.forEach(b => {
    const active = b.dataset.view === name;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
  ui.viewPanels.forEach(p => {
    const active = p.dataset.panel === name;
    p.classList.toggle("is-active", active);
    p.hidden = !active;
  });
  if (name === "archive") {
    document.querySelectorAll("[data-status-item]").forEach(b => b.classList.remove("is-active"));
    document.querySelector('[data-status-item="done"]')?.classList.add("is-active");
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────
function toggleTheme() {
  appState.theme = appState.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = appState.theme;
  saveState();
}

// ── Sidebar toggle ─────────────────────────────────────────────────────────
function closeSidebar() {
  appState.sidebarOpen = false;
  ui.sidebar?.classList.remove("is-open");
  document.querySelector("[data-sidebar-backdrop]")?.classList.remove("is-visible");
}

function toggleSidebar() {
  appState.sidebarOpen = !appState.sidebarOpen;
  ui.sidebar?.classList.toggle("is-open", appState.sidebarOpen);
  document.querySelector("[data-sidebar-backdrop]")?.classList.toggle("is-visible", appState.sidebarOpen);
}

// ── Status filter items (static, bound once) ───────────────────────────────
function bindStatusItems() {
  document.querySelectorAll("[data-status-item]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-status-item]").forEach(b => b.classList.remove("is-active"));
      document.querySelectorAll("[data-category-btn]").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      if (btn.dataset.statusItem === "done") {
        setView("archive");
        return;
      }
      appState.filter = btn.dataset.statusItem;
      appState.categoryFilter = null;
      if (appState.currentView === "archive") setView("grid");
      renderAll();
    });
  });
}

// ── Category modal ─────────────────────────────────────────────────────────
function openCategoryModal() {
  renderCategoryModal();
  if (ui.categoryModal) ui.categoryModal.hidden = false;
}

function closeCategoryModal() {
  if (ui.categoryModal) ui.categoryModal.hidden = true;
  if (ui.addCategoryForm) ui.addCategoryForm.reset();
}

// ── Notifications ──────────────────────────────────────────────────────────
async function enableNotifications() {
  if (!("Notification" in window)) { alert("Notifications are not supported in this browser."); return; }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    ui.notifBanner?.remove();
    new Notification("PulseList", { body: "You'll now receive task reminders." });
  }
}

// ── Event delegation for dynamically rendered task cards ───────────────────
function bindTaskCardDelegation() {
  document.addEventListener("click", e => {
    const editBtn = e.target.closest("[data-edit-task]");
    const deleteBtn = e.target.closest("[data-delete-task]");
    const completeBtn = e.target.closest("[data-complete-task]");
    const deleteCatBtn = e.target.closest("[data-delete-category]");
    const restoreBtn = e.target.closest("[data-restore-task]");
    const archiveDeleteBtn = e.target.closest("[data-archive-delete]");
    const duplicateBtn = e.target.closest("[data-duplicate-task]");
    const recreateBtn = e.target.closest("[data-recreate-task]");
    if (editBtn) openTaskModal(Number(editBtn.dataset.editTask));
    if (deleteBtn) deleteTask(Number(deleteBtn.dataset.deleteTask));
    if (completeBtn) completeTask(Number(completeBtn.dataset.completeTask));
    if (deleteCatBtn) removeCategory(deleteCatBtn.dataset.deleteCategory);
    if (restoreBtn) restoreTask(Number(restoreBtn.dataset.restoreTask));
    if (archiveDeleteBtn) deleteArchivedTask(Number(archiveDeleteBtn.dataset.archiveDelete));
    if (duplicateBtn) duplicateTask(Number(duplicateBtn.dataset.duplicateTask));
    if (recreateBtn) recreateFromArchive(Number(recreateBtn.dataset.recreateTask));
    if (e.target.matches("input[data-toggle-subtask]")) {
      toggleSubtask(Number(e.target.dataset.toggleSubtask), Number(e.target.dataset.subtaskId));
    }
    const sortBtn = e.target.closest("[data-grid-sort]");
    if (sortBtn) {
      gridSort = sortBtn.dataset.gridSort;
      renderGrid();
    }
    const scaleBtn = e.target.closest("[data-timeline-scale]");
    if (scaleBtn) {
      timelineScale = scaleBtn.dataset.timelineScale;
      renderTimelinePanel();
    }
  });
}

// ── Drag & drop ────────────────────────────────────────────────────────────
function bindDragDrop() {
  document.addEventListener("dragstart", e => {
    const card = e.target.closest("[data-drag-task]");
    if (!card) return;
    draggingTaskId = Number(card.dataset.dragTask);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(draggingTaskId));
    setTimeout(() => card.classList.add("dragging"), 0);
  });

  document.addEventListener("dragend", e => {
    const card = e.target.closest("[data-drag-task]");
    if (card) card.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    draggingTaskId = null;
  });

  ui.sidebar?.addEventListener("dragover", e => {
    if (draggingTaskId === null) return;
    const btn = e.target.closest("[data-category-btn]");
    if (!btn) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    btn.classList.add("drag-over");
  });

  ui.sidebar?.addEventListener("dragleave", e => {
    if (!e.target.closest("[data-category-btn]")) {
      document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    }
  });

  ui.sidebar?.addEventListener("drop", e => {
    const btn = e.target.closest("[data-category-btn]");
    if (!btn || draggingTaskId === null) return;
    e.preventDefault();
    btn.classList.remove("drag-over");
    const newCategory = btn.dataset.categoryBtn;
    const task = appState.tasks.find(t => t.id === draggingTaskId);
    if (task && task.category !== newCategory) {
      updateTask(draggingTaskId, { category: newCategory });
    }
    draggingTaskId = null;
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  await loadState();
  buildUI();
  injectCelebrationStyles();

  document.documentElement.dataset.theme = appState.theme;

  setView(appState.currentView);
  renderAll();
  setInterval(tickCountdowns, 1000);

  ui.viewButtons.forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));

  ui.sidebarToggle?.addEventListener("click", toggleSidebar);
  document.querySelector("[data-sidebar-backdrop]")?.addEventListener("click", closeSidebar);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 860) closeSidebar();
  });

  ui.themeToggle?.addEventListener("click", toggleTheme);

  ui.openTaskModalBtn?.addEventListener("click", () => openTaskModal());
  ui.closeTaskModalBtns.forEach(b => b.addEventListener("click", closeTaskModal));
  ui.openCategoryModalBtn?.addEventListener("click", openCategoryModal);
  ui.closeCategoryModalBtns.forEach(b => b.addEventListener("click", closeCategoryModal));
  ui.openSettingsModalBtn?.addEventListener("click", openSettingsModal);
  ui.closeSettingsModalBtns.forEach(b => b.addEventListener("click", closeSettingsModal));
  document.getElementById("notionConnectBtn")?.addEventListener("click", connectNotion);
  document.getElementById("notionDisconnectBtn")?.addEventListener("click", disconnectNotion);
  document.querySelector('[name="celebrationEffect"]')?.addEventListener("change", e => {
    appState.celebrationEffect = e.target.value;
    saveState();
  });

  [ui.taskModal, ui.categoryModal, ui.settingsModal].forEach(m => m?.addEventListener("click", e => { if (e.target === m) m.hidden = true; }));

  ui.taskForm?.addEventListener("submit", handleFormSubmit);

  ui.addCategoryForm?.addEventListener("submit", e => {
    e.preventDefault();
    const input = ui.addCategoryForm.querySelector('[name="categoryName"]');
    if (!input) return;
    const added = addCategory(input.value);
    if (added) {
      input.value = "";
    } else {
      input.select();
    }
  });

  ui.searchInput?.addEventListener("input", e => { appState.searchQuery = e.target.value; renderGrid(); });

  bindStatusItems();
  bindTaskCardDelegation();
  bindDragDrop();

  // Modal subtask events
  document.querySelector("[data-add-subtask]")?.addEventListener("click", addModalSubtask);
  document.querySelector("[data-subtask-input]")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addModalSubtask(); }
  });
  const subtaskList = document.querySelector("[data-subtask-list]");
  subtaskList?.addEventListener("change", e => {
    if (e.target.dataset.modalToggle) {
      const sub = modalSubtasks.find(s => s.id === Number(e.target.dataset.modalToggle));
      if (sub) { sub.done = e.target.checked; renderModalSubtasks(); }
    }
    if (e.target.dataset.subtaskDate) {
      const sub = modalSubtasks.find(s => s.id === Number(e.target.dataset.subtaskDate));
      if (sub) sub.dueDate = e.target.value;
    }
  });
  subtaskList?.addEventListener("click", e => {
    const btn = e.target.closest("[data-modal-remove]");
    if (!btn) return;
    modalSubtasks = modalSubtasks.filter(s => s.id !== Number(btn.dataset.modalRemove));
    renderModalSubtasks();
  });

  ui.enableNotifBtn?.addEventListener("click", enableNotifications);

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    ui.notifBanner?.remove();
  }

  document.addEventListener("click", async e => {
    if (!e.target.closest("[data-logout]")) return;
    try { if (auth) await auth.signOut(); } catch {}
    window.location.href = "pulselist-goodbye.html";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (auth) {
    auth.onAuthStateChanged(async user => {
      if (!user) {
        window.location.href = "pulselist-auth.html";
      } else {
        currentUser = user;
        await init();
      }
    });
  } else {
    // Firebase unavailable — run app without auth guard
    init();
  }
});
