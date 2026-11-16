(() => {
  const REPO_OWNER = "tss182";
  const REPO_NAME = "dhub";
  const RELEASES_LATEST_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
  const LATEST_RELEASE_PAGE = `${RELEASES_PAGE}/latest`;
  const CACHE_KEY = "dhub_latest_release_cache_v1";
  const CACHE_TTL_MS = 5 * 60 * 1000;

  const OS_ICONS = {
    windows: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>`,
    macos: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.96 6.33c.64-.78 1.08-1.86.96-2.94-.93.04-2.06.62-2.72 1.4-.58.68-1.1 1.79-.96 2.84 1.04.08 2.08-.52 2.72-1.3"/></svg>`,
    linux: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.84-.41 1.684-.287 2.489.119.779.458 1.503 1.01 2.092.238.255.512.482.815.676-.135.424-.175.875-.049 1.326.25.894 1.158 1.484 2.138 1.484.426 0 .842-.111 1.201-.312.569.299 1.236.47 1.953.47.721 0 1.391-.173 1.963-.475.361.204.78.317 1.208.317.98 0 1.888-.59 2.138-1.484.126-.451.086-.902-.049-1.326.303-.194.577-.421.815-.676.552-.589.891-1.313 1.01-2.092.123-.805-.009-1.649-.287-2.489-.589-1.771-1.831-3.47-2.716-4.521-.75-1.067-.974-1.928-1.05-3.02-.065-1.491 1.056-5.965-3.17-6.298A5.43 5.43 0 0012.504 0zm-1.762 4.894c.385 0 .697.392.697.875s-.312.875-.697.875-.697-.392-.697-.875.312-.875.697-.875zm3.516 0c.385 0 .697.392.697.875s-.312.875-.697.875-.697-.392-.697-.875.312-.875.697-.875zm-1.758 1.88c.976 0 1.874.382 1.874.828 0 .259-.355.524-.759.736-.343.18-.74.307-1.115.307-.375 0-.772-.127-1.115-.307-.404-.212-.759-.477-.759-.736 0-.446.898-.828 1.874-.828z"/></svg>`
  };

  const I18N = {
    en: {
      "nav.downloads": "Downloads",
      "nav.databases": "Databases",
      "nav.features": "Features",
      "nav.changelog": "Release Notes",
      "hero.loading": "Fetching latest release…",
      "hero.title1": "Modern Multi-Database",
      "hero.title2": "Desktop Client",
      "hero.subtitle": "A lightweight, keyboard-first SQL & NoSQL IDE built with Go, Wails v3, and React. Fast native performance, environment safety tags, SSH tunneling, and inline data editing.",
      "hero.recommended": "Recommended for your system",
      "hero.otherPlatforms": "All platforms & architectures ↓",
      "hero.allReleases": "Previous versions on GitHub ↗",
      "downloads.title": "Download for Every Platform",
      "downloads.subtitle": "Choose the installer or portable package that matches your operating system.",
      "downloads.selectOs": "Operating System:",
      "downloads.yourOs": "Your OS",
      "downloads.tipLabel": "Tip:",
      "downloads.winTip": "User-scope installer requires no Administrator privileges.",
      "downloads.macTip": "Open the .dmg and drag DHub.app into your Applications folder.",
      "db.title": "8 Database Engines Out of the Box",
      "db.subtitle": "Connect to relational SQL warehouses and NoSQL stores from a single lightweight workspace.",
      "db.pg": "Multi-DB & schema navigation, EXPLAIN ANALYZE, routines, triggers & role privileges.",
      "db.mysql": "Multi-database browsing, routines, indexes, EXPLAIN & privilege management.",
      "db.maria": "Full MariaDB dialect formatting, ANALYZE plans & user management.",
      "db.sqlite": "Zero-config local file databases, schema designer, DDL viewer & inline editing.",
      "db.mssql": "Multi-database & schema browsing, stored procedures & T-SQL execution.",
      "db.ch": "High-speed analytical query execution, system catalog & EXPLAIN PIPELINE.",
      "db.mongo": "BSON schema inference, Mongo Shell methods, SQL-like SELECT & inline editing.",
      "db.redis": "Logical DB switcher (db0–db15), key scanner with TTL badges & Redis CLI.",
      "features.title": "Built for Speed & Safety",
      "features.subtitle": "Designed for engineers who live in the keyboard and need confidence when touching production.",
      "features.f1Title": "PROD / DEV Safety Tags",
      "features.f1Desc": "Visual tab tinting, Read-Only locks, and Dangerous Query Guards intercepting UPDATE/DELETE without WHERE.",
      "features.f2Title": "SSH Tunnel & OS Keyring",
      "features.f2Desc": "Connect through bastion hosts with TOFU known_hosts verification and native OS Keyring secret storage.",
      "features.f3Title": "Smart Monaco Query Console",
      "features.f3Desc": "Context-aware SQL autocomplete, parameter binding, transaction control (AUTO/MANUAL), and dialect formatting.",
      "features.f4Title": "Inline Grid & DML Preview",
      "features.f4Desc": "Edit cells inline, duplicate rows, copy as SQL INSERT/UPSERT/JSON, and preview exact DML before applying.",
      "features.f5Title": "ER Diagrams & Schema Diff",
      "features.f5Desc": "Interactive ER canvas, visual Table Structure Designer, and cross-connection Schema Diff migration generator.",
      "features.f6Title": "Built-in Auto-Updater",
      "features.f6Desc": "Check for new GitHub Releases directly from Settings and download/install updates in-app.",
      "changelog.kicker": "Latest Release",
      "changelog.viewOnGithub": "View on GitHub ↗",
      "changelog.loading": "Fetching release notes from GitHub…"
    },
    id: {
      "nav.downloads": "Unduh",
      "nav.databases": "Database",
      "nav.features": "Fitur",
      "nav.changelog": "Catatan Rilis",
      "hero.loading": "Mengambil versi terbaru…",
      "hero.title1": "Klien Desktop Multi-Database",
      "hero.title2": "Modern & Cepat",
      "hero.subtitle": "IDE SQL & NoSQL ringan berbasis keyboard yang dibangun dengan Go, Wails v3, dan React. Performa native cepat, tag keamanan lingkungan, SSH tunnel, dan edit data langsung.",
      "hero.recommended": "Direkomendasikan untuk sistem Anda",
      "hero.otherPlatforms": "Semua platform & arsitektur ↓",
      "hero.allReleases": "Versi sebelumnya di GitHub ↗",
      "downloads.title": "Unduh untuk Semua Platform",
      "downloads.subtitle": "Pilih installer atau paket portabel yang sesuai dengan sistem operasi Anda.",
      "downloads.selectOs": "Sistem Operasi:",
      "downloads.yourOs": "OS Anda",
      "downloads.tipLabel": "Tips:",
      "downloads.winTip": "Installer user-scope tidak memerlukan hak akses Administrator.",
      "downloads.macTip": "Buka file .dmg lalu seret DHub.app ke folder Applications.",
      "db.title": "Mendukung 8 Engine Database",
      "db.subtitle": "Terhubung ke database relasional SQL dan NoSQL dari satu workspace yang ringan.",
      "db.pg": "Navigasi multi-DB & schema, EXPLAIN ANALYZE, routine, trigger & hak akses role.",
      "db.mysql": "Jelajah multi-database, routine, index, EXPLAIN & manajemen privilege.",
      "db.maria": "Format dialek MariaDB lengkap, ANALYZE plan & manajemen pengguna.",
      "db.sqlite": "Database file lokal tanpa konfigurasi, schema designer, DDL viewer & edit inline.",
      "db.mssql": "Jelajah multi-database & schema, stored procedure & eksekusi T-SQL.",
      "db.ch": "Eksekusi query analitik super cepat, katalog sistem & EXPLAIN PIPELINE.",
      "db.mongo": "Inferensi skema BSON, metode Mongo Shell, sintaks SELECT & edit dokumen langsung.",
      "db.redis": "Switcher DB logis (db0–db15), pemindai key dengan badge TTL & Redis CLI.",
      "features.title": "Dibuat untuk Kecepatan & Keamanan",
      "features.subtitle": "Dirancang untuk engineer yang mengutamakan shortcut keyboard dan keamanan saat mengakses production.",
      "features.f1Title": "Tag Keamanan PROD / DEV",
      "features.f1Desc": "Pewarnaan tab otomatis, mode Read-Only, dan proteksi query berbahaya untuk UPDATE/DELETE tanpa WHERE.",
      "features.f2Title": "SSH Tunnel & OS Keyring",
      "features.f2Desc": "Koneksi aman melalui bastion host dengan verifikasi TOFU known_hosts dan penyimpanan kredensial di OS Keyring.",
      "features.f3Title": "Query Console Monaco Pintar",
      "features.f3Desc": "Autocomplete SQL kontekstual, binding parameter, kontrol transaksi (AUTO/MANUAL), dan formatter dialek.",
      "features.f4Title": "Grid Inline & Pratinjau DML",
      "features.f4Desc": "Edit sel langsung, duplikasi baris, salin sebagai SQL INSERT/UPSERT/JSON, dan pratinjau SQL sebelum disimpan.",
      "features.f5Title": "Diagram ER & Schema Diff",
      "features.f5Desc": "Kanvas ER interaktif, Table Structure Designer visual, dan generator migrasi Schema Diff antar koneksi.",
      "features.f6Title": "Auto-Updater Bawaan",
      "features.f6Desc": "Cek rilis GitHub terbaru langsung dari Settings serta unduh dan pasang pembaruan di dalam aplikasi.",
      "changelog.kicker": "Rilis Terbaru",
      "changelog.viewOnGithub": "Lihat di GitHub ↗",
      "changelog.loading": "Mengambil catatan rilis dari GitHub…"
    }
  };

  let currentLang = (navigator.language || "").toLowerCase().startsWith("id") ? "id" : "en";

  function applyLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    const toggleLabel = document.getElementById("lang-label");
    if (toggleLabel) {
      toggleLabel.textContent = lang === "en" ? "ID" : "EN";
    }
    const dict = I18N[lang];
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });
  }

  function detectPlatform() {
    const ua = (navigator.userAgent || "").toLowerCase();
    const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();

    let os = "windows";
    let isKnown = false;

    if (ua.includes("android") || ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
      // Mobile / non-desktop OS: fallback default to Windows
      os = "windows";
      isKnown = false;
    } else if (platform.includes("mac") || ua.includes("mac os") || ua.includes("macintosh")) {
      os = "macos";
      isKnown = true;
    } else if (platform.includes("win") || ua.includes("windows")) {
      os = "windows";
      isKnown = true;
    } else if (platform.includes("linux") || ua.includes("linux") || ua.includes("x11")) {
      os = "linux";
      isKnown = true;
    }

    const isArm = ua.includes("arm64") || ua.includes("aarch64") || platform.includes("arm");
    return { os, arch: isArm ? "arm64" : "amd64", isKnown };
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat(currentLang === "id" ? "id-ID" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(new Date(iso));
    } catch {
      return iso.slice(0, 10);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSimpleMarkdown(md) {
    if (!md || !md.trim()) {
      return `<p class="muted">${currentLang === "id" ? "Tidak ada catatan rilis tambahan." : "No additional release notes provided."}</p>`;
    }

    const lines = escapeHtml(md).split(/\r?\n/);
    let html = "";
    let inList = false;

    const formatInline = (text) =>
      text
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        continue;
      }

      if (line.startsWith("### ")) {
        if (inList) { html += "</ul>"; inList = false; }
        html += `<h4>${formatInline(line.slice(4))}</h4>`;
      } else if (line.startsWith("## ")) {
        if (inList) { html += "</ul>"; inList = false; }
        html += `<h3>${formatInline(line.slice(3))}</h3>`;
      } else if (line.startsWith("# ")) {
        if (inList) { html += "</ul>"; inList = false; }
        html += `<h2>${formatInline(line.slice(2))}</h2>`;
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += `<li>${formatInline(line.slice(2))}</li>`;
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        html += `<p>${formatInline(line)}</p>`;
      }
    }

    if (inList) html += "</ul>";
    return html;
  }

  function categorizeAssets(assets) {
    const groups = { windows: [], macos: [], linux: [] };

    for (const asset of assets) {
      const name = asset.name.toLowerCase();

      if (name.endsWith(".exe")) {
        const isInstaller = name.includes("installer");
        const isArm = name.includes("arm64");
        const archLabel = isArm ? "ARM64" : "x64";
        groups.windows.push({
          ...asset,
          label: isInstaller ? `Windows Installer (${archLabel})` : `Portable Executable (${archLabel})`,
          recommended: isInstaller && !isArm,
          priority: (isInstaller ? 0 : 10) + (isArm ? 2 : 0),
          arch: isArm ? "arm64" : "amd64",
          isInstaller
        });
      } else if (name.endsWith(".dmg") || (name.endsWith(".zip") && name.includes("macos"))) {
        const isDmg = name.endsWith(".dmg");
        groups.macos.push({
          ...asset,
          label: isDmg ? "macOS Disk Image (.dmg)" : "macOS App Bundle (.app.zip)",
          recommended: isDmg,
          priority: isDmg ? 0 : 5,
          arch: "universal",
          isInstaller: isDmg
        });
      } else if (name.endsWith(".deb") || name.endsWith(".rpm") || name.endsWith(".appimage")) {
        const isDeb = name.endsWith(".deb");
        const isRpm = name.endsWith(".rpm");
        groups.linux.push({
          ...asset,
          label: isDeb ? "Debian / Ubuntu (.deb)" : isRpm ? "Fedora / RHEL (.rpm)" : "Linux AppImage",
          recommended: isDeb,
          priority: isDeb ? 0 : isRpm ? 2 : 4,
          arch: "amd64",
          isInstaller: isDeb || isRpm
        });
      }
    }

    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => a.priority - b.priority);
    });

    return groups;
  }

  function renderAssetList(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!items.length) {
      el.innerHTML = `
        <a href="${LATEST_RELEASE_PAGE}" target="_blank" rel="noopener noreferrer" class="asset-btn">
          <span class="asset-info">
            <span class="asset-label">Download from GitHub Releases</span>
            <span class="asset-meta">Open release assets page ↗</span>
          </span>
        </a>`;
      return;
    }

    el.innerHTML = items
      .map((item) => {
        const sizeText = formatBytes(item.size);
        const dlCount = typeof item.download_count === "number" && item.download_count > 0
          ? ` • ${item.download_count.toLocaleString()} downloads`
          : "";
        const recBadge = item.recommended ? `<span class="rec-pill">Recommended</span>` : "";

        return `
          <a href="${item.browser_download_url}" class="asset-btn ${item.recommended ? "is-recommended" : ""}">
            <span class="asset-info">
              <span class="asset-label">${escapeHtml(item.label)} ${recBadge}</span>
              <span class="asset-meta">${escapeHtml(item.name)}${sizeText ? ` • ${sizeText}` : ""}${dlCount}</span>
            </span>
            <svg class="icon-18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>`;
      })
      .join("");
  }

  const ALL_OS = ["windows", "macos", "linux"];

  function updateHeroCTA(selectedOs, arch, groups, tagName) {
    const primaryBtn = document.getElementById("primary-download-btn");
    const primaryTitle = document.getElementById("primary-download-title");
    const primaryMeta = document.getElementById("primary-download-meta");
    const primaryOsIcon = document.getElementById("primary-os-icon");
    const secondaryBtn = document.getElementById("secondary-download-btn");
    const secondaryText = document.getElementById("secondary-download-text");
    const versionChip = document.getElementById("hero-version-tag");

    if (versionChip && tagName) {
      versionChip.textContent = tagName;
    }

    if (primaryOsIcon) {
      primaryOsIcon.innerHTML = OS_ICONS[selectedOs] || OS_ICONS.windows;
    }

    const osAssets = groups[selectedOs] || [];
    let best = osAssets.find((a) => a.isInstaller && a.arch === arch)
      || osAssets.find((a) => a.recommended)
      || osAssets[0];

    if (best && primaryBtn && primaryTitle && primaryMeta) {
      primaryBtn.href = best.browser_download_url;
      const osDisplay = selectedOs === "macos" ? "macOS" : selectedOs === "linux" ? "Linux" : "Windows";
      primaryTitle.textContent = currentLang === "id"
        ? `Unduh untuk ${osDisplay}`
        : `Download for ${osDisplay}`;
      const sizeStr = formatBytes(best.size);
      primaryMeta.textContent = `${best.name}${sizeStr ? ` (${sizeStr})` : ""}`;

      const alt = osAssets.find((a) => a.name !== best.name);
      if (alt && secondaryBtn && secondaryText) {
        secondaryBtn.href = alt.browser_download_url;
        secondaryText.textContent = alt.label;
        secondaryBtn.classList.remove("hidden");
      } else if (secondaryBtn) {
        secondaryBtn.classList.add("hidden");
      }
    } else if (primaryBtn && primaryTitle && primaryMeta) {
      primaryBtn.href = LATEST_RELEASE_PAGE;
      primaryTitle.textContent = currentLang === "id" ? "Unduh DHub Terbaru" : "Download Latest DHub";
      primaryMeta.textContent = "GitHub Releases ↗";
      if (secondaryBtn) secondaryBtn.classList.add("hidden");
    }
  }

  function applySelectedOS(selectedOs, detected, groups, tagName) {
    const osSelector = document.getElementById("os-selector");
    if (osSelector) {
      osSelector.value = selectedOs;
    }

    for (const os of ALL_OS) {
      const card = document.getElementById(`card-${os}`);
      if (!card) continue;

      if (os === selectedOs) {
        card.classList.remove("hidden");
        const isDetected = detected.isKnown && os === detected.os;
        card.classList.toggle("is-detected", isDetected);
        const tag = card.querySelector(".detected-tag");
        if (tag) tag.classList.toggle("hidden", !isDetected);
      } else {
        card.classList.add("hidden");
      }
    }

    updateHeroCTA(selectedOs, detected.arch, groups, tagName);
  }

  async function fetchLatestRelease() {
    try {
      const cachedRaw = sessionStorage.getItem(CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (Date.now() - cached.ts < CACHE_TTL_MS && cached.data) {
          return cached.data;
        }
      }
    } catch {
      // Ignore storage errors
    }

    const res = await fetch(RELEASES_LATEST_API, {
      headers: { Accept: "application/vnd.github.v3+json" }
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}`);
    }
    const data = await res.json();

    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {
      // Ignore storage errors
    }
    return data;
  }

  function setupCopyButtons() {
    document.querySelectorAll("[data-copy-target]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const targetId = btn.getAttribute("data-copy-target");
        const target = document.getElementById(targetId);
        if (!target) return;
        try {
          await navigator.clipboard.writeText(target.textContent.trim());
          btn.classList.add("copied");
          setTimeout(() => btn.classList.remove("copied"), 1500);
        } catch {
          // Fallback ignore
        }
      });
    });
  }

  async function init() {
    applyLanguage(currentLang);
    setupCopyButtons();

    const detected = detectPlatform();
    let activeOs = detected.os;
    let activeGroups = { windows: [], macos: [], linux: [] };
    let activeTag = "Latest";

    // Show detected OS (or Windows fallback) immediately before API resolves
    applySelectedOS(activeOs, detected, activeGroups, activeTag);

    const osSelector = document.getElementById("os-selector");
    if (osSelector) {
      osSelector.addEventListener("change", (e) => {
        activeOs = e.target.value;
        applySelectedOS(activeOs, detected, activeGroups, activeTag);
      });
    }

    const langToggle = document.getElementById("lang-toggle");
    if (langToggle) {
      langToggle.addEventListener("click", () => {
        applyLanguage(currentLang === "en" ? "id" : "en");
        applySelectedOS(activeOs, detected, activeGroups, activeTag);
      });
    }

    try {
      const release = await fetchLatestRelease();
      activeTag = release.tag_name || "Latest";
      const published = formatDate(release.published_at);

      const navPill = document.getElementById("nav-version-pill");
      if (navPill) navPill.textContent = activeTag;

      const badgeText = document.getElementById("hero-badge-text");
      if (badgeText) {
        badgeText.removeAttribute("data-i18n");
        badgeText.textContent = published
          ? `Latest Release ${activeTag} • ${published}`
          : `Latest Release ${activeTag}`;
      }

      activeGroups = categorizeAssets(release.assets || []);
      renderAssetList("assets-windows", activeGroups.windows);
      renderAssetList("assets-macos", activeGroups.macos);
      renderAssetList("assets-linux", activeGroups.linux);

      // Update Linux CLI snippet with exact .deb filename if present
      const debAsset = activeGroups.linux.find((a) => a.name.endsWith(".deb"));
      const linuxCli = document.getElementById("linux-cli-cmd");
      if (debAsset && linuxCli) {
        linuxCli.textContent = `sudo apt install ./${debAsset.name}`;
      }

      applySelectedOS(activeOs, detected, activeGroups, activeTag);

      const relTitle = document.getElementById("release-title");
      const relMeta = document.getElementById("release-meta");
      const relBody = document.getElementById("release-body");
      const relLink = document.getElementById("release-github-link");

      if (relTitle) relTitle.textContent = release.name || `Release ${activeTag}`;
      if (relMeta) relMeta.textContent = published ? `Published on ${published} • Tag ${activeTag}` : `Tag ${activeTag}`;
      if (relBody) relBody.innerHTML = renderSimpleMarkdown(release.body);
      if (relLink && release.html_url) relLink.href = release.html_url;
    } catch (err) {
      console.warn("Failed to load GitHub release:", err);
      const warning = document.getElementById("api-warning");
      if (warning) warning.classList.remove("hidden");

      const badgeText = document.getElementById("hero-badge-text");
      if (badgeText) {
        badgeText.removeAttribute("data-i18n");
        badgeText.textContent = "GitHub Releases • Latest Version";
      }

      renderAssetList("assets-windows", []);
      renderAssetList("assets-macos", []);
      renderAssetList("assets-linux", []);
      applySelectedOS(activeOs, detected, activeGroups, activeTag);

      const relTitle = document.getElementById("release-title");
      const relBody = document.getElementById("release-body");
      if (relTitle) relTitle.textContent = "View Releases on GitHub";
      if (relBody) {
        relBody.innerHTML = `<p>Live release notes are temporarily unavailable. <a href="${LATEST_RELEASE_PAGE}" target="_blank" rel="noopener noreferrer">Open the latest release on GitHub ↗</a>.</p>`;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
