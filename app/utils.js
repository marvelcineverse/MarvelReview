const navMarkup = `
  <header class="site-header">
    <a class="brand" href="/index.html">MarvelReview</a>
    <nav class="top-nav">
      <a href="/index.html">Films</a>
      <a href="/ranking.html">Classement</a>
      <a href="/profile.html">Profil</a>
      <a href="/login.html" data-auth="logged-out">Connexion</a>
      <a href="/signup.html" data-auth="logged-out">Inscription</a>
      <button id="logout-button" data-auth="logged-in" class="ghost-button">Se deconnecter</button>
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
