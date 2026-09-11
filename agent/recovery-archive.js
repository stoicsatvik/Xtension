const REMOVED_KEY = "xtension.removed.v1";
const MAX_REMOVED = 100;

const currentById = new Map();

function normalize(item) {
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName ?? null,
    description: item.description ?? "",
    version: item.version ?? null,
    homepageUrl: item.homepageUrl ?? null,
    installType: item.installType ?? null,
    permissions: [...new Set(item.permissions ?? [])].sort(),
    hostPermissions: [...new Set(item.hostPermissions ?? [])].sort(),
    icons: item.icons ?? []
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function storeUrl(id) {
  return `https://chromewebstore.google.com/detail/${encodeURIComponent(id)}`;
}

async function readArchive() {
  const stored = await chrome.storage.local.get(REMOVED_KEY);
  return Array.isArray(stored[REMOVED_KEY]) ? stored[REMOVED_KEY] : [];
}

async function writeArchive(items) {
  const next = items.slice(0, MAX_REMOVED);
  await chrome.storage.local.set({ [REMOVED_KEY]: next });
  return next;
}

async function captureCurrentInventory() {
  const self = await chrome.management.getSelf();
  const all = await chrome.management.getAll();
  currentById.clear();
  for (const item of all) {
    if (item.id === self.id || item.type !== "extension") continue;
    currentById.set(item.id, normalize(item));
  }
}

async function archiveRemoval(id) {
  const prior = currentById.get(id);
  if (!prior) return;

  const archive = await readArchive();
  const record = {
    ...prior,
    removedAt: Date.now(),
    storeUrl: storeUrl(id)
  };
  const next = [record, ...archive.filter((item) => item.id !== id)];
  await writeArchive(next);
  currentById.delete(id);
  await renderArchive();
}

async function removeRecoveredRecord(id) {
  const archive = await readArchive();
  await writeArchive(archive.filter((item) => item.id !== id));
  await renderArchive();
}

async function forgetRecord(id) {
  const archive = await readArchive();
  await writeArchive(archive.filter((item) => item.id !== id));
  await renderArchive();
}

function bestIcon(record) {
  return [...(record.icons ?? [])].sort((a, b) => b.size - a.size)[0]?.url ?? "";
}

function relativeTime(timestamp) {
  if (!timestamp) return "unknown time";
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}

function ensureSection() {
  let section = document.querySelector("#recoveryArchiveSection");
  if (section) return section;

  section = document.createElement("section");
  section.id = "recoveryArchiveSection";
  section.innerHTML = `
    <section class="section-heading recovery-heading">
      <div>
        <div class="eyebrow">RECOVERY ARCHIVE</div>
        <h2>Removed, but not forgotten</h2>
      </div>
      <p>Xtension stores only local extension metadata so cleanup stays reversible. Reinstall still requires an explicit Chrome Web Store action.</p>
    </section>
    <section id="recoveryArchive" class="recovery-archive"></section>`;
  document.querySelector("main")?.append(section);
  return section;
}

async function renderArchive() {
  ensureSection();
  const container = document.querySelector("#recoveryArchive");
  if (!container) return;

  const archive = await readArchive();
  if (!archive.length) {
    container.innerHTML = `<div class="empty">No removed extensions archived yet. When you uninstall one, Xtension keeps a local recovery record.</div>`;
    return;
  }

  container.innerHTML = archive.map((record) => {
    const icon = bestIcon(record);
    return `
      <article class="recovery-card">
        <div class="recovery-identity">
          ${icon ? `<img src="${escapeHtml(icon)}" alt="" />` : `<div class="fallback-icon">${escapeHtml(record.name?.slice(0, 1)?.toUpperCase() || "?")}</div>`}
          <div>
            <strong>${escapeHtml(record.name)}</strong>
            <div class="meta">Removed ${escapeHtml(relativeTime(record.removedAt))}${record.version ? ` · last version ${escapeHtml(record.version)}` : ""}</div>
            <p>${escapeHtml(record.description || "No description recorded.")}</p>
          </div>
        </div>
        <div class="recovery-actions">
          <a class="button-link" href="${escapeHtml(record.storeUrl || storeUrl(record.id))}" target="_blank" rel="noopener noreferrer">Open Web Store</a>
          <button class="mini secondary" data-forget-removed="${escapeHtml(record.id)}">Forget record</button>
        </div>
      </article>`;
  }).join("");

  container.querySelectorAll("[data-forget-removed]").forEach((button) => {
    button.addEventListener("click", () => void forgetRecord(button.dataset.forgetRemoved));
  });
}

chrome.management.onUninstalled.addListener((id) => {
  void archiveRemoval(id).catch((error) => console.error("Xtension recovery archive failed", error));
});

chrome.management.onInstalled.addListener((item) => {
  if (item.type !== "extension") return;
  currentById.set(item.id, normalize(item));
  void removeRecoveredRecord(item.id).catch((error) => console.error("Xtension recovery cleanup failed", error));
});

chrome.management.onEnabled.addListener((item) => currentById.set(item.id, normalize(item)));
chrome.management.onDisabled.addListener((item) => currentById.set(item.id, normalize(item)));

await captureCurrentInventory();
await renderArchive();
