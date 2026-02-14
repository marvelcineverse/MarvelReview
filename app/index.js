import { supabase } from "../supabaseClient.js";
import { escapeHTML, setMessage } from "./utils.js";

const state = {
  films: [],
  filters: {
    franchise: "",
    phase: "",
    type: ""
  }
};

const listEl = document.querySelector("#films-list");
const franchiseFilterEl = document.querySelector("#franchise-filter");
const phaseFilterEl = document.querySelector("#phase-filter");
const typeFilterEl = document.querySelector("#type-filter");

function sortChronologically(films) {
  return [...films].sort((a, b) => {
    const yearA = Number.isFinite(Number(a.release_year)) ? Number(a.release_year) : 9999;
    const yearB = Number.isFinite(Number(b.release_year)) ? Number(b.release_year) : 9999;

    if (yearA !== yearB) return yearA - yearB;
    return (a.title || "").localeCompare(b.title || "", "fr");
  });
}

function fillSelect(selectEl, values, allLabel) {
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
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

  // Par defaut: afficher uniquement MCU si present.
  if (franchises.includes("MCU")) {
    state.filters.franchise = "MCU";
    franchiseFilterEl.value = "MCU";
  }

  franchiseFilterEl.addEventListener("change", () => {
    state.filters.franchise = franchiseFilterEl.value;
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
    const matchesFranchise = !state.filters.franchise || film.franchise === state.filters.franchise;
    const matchesPhase = !state.filters.phase || film.phase === state.filters.phase;
    const matchesType = !state.filters.type || film.type === state.filters.type;
    return matchesFranchise && matchesPhase && matchesType;
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
            <p>Sortie: ${film.release_year || "-"}</p>
            <p class="film-meta">${escapeHTML(film.franchise || "-")} - ${escapeHTML(film.phase || "-")} - ${escapeHTML(film.type || "-")}</p>
            <a class="button" href="/film.html?id=${film.id}">Voir la page film</a>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadFilms() {
  try {
    const { data, error } = await supabase
      .from("films")
      .select("id, title, release_year, poster_url, franchise, phase, type");

    if (error) throw error;

    if (!data || data.length === 0) {
      listEl.innerHTML = "<p>Aucun film pour le moment.</p>";
      return;
    }

    state.films = sortChronologically(data);
    setupFilters();
    renderFilms();
  } catch (error) {
    setMessage("#page-message", error.message || "Impossible de charger les films.", true);
    listEl.innerHTML = "";
  }
}

loadFilms();
