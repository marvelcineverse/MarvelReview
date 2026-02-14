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
