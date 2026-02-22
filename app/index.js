import { supabase } from "../supabaseClient.js";
import { escapeHTML, formatDate, formatScore, getScoreClass, setMessage } from "./utils.js";

const FILMS_FILTERS_STORAGE_KEY = "marvelreview:films:list-filters:v1";
const VALID_FILM_SORT_MODES = new Set(["date_desc", "date_asc", "rating_desc", "rating_asc"]);
const SUPABASE_PAGE_SIZE = 1000;
const DEFAULT_FILM_FILTERS = Object.freeze({
  search: "",
  franchise: "",
  phase: "",
  type: "",
  sort: "date_desc"
});

const state = {
  films: [],
  filters: { ...DEFAULT_FILM_FILTERS }
};

const listEl = document.querySelector("#films-list");
const franchiseFilterEl = document.querySelector("#franchise-filter");
const phaseFilterEl = document.querySelector("#phase-filter");
const typeFilterEl = document.querySelector("#type-filter");
const sortFilterEl = document.querySelector("#sort-filter");
const phaseFilterWrapEl = document.querySelector("#phase-filter-wrap");
const titleSearchEl = document.querySelector("#title-search");
const resetFiltersEl = document.querySelector("#reset-filters");

function normalizeFilmFilters(filters) {
  const source = filters && typeof filters === "object" ? filters : {};
  const normalized = {
    search: typeof source.search === "string" ? source.search : "",
    franchise: typeof source.franchise === "string" ? source.franchise : "",
    phase: typeof source.phase === "string" ? source.phase : "",
    type: typeof source.type === "string" ? source.type : "",
    sort: typeof source.sort === "string" && VALID_FILM_SORT_MODES.has(source.sort)
      ? source.sort
      : DEFAULT_FILM_FILTERS.sort
  };

  return normalized;
}

function loadFilmFilters() {
  try {
    const raw = window.localStorage.getItem(FILMS_FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FILM_FILTERS };
    const parsed = JSON.parse(raw);
    return normalizeFilmFilters(parsed);
  } catch (_error) {
    return { ...DEFAULT_FILM_FILTERS };
  }
}

function saveFilmFilters() {
  try {
    window.localStorage.setItem(
      FILMS_FILTERS_STORAGE_KEY,
      JSON.stringify(normalizeFilmFilters(state.filters))
    );
  } catch (_error) {
    // Ignore storage failures (private mode, quota, etc).
  }
}

function setSelectValue(selectEl, value) {
  if (!selectEl) return "";
  const nextValue = Array.from(selectEl.options).some((option) => option.value === value)
    ? value
    : "";
  selectEl.value = nextValue;
  return nextValue;
}

function applyFiltersToControls() {
  state.filters.franchise = setSelectValue(franchiseFilterEl, state.filters.franchise);
  state.filters.phase = setSelectValue(phaseFilterEl, state.filters.phase);
  state.filters.type = setSelectValue(typeFilterEl, state.filters.type);

  const selectedSort = setSelectValue(sortFilterEl, state.filters.sort);
  state.filters.sort = selectedSort || DEFAULT_FILM_FILTERS.sort;
  if (sortFilterEl && !selectedSort) {
    sortFilterEl.value = state.filters.sort;
  }

  if (titleSearchEl) {
    titleSearchEl.value = state.filters.search;
  }
}

function resetFilmFilters() {
  Object.assign(state.filters, DEFAULT_FILM_FILTERS);
  applyFiltersToControls();
  updatePhaseVisibility();
  saveFilmFilters();
  renderFilms();
}

Object.assign(state.filters, loadFilmFilters());

function getDateSortValue(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function toNumericOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAllRows(table, columns) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

function normalizeFilmRow(row) {
  const ratingCount = Number(row.rating_count || 0);
  const average = toNumericOrNull(row.average);
  return {
    id: row.id,
    title: row.title || "",
    release_date: row.release_date || null,
    poster_url: row.poster_url || "",
    franchise: row.franchise || "",
    phase: row.phase || "",
    type: row.type || "",
    rating_count: Number.isFinite(ratingCount) ? ratingCount : 0,
    average
  };
}

async function loadFilmsFromApi() {
  const { data, error } = await supabase.rpc("api_film_catalog");
  if (error) throw error;
  return (data || []).map(normalizeFilmRow);
}

async function loadFilmsFromTables() {
  const [films, ratings] = await Promise.all([
    fetchAllRows("films", "id, title, release_date, poster_url, franchise, phase, type"),
    fetchAllRows("ratings", "film_id, score")
  ]);

  const scoreByFilmId = new Map();
  for (const rating of ratings || []) {
    const existing = scoreByFilmId.get(rating.film_id) || { total: 0, count: 0 };
    existing.total += Number(rating.score || 0);
    existing.count += 1;
    scoreByFilmId.set(rating.film_id, existing);
  }

  return (films || []).map((film) => {
    const ratingData = scoreByFilmId.get(film.id) || { total: 0, count: 0 };
    return {
      ...film,
      rating_count: ratingData.count,
      average: ratingData.count ? ratingData.total / ratingData.count : null
    };
  });
}

function sortFilms(rows) {
  const sorted = [...rows];
  const sortMode = state.filters.sort || "date_desc";

  sorted.sort((a, b) => {
    if (sortMode === "date_asc" || sortMode === "date_desc") {
      const aTs = getDateSortValue(a.release_date);
      const bTs = getDateSortValue(b.release_date);
      if (aTs !== bTs) return sortMode === "date_asc" ? aTs - bTs : bTs - aTs;
      return (a.title || "").localeCompare(b.title || "", "fr");
    }

    const aAverage = Number.isFinite(a.average) ? a.average : null;
    const bAverage = Number.isFinite(b.average) ? b.average : null;

    if (aAverage === null && bAverage === null) {
      return (a.title || "").localeCompare(b.title || "", "fr");
    }
    if (aAverage === null) return 1;
    if (bAverage === null) return -1;
    if (aAverage !== bAverage) {
      return sortMode === "rating_asc" ? aAverage - bAverage : bAverage - aAverage;
    }
    return (a.title || "").localeCompare(b.title || "", "fr");
  });

  return sorted;
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
  applyFiltersToControls();
  updatePhaseVisibility();
  saveFilmFilters();

  franchiseFilterEl.addEventListener("change", () => {
    state.filters.franchise = franchiseFilterEl.value;
    updatePhaseVisibility();
    saveFilmFilters();
    renderFilms();
  });

  phaseFilterEl.addEventListener("change", () => {
    state.filters.phase = phaseFilterEl.value;
    saveFilmFilters();
    renderFilms();
  });

  typeFilterEl.addEventListener("change", () => {
    state.filters.type = typeFilterEl.value;
    saveFilmFilters();
    renderFilms();
  });

  sortFilterEl?.addEventListener("change", () => {
    state.filters.sort = sortFilterEl.value || "date_desc";
    saveFilmFilters();
    renderFilms();
  });

  resetFiltersEl?.addEventListener("click", resetFilmFilters);
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

  const sorted = sortFilms(filtered);

  if (!sorted.length) {
    listEl.innerHTML = "<p>Aucun contenu ne correspond aux filtres.</p>";
    return;
  }

  listEl.innerHTML = sorted
    .map(
      (film) => `
        <article class="card film-card">
          <img src="${escapeHTML(film.poster_url || "https://via.placeholder.com/240x360?text=Marvel")}" alt="Affiche de ${escapeHTML(film.title)}" />
          <div>
            <h3>${escapeHTML(film.title)}</h3>
            <p class="film-average">${
              film.rating_count > 0
                ? `Moyenne: <span class="score-badge film-average-badge ${getScoreClass(film.average)}">${formatScore(film.average, 2, 2)} / 10</span>`
                : `Moyenne: <span class="score-badge film-average-badge stade-neutre">pas de note</span>`
            }</p>
            <p>Sortie: ${formatDate(film.release_date)}</p>
            <p class="film-meta">${escapeHTML(film.franchise || "-")} - ${escapeHTML(film.type || "-")}</p>
            <div class="home-latest-card-action">
              <a class="button" href="/film.html?id=${film.id}">Voir la page film</a>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadFilms() {
  try {
    let films = [];
    try {
      films = await loadFilmsFromApi();
    } catch (_apiError) {
      films = await loadFilmsFromTables();
    }

    if (!films.length) {
      listEl.innerHTML = "<p>Aucun film pour le moment.</p>";
      return;
    }
    state.films = films;

    setupFilters();
    renderFilms();
  } catch (error) {
    setMessage("#page-message", error.message || "Impossible de charger les films.", true);
    listEl.innerHTML = "";
  }
}

titleSearchEl?.addEventListener("input", () => {
  state.filters.search = titleSearchEl.value || "";
  saveFilmFilters();
  renderFilms();
});

loadFilms();
