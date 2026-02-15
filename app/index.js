import { supabase } from "../supabaseClient.js";
import { escapeHTML, formatDate, formatScore, setMessage } from "./utils.js";

const state = {
  films: [],
  filters: {
    search: "",
    franchise: "",
    phase: "",
    type: ""
  }
};

const listEl = document.querySelector("#films-list");
const franchiseFilterEl = document.querySelector("#franchise-filter");
const phaseFilterEl = document.querySelector("#phase-filter");
const typeFilterEl = document.querySelector("#type-filter");
const phaseFilterWrapEl = document.querySelector("#phase-filter-wrap");
const titleSearchEl = document.querySelector("#title-search");

function sortChronologically(films) {
  return [...films].sort((a, b) => {
    const aTs = a.release_date ? new Date(a.release_date).getTime() : Number.POSITIVE_INFINITY;
    const bTs = b.release_date ? new Date(b.release_date).getTime() : Number.POSITIVE_INFINITY;
    if (aTs !== bTs) return aTs - bTs;
    return (a.title || "").localeCompare(b.title || "", "fr");
  });
}

function fillSelect(selectEl, values, allLabel) {
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

function updatePhaseVisibility() {
  const showPhase = state.filters.franchise === "" || state.filters.franchise === "MCU";
  phaseFilterWrapEl.style.display = showPhase ? "grid" : "none";

  if (!showPhase) {
    state.filters.phase = "";
    phaseFilterEl.value = "";
  }
}

function setupFilters() {
  const franchises = Array.from(
    new Set(state.films.map((film) => film.franchise).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const phases = Array.from(
    new Set(state.films.map((film) => film.phase).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const types = Array.from(
    new Set(state.films.map((film) => film.type).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "fr"));

  fillSelect(franchiseFilterEl, franchises, "Toutes les franchises");
  fillSelect(phaseFilterEl, phases, "Toutes les phases");
  fillSelect(typeFilterEl, types, "Tous les types");

  if (franchises.includes("MCU")) {
    state.filters.franchise = "MCU";
    franchiseFilterEl.value = "MCU";
  }

  updatePhaseVisibility();

  franchiseFilterEl.addEventListener("change", () => {
    state.filters.franchise = franchiseFilterEl.value;
    updatePhaseVisibility();
    renderFilms();
  });

  phaseFilterEl.addEventListener("change", () => {
    state.filters.phase = phaseFilterEl.value;
    renderFilms();
  });

  typeFilterEl.addEventListener("change", () => {
    state.filters.type = typeFilterEl.value;
    renderFilms();
  });
}

function renderFilms() {
  const filtered = state.films.filter((film) => {
    const searchText = state.filters.search.trim().toLocaleLowerCase("fr");
    const matchesFranchise = !state.filters.franchise || film.franchise === state.filters.franchise;
    const matchesPhase = !state.filters.phase || film.phase === state.filters.phase;
    const matchesType = !state.filters.type || film.type === state.filters.type;
    const matchesSearch = !searchText || (film.title || "").toLocaleLowerCase("fr").includes(searchText);
    return matchesFranchise && matchesPhase && matchesType && matchesSearch;
  });

  if (!filtered.length) {
    listEl.innerHTML = "<p>Aucun contenu ne correspond aux filtres.</p>";
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (film) => `
        <article class="card film-card">
          <img src="${escapeHTML(film.poster_url || "https://via.placeholder.com/240x360?text=Marvel")}" alt="Affiche de ${escapeHTML(film.title)}" />
          <div>
            <h3>${escapeHTML(film.title)}</h3>
            <p class="film-average">${film.rating_count > 0 ? `Moyenne: ${formatScore(film.average, 2, 2)} / 10` : "Moyenne: pas de note"}</p>
            <p>Sortie: ${formatDate(film.release_date)}</p>
            <p class="film-meta">${escapeHTML(film.franchise || "-")} - ${escapeHTML(film.type || "-")}</p>
            <a class="button" href="/film.html?id=${film.id}">Voir la page film</a>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadFilms() {
  try {
    const [{ data: films, error: filmsError }, { data: ratings, error: ratingsError }] = await Promise.all([
      supabase
        .from("films")
        .select("id, title, release_date, poster_url, franchise, phase, type"),
      supabase
        .from("ratings")
        .select("film_id, score")
    ]);

    if (filmsError) throw filmsError;
    if (ratingsError) throw ratingsError;

    if (!films || films.length === 0) {
      listEl.innerHTML = "<p>Aucun film pour le moment.</p>";
      return;
    }

    const scoreByFilmId = new Map();
    for (const rating of ratings || []) {
      const existing = scoreByFilmId.get(rating.film_id) || { total: 0, count: 0 };
      existing.total += Number(rating.score || 0);
      existing.count += 1;
      scoreByFilmId.set(rating.film_id, existing);
    }

    state.films = sortChronologically(films).map((film) => {
      const ratingData = scoreByFilmId.get(film.id) || { total: 0, count: 0 };
      return {
        ...film,
        rating_count: ratingData.count,
        average: ratingData.count ? ratingData.total / ratingData.count : null
      };
    });

    setupFilters();
    renderFilms();
  } catch (error) {
    setMessage("#page-message", error.message || "Impossible de charger les films.", true);
    listEl.innerHTML = "";
  }
}

titleSearchEl?.addEventListener("input", () => {
  state.filters.search = titleSearchEl.value || "";
  renderFilms();
});

loadFilms();
