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
          <span class="nav-user-line">Connect&eacute; : <span id="nav-user-value"></span></span>
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
      </div>
    </nav>
  </header>
`;

export function injectLayout() {
  const navRoot = document.querySelector("#nav-root");
  if (navRoot) navRoot.innerHTML = navMarkup;
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

export function isQuarterStep(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return false;
  const rounded = Math.round(score * 4) / 4;
  return Math.abs(score - rounded) < 0.000001;
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
