// ============================================================
//  DIARIO PERSONAL — app.js
//  Almacenamiento en la nube via GitHub API
// ============================================================

// ============================================================
//  CONFIGURACIÓN
// ============================================================
const CONFIG = {
  SECURITY_KEY: "2052120S.S.C",
  SESSION_KEY: "diary_unlocked",
  GITHUB_OWNER: "fw-sebas404",
  GITHUB_REPO: "Diario",
  GITHUB_FILE: "data.json",
  GITHUB_BRANCH: "main",
  // Token cargado desde config.js (no incluido en el repositorio)
  GITHUB_TOKEN: window.DIARY_TOKEN || "",
};

// ============================================================
//  ESTADO DE LA APP
// ============================================================
let entries = [];
let currentEntryId = null;
let saveTimeout = null;
let fileSha = null; // SHA del archivo data.json en GitHub
let isSyncing = false;

// ============================================================
//  REFERENCIAS DOM
// ============================================================
const lockScreen      = document.getElementById("lockScreen");
const appEl           = document.getElementById("app");
const passwordInput   = document.getElementById("passwordInput");
const unlockBtn       = document.getElementById("unlockBtn");
const errorMsg        = document.getElementById("errorMsg");

const newEntryBtn     = document.getElementById("newEntryBtn");
const newEntryBtnMain = document.getElementById("newEntryBtnMain");
const lockBtn         = document.getElementById("lockBtn");
const exitBtn         = document.getElementById("exitBtn");
const exitBtnLock     = document.getElementById("exitBtnLock");
const sidebarToggle   = document.getElementById("sidebarToggle");
const sidebar         = document.getElementById("sidebar");
const searchInput     = document.getElementById("searchInput");
const entriesList     = document.getElementById("entriesList");

const emptyEditor     = document.getElementById("emptyEditor");
const entryEditor     = document.getElementById("entryEditor");
const entryTitle      = document.getElementById("entryTitle");
const entryContent    = document.getElementById("entryContent");
const entryMeta       = document.getElementById("entryMeta");
const saveBtn         = document.getElementById("saveBtn");
const deleteBtn       = document.getElementById("deleteBtn");
const saveStatus      = document.getElementById("saveStatus");

const deleteModal     = document.getElementById("deleteModal");
const confirmDelete   = document.getElementById("confirmDelete");
const cancelDelete    = document.getElementById("cancelDelete");

// ============================================================
//  GITHUB API — ALMACENAMIENTO EN LA NUBE
// ============================================================
const GH_API = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.GITHUB_FILE}`;

async function ghHeaders() {
  return {
    "Authorization": `Bearer ${CONFIG.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function loadFromCloud() {
  try {
    setSaveStatus("saving", "☁️ Cargando desde la nube...");
    const res = await fetch(`${GH_API}?ref=${CONFIG.GITHUB_BRANCH}&t=${Date.now()}`, {
      headers: await ghHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    fileSha = json.sha;
    const decoded = atob(json.content.replace(/\n/g, ""));
    const data = JSON.parse(decoded);
    entries = Array.isArray(data.entries) ? data.entries : [];
    // Guardar copia local como caché
    localStorage.setItem("diary_cache", JSON.stringify({ entries, sha: fileSha }));
    setSaveStatus("", "");
    return true;
  } catch (err) {
    console.warn("No se pudo cargar desde la nube:", err.message);
    // Intentar caché local
    try {
      const cache = JSON.parse(localStorage.getItem("diary_cache") || "{}");
      if (cache.entries) {
        entries = cache.entries;
        fileSha = cache.sha || null;
        setSaveStatus("error", "⚠️ Modo sin conexión (datos locales)");
        setTimeout(() => setSaveStatus("", ""), 4000);
        return true;
      }
    } catch {}
    entries = [];
    setSaveStatus("", "");
    return false;
  }
}

async function saveToCloud() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const data = JSON.stringify({ entries }, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(data)));
    const body = {
      message: `Actualizar diario — ${new Date().toLocaleString("es-ES")}`,
      content: encoded,
      branch: CONFIG.GITHUB_BRANCH,
    };
    if (fileSha) body.sha = fileSha;

    const res = await fetch(GH_API, {
      method: "PUT",
      headers: await ghHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      // Si hay conflicto de SHA, recargar y reintentar
      if (res.status === 409 || (errData.message && errData.message.includes("sha"))) {
        await refreshSha();
        isSyncing = false;
        return saveToCloud();
      }
      throw new Error(`HTTP ${res.status}: ${errData.message || ""}`);
    }

    const result = await res.json();
    fileSha = result.content.sha;
    // Actualizar caché local
    localStorage.setItem("diary_cache", JSON.stringify({ entries, sha: fileSha }));
    return true;
  } catch (err) {
    console.error("Error guardando en la nube:", err.message);
    // Guardar en caché local de todas formas
    localStorage.setItem("diary_cache", JSON.stringify({ entries, sha: fileSha }));
    throw err;
  } finally {
    isSyncing = false;
  }
}

async function refreshSha() {
  try {
    const res = await fetch(`${GH_API}?ref=${CONFIG.GITHUB_BRANCH}&t=${Date.now()}`, {
      headers: await ghHeaders(),
    });
    if (res.ok) {
      const json = await res.json();
      fileSha = json.sha;
      const decoded = atob(json.content.replace(/\n/g, ""));
      const data = JSON.parse(decoded);
      entries = Array.isArray(data.entries) ? data.entries : entries;
    }
  } catch {}
}

// ============================================================
//  AUTENTICACIÓN POR CLAVE
// ============================================================
function checkSession() {
  return sessionStorage.getItem(CONFIG.SESSION_KEY) === "true";
}

async function unlock() {
  const val = passwordInput.value.trim();
  if (val === CONFIG.SECURITY_KEY) {
    sessionStorage.setItem(CONFIG.SESSION_KEY, "true");
    lockScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    errorMsg.classList.add("hidden");
    await initApp();
  } else {
    errorMsg.classList.remove("hidden");
    passwordInput.value = "";
    passwordInput.focus();
    errorMsg.style.animation = "none";
    requestAnimationFrame(() => {
      errorMsg.style.animation = "shake 0.4s ease";
    });
  }
}

function lockApp() {
  sessionStorage.removeItem(CONFIG.SESSION_KEY);
  location.reload();
}

const closeApp = () => {
  window.close();
  // Fallback por si window.close() es bloqueado por el navegador
  setTimeout(() => {
    alert("Para salir, cierra esta pestaña del navegador.");
  }, 300);
};

unlockBtn.addEventListener("click", unlock);
passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlock();
});
lockBtn.addEventListener("click", lockApp);
exitBtn.addEventListener("click", closeApp);
exitBtnLock.addEventListener("click", closeApp);

// ============================================================
//  INICIALIZACIÓN
// ============================================================
async function initApp() {
  await loadFromCloud();
  renderEntriesList(entries);
}

// Verificar sesión al cargar
if (checkSession()) {
  lockScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  initApp();
}

// ============================================================
//  SIDEBAR TOGGLE (MOBILE)
// ============================================================
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if (
    sidebar.classList.contains("open") &&
    !sidebar.contains(e.target) &&
    e.target !== sidebarToggle
  ) {
    sidebar.classList.remove("open");
  }
});

// ============================================================
//  RENDERIZAR LISTA DE ENTRADAS
// ============================================================
function renderEntriesList(list) {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? list.filter(
        (e) =>
          (e.title || "").toLowerCase().includes(q) ||
          (e.content || "").toLowerCase().includes(q)
      )
    : list;

  // Ordenar por fecha de actualización (más reciente primero)
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );

  if (sorted.length === 0) {
    entriesList.innerHTML =
      '<li class="empty-state">No hay entradas aún.<br/>¡Crea tu primera!</li>';
    return;
  }

  entriesList.innerHTML = sorted
    .map((entry) => {
      const date = formatDate(entry.updatedAt);
      const preview = (entry.content || "").replace(/\n/g, " ").slice(0, 60);
      const isActive = entry.id === currentEntryId ? "active" : "";
      return `
        <li class="entry-item ${isActive}" data-id="${entry.id}">
          <div class="entry-item-title">${escapeHtml(entry.title || "Sin título")}</div>
          <div class="entry-item-date">${date}</div>
          ${preview ? `<div class="entry-item-preview">${escapeHtml(preview)}…</div>` : ""}
        </li>`;
    })
    .join("");

  entriesList.querySelectorAll(".entry-item").forEach((item) => {
    item.addEventListener("click", () => {
      openEntry(item.dataset.id);
      sidebar.classList.remove("open");
    });
  });
}

searchInput.addEventListener("input", () => renderEntriesList(entries));

// ============================================================
//  ABRIR ENTRADA
// ============================================================
function openEntry(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;

  currentEntryId = id;
  emptyEditor.classList.add("hidden");
  entryEditor.classList.remove("hidden");

  entryTitle.value = entry.title || "";
  entryContent.value = entry.content || "";
  entryMeta.textContent = `Última edición: ${formatDate(entry.updatedAt)}`;
  saveStatus.textContent = "";
  saveStatus.className = "save-status";

  renderEntriesList(entries);
}

// ============================================================
//  NUEVA ENTRADA
// ============================================================
async function createNewEntry() {
  const id = "entry_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  const now = new Date().toISOString();
  const newEntry = {
    id,
    title: "",
    content: "",
    createdAt: now,
    updatedAt: now,
  };

  entries.unshift(newEntry);
  currentEntryId = id;

  emptyEditor.classList.add("hidden");
  entryEditor.classList.remove("hidden");
  entryTitle.value = "";
  entryContent.value = "";
  entryMeta.textContent = "Nueva entrada";
  saveStatus.textContent = "";

  renderEntriesList(entries);
  entryTitle.focus();
  sidebar.classList.remove("open");

  // Guardar en la nube inmediatamente
  try {
    setSaveStatus("saving", "☁️ Guardando...");
    await saveToCloud();
    setSaveStatus("saved", "✓ Guardado en la nube");
    clearStatusAfter(3000);
  } catch {
    setSaveStatus("error", "⚠️ Guardado localmente");
    clearStatusAfter(4000);
  }
}

newEntryBtn.addEventListener("click", createNewEntry);
newEntryBtnMain.addEventListener("click", createNewEntry);

// ============================================================
//  GUARDAR ENTRADA
// ============================================================
async function saveCurrentEntry() {
  if (!currentEntryId) return;

  const title = entryTitle.value.trim();
  const content = entryContent.value;
  const now = new Date().toISOString();

  const idx = entries.findIndex((e) => e.id === currentEntryId);
  if (idx === -1) return;

  entries[idx].title = title || "Sin título";
  entries[idx].content = content;
  entries[idx].updatedAt = now;

  entryMeta.textContent = `Última edición: ${formatDate(now)}`;
  renderEntriesList(entries);

  setSaveStatus("saving", "☁️ Guardando en la nube...");
  try {
    await saveToCloud();
    setSaveStatus("saved", "✓ Guardado en la nube");
    clearStatusAfter(3000);
  } catch (err) {
    setSaveStatus("error", "⚠️ Error al guardar en la nube");
    clearStatusAfter(5000);
  }
}

saveBtn.addEventListener("click", saveCurrentEntry);

// Auto-guardado al escribir (debounce 2.5s)
function scheduleAutoSave() {
  clearTimeout(saveTimeout);
  setSaveStatus("saving", "Guardando automáticamente...");
  saveTimeout = setTimeout(saveCurrentEntry, 2500);
}

entryTitle.addEventListener("input", scheduleAutoSave);
entryContent.addEventListener("input", scheduleAutoSave);

// Guardar con Ctrl+S / Cmd+S
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    clearTimeout(saveTimeout);
    saveCurrentEntry();
  }
});

// ============================================================
//  ELIMINAR ENTRADA
// ============================================================
deleteBtn.addEventListener("click", () => {
  deleteModal.classList.remove("hidden");
});

cancelDelete.addEventListener("click", () => {
  deleteModal.classList.add("hidden");
});

confirmDelete.addEventListener("click", async () => {
  deleteModal.classList.add("hidden");
  if (!currentEntryId) return;

  entries = entries.filter((e) => e.id !== currentEntryId);
  currentEntryId = null;

  entryEditor.classList.add("hidden");
  emptyEditor.classList.remove("hidden");
  renderEntriesList(entries);

  setSaveStatus("saving", "☁️ Sincronizando...");
  try {
    await saveToCloud();
    setSaveStatus("", "");
  } catch {
    setSaveStatus("error", "⚠️ Error al sincronizar");
    clearStatusAfter(4000);
  }
});

// ============================================================
//  UTILIDADES
// ============================================================
function setSaveStatus(type, msg) {
  saveStatus.textContent = msg;
  saveStatus.className = `save-status ${type}`;
}

function clearStatusAfter(ms) {
  setTimeout(() => {
    saveStatus.textContent = "";
    saveStatus.className = "save-status";
  }, ms);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date)) return "";
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
