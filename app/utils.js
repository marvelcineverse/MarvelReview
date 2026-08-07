const navMarkup = `
  <header class="site-header">
    <div class="site-header-main">
      <a class="brand" href="/index.html" aria-label="MarvelReview">
        <img
          class="brand-logo"
          src="https://www.marvel-cineverse.fr/medias/images/marvelreview-logov1-blanc.png"
          alt="MarvelReview"
        />
      </a>
      <button
        id="nav-toggle"
        type="button"
        class="nav-toggle"
        aria-expanded="false"
        aria-controls="primary-nav"
        aria-label="Afficher la navigation"
      >
        <span class="nav-toggle-bar" aria-hidden="true"></span>
        <span class="nav-toggle-bar" aria-hidden="true"></span>
        <span class="nav-toggle-bar" aria-hidden="true"></span>
      </button>
    </div>
    <nav id="primary-nav" class="top-nav" aria-label="Navigation principale">
      <div class="top-nav-left">
        <a class="nav-link" href="/index.html">Accueil</a>
        <a class="nav-link" href="/films.html">Films</a>
        <a class="nav-link" href="/series.html">S&eacute;ries</a>
        <a class="nav-link" href="/ranking.html">Classement</a>
        <a class="nav-link" href="/media.html">M&eacute;dias</a>
        <a class="nav-link" href="/API.html" data-admin-only="true" data-access-display="inline-flex">API</a>
        <a class="nav-link" href="/profile.html" data-auth="logged-in">Profil</a>
      </div>
      <div class="top-nav-right">
        <a class="nav-link" href="/login.html" data-auth="logged-out">Connexion</a>
        <a class="nav-link" href="/signup.html" data-auth="logged-out">Inscription</a>
        <div class="nav-user-block" data-auth="logged-in">
          <span class="nav-user-line">
            <img id="nav-user-avatar" class="nav-user-avatar" alt="" hidden />
            Connect&eacute; : <span id="nav-user-value"></span>
          </span>
          <small class="nav-user-actions">
            <a
              id="admin-link"
              class="nav-logout-link"
              href="/admin.html"
              data-admin-or-manager-only="true"
              data-access-display="inline"
              >Admin</a
            >
            <span
              class="nav-user-separator"
              data-admin-or-manager-only="true"
              data-access-display="inline"
              >&nbsp;—&nbsp;</span
            >
            <a id="logout-link" class="nav-logout-link" href="#">Se d&eacute;connecter</a>
          </small>
        </div>
        <button
          id="theme-toggle"
          type="button"
          class="theme-toggle"
          aria-label="Activer le mode sombre"
          aria-pressed="false"
        >
          <i id="theme-toggle-icon" class="fa-solid fa-moon" aria-hidden="true"></i>
        </button>
      </div>
    </nav>
  </header>
`;

export function injectLayout() {
  const navRoot = document.querySelector("#nav-root");
  if (navRoot) navRoot.innerHTML = navMarkup;
}

const THEME_STORAGE_KEY = "marvelreview:theme";

export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch (_error) {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_error) {
    // Ignore storage failures: the toggle can still work for the current page.
  }
}

export function getPreferredTheme() {
  return getStoredTheme() || "light";
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  const toggle = document.querySelector("#theme-toggle");
  const icon = document.querySelector("#theme-toggle-icon");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    toggle.setAttribute("aria-label", theme === "dark" ? "Activer le mode clair" : "Activer le mode sombre");
  }
  if (icon) {
    icon.classList.toggle("fa-moon", theme !== "dark");
    icon.classList.toggle("fa-sun", theme === "dark");
  }
}

export function initThemeToggle() {
  applyTheme(getPreferredTheme());

  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    storeTheme(nextTheme);
    applyTheme(nextTheme);
  });
}

export function getFilmIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

export function getMediaIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

export function getSeriesIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

export function getSeasonIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

export function getEpisodeIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

export function getUserIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

const AVATAR_MAX_DIMENSION = 512;
const AVATAR_JPEG_QUALITY = 0.82;

export async function compressImageFile(
  file,
  { maxDimension = AVATAR_MAX_DIMENSION, quality = AVATAR_JPEG_QUALITY } = {}
) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Compression de l'image impossible."))),
      "image/jpeg",
      quality
    );
  });

  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}

function toLocalISODate(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isReleasedOnOrBeforeToday(releaseDate) {
  if (!releaseDate || typeof releaseDate !== "string") return false;
  return releaseDate <= toLocalISODate();
}

export function getLastEpisodeAirDate(episodes) {
  if (!Array.isArray(episodes) || !episodes.length) return null;
  const lastEpisode = episodes.reduce((latest, episode) =>
    Number(episode?.episode_number || 0) > Number(latest?.episode_number || 0) ? episode : latest
  );
  return lastEpisode?.air_date || null;
}

export function buildDenseRankLabels(items, scoreAccessor, precision = null) {
  const labels = [];
  let previousScore = null;
  let rank = 0;
  let firstRankAssigned = false;

  for (const item of items) {
    const rawScore = scoreAccessor(item);
    if (!Number.isFinite(rawScore)) {
      labels.push("-");
      continue;
    }

    const score = precision === null ? rawScore : Number(rawScore.toFixed(precision));
    if (!firstRankAssigned) {
      rank = 1;
      labels.push(String(rank));
      previousScore = score;
      firstRankAssigned = true;
      continue;
    }

    if (score === previousScore) {
      labels.push("-");
      continue;
    }

    rank += 1;
    labels.push(String(rank));
    previousScore = score;
  }

  return labels;
}

export function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

export function escapeHTML(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function setMessage(targetSelector, message, isError = false) {
  const target = document.querySelector(targetSelector);
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", isError);
}

export function formatScore(value, minimumFractionDigits = 0, maximumFractionDigits = 2) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "-";
  return score.toLocaleString("fr-FR", {
    minimumFractionDigits,
    maximumFractionDigits
  });
}

export function getSeasonScoreBasisLabel(userManualScore, userAdjustment) {
  if (userManualScore !== null && userManualScore !== undefined) {
    return "Note directe de l'utilisateur";
  }

  const adjustment = Number(userAdjustment || 0);
  if (adjustment) {
    const sign = adjustment > 0 ? "+" : "-";
    return `Moyenne des épisodes ajustée (${sign} ${formatScore(Math.abs(adjustment), 2, 2)} pts)`;
  }

  return "Moyenne des épisodes";
}

export function isQuarterStep(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return false;
  const rounded = Math.round(score * 4) / 4;
  return Math.abs(score - rounded) < 0.000001;
}

export const SPOILER_WINDOW_DAYS = 14;

export function isSpoilerCurrentlyBlurred(hasSpoiler, referenceDate) {
  if (!hasSpoiler) return false;
  if (!referenceDate) return true;

  const reference = new Date(referenceDate);
  if (Number.isNaN(reference.getTime())) return true;

  const cutoff = reference.getTime() + SPOILER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() < cutoff;
}

export function renderReviewParagraph(
  reviewText,
  { hasSpoiler = false, referenceDate = null, emptyLabel = "(Pas de commentaire)", className = "" } = {}
) {
  const trimmed = String(reviewText || "").trim();
  const safeText = escapeHTML(trimmed || emptyLabel);
  const classAttr = className ? ` class="${className}"` : "";

  if (!trimmed || !isSpoilerCurrentlyBlurred(hasSpoiler, referenceDate)) {
    return `<p${classAttr}>${safeText}</p>`;
  }

  return `
    <div class="spoiler-wrap" role="button" tabindex="0" aria-label="Critique masqu&eacute;e car elle contient des spoilers. Survolez ou appuyez pour la r&eacute;v&eacute;ler.">
      <p class="spoiler-text${className ? ` ${className}` : ""}">${safeText}</p>
      <div class="spoiler-badge" aria-hidden="true">
        <span class="spoiler-badge-title">Spoiler</span>
        <span class="spoiler-badge-hint">Survolez ou touchez pour r&eacute;v&eacute;ler</span>
      </div>
    </div>
  `;
}

export function buildSpoilerCheckboxMarkup(id, { checked = false, extraAttrs = "" } = {}) {
  return `
    <label class="spoiler-checkbox-label" for="${id}">
      <input type="checkbox" id="${id}" class="spoiler-checkbox-input" ${extraAttrs} ${checked ? "checked" : ""} />
      <span>Cette critique r&eacute;v&egrave;le des &eacute;l&eacute;ments de l'intrigue (spoiler)</span>
    </label>
  `;
}

const REVIEW_EDIT_TABLE_BY_ACTIVITY_TYPE = {
  film: "ratings",
  episode: "episode_ratings",
  season: "season_user_ratings",
  series: "series_reviews"
};

export function resolveReviewEditTarget(activityType, prefixedId) {
  const table = REVIEW_EDIT_TABLE_BY_ACTIVITY_TYPE[activityType];
  if (!table) return null;

  const rawId = String(prefixedId || "").replace(/^(film|episode|season|series)-/, "");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
  if (!isUuid) return null;

  return { table, rowId: rawId };
}

export function buildAdminReviewEditButtonMarkup(table, rowId, { authorLabel = "", contentLabel = "" } = {}) {
  return `
    <button
      type="button"
      class="icon-circle-btn neutral small admin-review-edit-button"
      data-admin-review-edit="true"
      data-review-table="${escapeHTML(table)}"
      data-review-id="${escapeHTML(rowId)}"
      data-review-author="${escapeHTML(authorLabel)}"
      data-review-content="${escapeHTML(contentLabel)}"
      aria-label="Modifier cette critique (admin)"
    >
      <i class="fa-solid fa-pen" aria-hidden="true"></i>
    </button>
  `;
}

export function getScoreClass(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "stade-neutre";
  if (score <= 0.5) return "stade-0-5";

  const normalized = Math.min(Math.ceil(score * 2) / 2, 10);
  const classByStep = {
    1: "stade-1",
    1.5: "stade-1-5",
    2: "stade-2",
    2.5: "stade-2-5",
    3: "stade-3",
    3.5: "stade-3-5",
    4: "stade-4",
    4.5: "stade-4-5",
    5: "stade-5",
    5.5: "stade-5-5",
    6: "stade-6",
    6.5: "stade-6-5",
    7: "stade-7",
    7.5: "stade-7-5",
    8: "stade-8",
    8.5: "stade-8-5",
    9: "stade-9",
    9.5: "stade-9-5",
    10: "stade-10"
  };

  return classByStep[normalized] || "stade-neutre";
}

export function buildAvatarMarkup(url, imgClass) {
  const safeURL = String(url || "").trim();
  if (safeURL) {
    return `<img src="${escapeHTML(safeURL)}" alt="Photo de profil" class="${imgClass}" />`;
  }
  return `<span class="${imgClass} avatar-placeholder" aria-hidden="true"><i class="fa-solid fa-user"></i></span>`;
}

export function renderAvatarInto(selector, url, imgClass) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.innerHTML = buildAvatarMarkup(url, imgClass);
}
