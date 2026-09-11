const REMOVED_KEY = "xtension.removed.v1";
const MAX_REMOVED = 100;

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

async function forgetRecord(id) {
  const archive = await readArchive();
  await writeArchive(archive.filter((item) => item.id !== id));
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
    button.addEventListener("click", async () => {
      await forgetRecord(button.dataset.forgetRemoved);
    });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[REMOVED_KEY]) {
    void renderArchive().catch((error) => console.error("Xtension recovery archive render failed", error));
  }
});

await renderArchive();
