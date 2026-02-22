import { supabase } from "../supabaseClient.js";
import { requireAuth } from "./auth.js";
import {
  buildDenseRankLabels,
  escapeHTML,
  formatScore,
  getScoreClass,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";

let currentUserId = null;
const personalRankingState = {
  allRows: [],
  filters: {
    films: true,
    series: true,
    franchise: "",
    phase: ""
  }
};

const filmsFilterEl = document.querySelector("#filter-films");
const seriesFilterEl = document.querySelector("#filter-series");
const franchiseFilterEl = document.querySelector("#ranking-franchise-filter");
const phaseFilterEl = document.querySelector("#ranking-phase-filter");
const phaseFilterWrapEl = document.querySelector("#ranking-phase-filter-wrap");
const SUPABASE_PAGE_SIZE = 1000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function fetchPagedRows(buildQuery) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;

    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function fetchAllRows(table, columns, orderBy = "id", ascending = true) {
  return fetchPagedRows((from, to) =>
    supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending })
      .range(from, to)
  );
}

async function fetchAllRowsByEq(table, columns, field, value, orderBy = "id", ascending = true) {
  return fetchPagedRows((from, to) =>
    supabase
      .from(table)
      .select(columns)
      .eq(field, value)
      .order(orderBy, { ascending })
      .range(from, to)
  );
}

function fillSelect(selectEl, values, allLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

function updatePhaseVisibility() {
  const showPhase = personalRankingState.filters.franchise === "MCU";
  if (phaseFilterWrapEl) {
    phaseFilterWrapEl.style.display = showPhase ? "grid" : "none";
  }

  if (!showPhase) {
    personalRankingState.filters.phase = "";
    if (phaseFilterEl) phaseFilterEl.value = "";
  }
}

function setupRankingFilterOptions() {
  const franchises = Array.from(
    new Set(
      personalRankingState.allRows
        .map((row) => row.franchise)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const mcuPhases = Array.from(
    new Set(
      personalRankingState.allRows
        .filter((row) => row.franchise === "MCU")
        .map((row) => row.phase)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  fillSelect(franchiseFilterEl, franchises, "Toutes les franchises");
  fillSelect(phaseFilterEl, mcuPhases, "Toutes les phases");

  if (franchiseFilterEl) franchiseFilterEl.value = personalRankingState.filters.franchise;
  if (phaseFilterEl) phaseFilterEl.value = personalRankingState.filters.phase;
  updatePhaseVisibility();
}

function getFilteredPersonalRows() {
  const phaseSelected = Boolean(personalRankingState.filters.phase);

  return personalRankingState.allRows.filter((row) => {
    const isFilmRow = row.type === "film";
    const isSeriesRow = !isFilmRow;

    if (isFilmRow && !personalRankingState.filters.films) return false;
    if (isSeriesRow && !personalRankingState.filters.series) return false;

    if (personalRankingState.filters.franchise && row.franchise !== personalRankingState.filters.franchise) return false;

    if (!phaseSelected) {
      if (isSeriesRow && row.phase) return false;
      return true;
    }

    return row.phase === personalRankingState.filters.phase;
  });
}

async function loadMediaOutlets() {
  const selectEl = document.querySelector("#media_outlet_id");

  const { data, error } = await supabase
    .from("media_outlets")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;

  selectEl.innerHTML = [
    `<option value="">Aucun média</option>`,
    ...(data || []).map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`)
  ].join("");
}

function getMembershipStatusLabel(status) {
  if (status === "approved") return "approuvé et rattaché";
  return status;
}

async function loadMemberships(userId) {
  const statusEl = document.querySelector("#media-membership-status");
  const currentMediaEl = document.querySelector("#current-media");

  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, status, media_id, media_outlets(name)")
    .eq("profile_id", userId)
    .order("requested_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];

  if (!rows.length) {
    statusEl.textContent = "Aucune demande de rattachement.";
    currentMediaEl.textContent = "Indépendant";
    return;
  }

  const approved = rows
    .filter((row) => row.status === "approved")
    .map((row) => row.media_outlets?.name || "Média");

  currentMediaEl.textContent = approved.length ? approved.join(", ") : "Indépendant";

  statusEl.innerHTML = rows
    .map((row) => `- ${escapeHTML(row.media_outlets?.name || "Média")}: ${escapeHTML(getMembershipStatusLabel(row.status))}`)
    .join("<br>");
}

function renderPersonalRatings() {
  const body = document.querySelector("#personal-ratings-body");
  const filteredRows = getFilteredPersonalRows();

  if (!filteredRows.length) {
    body.innerHTML = `<tr><td colspan="4">Aucun élément pour ce filtre.</td></tr>`;
    return;
  }

  const sortedRows = [...filteredRows].sort((a, b) => {
    const aRated = a.score !== null;
    const bRated = b.score !== null;

    if (aRated && bRated) {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title, "fr");
    }
    if (aRated) return -1;
    if (bRated) return 1;

    const aTs = a.sort_date ? new Date(a.sort_date).getTime() : Number.POSITIVE_INFINITY;
    const bTs = b.sort_date ? new Date(b.sort_date).getTime() : Number.POSITIVE_INFINITY;
    if (aTs !== bTs) return aTs - bTs;
    return a.title.localeCompare(b.title, "fr");
  });

  const rankLabels = buildDenseRankLabels(sortedRows, (row) => row.score, 2);

  body.innerHTML = sortedRows
    .map((row, index) => {
      const rank = row.score === null ? "-" : rankLabels[index];
      const scoreText = row.score === null ? "" : String(row.score);
      const badge = row.score === null
        ? `<span class="score-badge stade-neutre">Pas noté</span>`
        : `<span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score)} / 10</span>`;
      const typeLabel = row.type === "film" ? "Film" : "Série";
      const href = row.type === "film"
        ? `/film.html?id=${row.film_id}`
        : row.type === "season_phase"
          ? `/season.html?id=${row.season_id}`
          : `/series.html?id=${row.series_id}`;
      const modifierCell = row.type === "film"
        ? `
          <div class="inline-actions inline-edit">
            <input data-field="score" data-film-id="${row.film_id}" type="number" min="0" max="10" step="0.25" value="${scoreText}" placeholder="0 à 10" />
            <button type="button" class="icon-circle-btn save" data-action="save-rating" data-film-id="${row.film_id}" aria-label="Valider la note">
              <i class="fa-solid fa-check" aria-hidden="true"></i>
            </button>
            ${row.score === null ? "" : `
              <button type="button" class="icon-circle-btn delete" data-action="delete-rating" data-film-id="${row.film_id}" aria-label="Supprimer la note">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            `}
          </div>
        `
        : `<span class="film-meta">${row.type === "season_phase" ? "Notable sur la page saison" : "Notable sur la page série"}</span>`;

      return `
        <tr>
          <td>${rank}</td>
          <td>
            <a href="${href}" class="film-link">${escapeHTML(row.title)}</a>
            <small>(${escapeHTML(row.type === "season_phase" ? "Saison" : typeLabel)}${row.phase ? ` - ${escapeHTML(row.phase)}` : ""})</small>
          </td>
          <td>${badge}</td>
          <td>${modifierCell}</td>
        </tr>
      `;
    })
    .join("");
}

function bindRankingFilters() {
  filmsFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.films = filmsFilterEl.checked;
    renderPersonalRatings();
  });

  seriesFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.series = seriesFilterEl.checked;
    renderPersonalRatings();
  });

  franchiseFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.franchise = franchiseFilterEl.value || "";
    updatePhaseVisibility();
    renderPersonalRatings();
  });

  phaseFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.phase = phaseFilterEl.value || "";
    renderPersonalRatings();
  });
}

async function loadPersonalRatings(userId) {
  const [films, ratings, seriesList, seasons, episodes, episodeRatings, seasonUserRatings] = await Promise.all([
    fetchAllRows("films", "id, title, release_date, franchise, phase", "release_date", true),
    fetchAllRowsByEq("ratings", "film_id, score, review", "user_id", userId),
    fetchAllRows("series", "id, title, start_date, franchise", "start_date", true),
    fetchAllRows("series_seasons", "id, series_id, name, season_number, phase, start_date"),
    fetchAllRows("series_episodes", "id, season_id"),
    fetchAllRowsByEq("episode_ratings", "episode_id, score", "user_id", userId),
    fetchAllRowsByEq("season_user_ratings", "season_id, manual_score, adjustment", "user_id", userId)
  ]);

  const ratingByFilmId = new Map((ratings || []).map((row) => [row.film_id, row]));

  const filmRows = (films || [])
    .map((film) => {
      const rating = ratingByFilmId.get(film.id);
      return {
        type: "film",
        film_id: film.id,
        title: film.title,
        release_date: film.release_date,
        sort_date: film.release_date,
        franchise: String(film.franchise || "").trim(),
        phase: String(film.phase || "").trim(),
        score: rating ? Number(rating.score) : null,
        review: rating?.review || ""
      };
    })
    .filter((film) => isReleasedOnOrBeforeToday(film.release_date));

  const seasonsBySeriesId = new Map();
  for (const season of seasons || []) {
    const rows = seasonsBySeriesId.get(season.series_id) || [];
    rows.push(season);
    seasonsBySeriesId.set(season.series_id, rows);
  }

  const episodesBySeasonId = new Map();
  for (const episode of episodes || []) {
    const rows = episodesBySeasonId.get(episode.season_id) || [];
    rows.push(episode);
    episodesBySeasonId.set(episode.season_id, rows);
  }

  const userEpisodeScoreByEpisodeId = new Map((episodeRatings || []).map((row) => [row.episode_id, Number(row.score)]));
  const seasonUserRowBySeasonId = new Map((seasonUserRatings || []).map((row) => [row.season_id, row]));

  const seriesRows = (seriesList || []).flatMap((serie) => {
    const serieSeasons = seasonsBySeriesId.get(serie.id) || [];
    const seasonScores = [];
    const seasonScoresByPhase = new Map();
    const seasonRowsByPhase = new Map();

    for (const season of serieSeasons) {
      const seasonEpisodes = episodesBySeasonId.get(season.id) || [];
      const episodeScores = seasonEpisodes
        .map((episode) => userEpisodeScoreByEpisodeId.get(episode.id))
        .filter((score) => Number.isFinite(score));
      const episodeAverage = episodeScores.length
        ? episodeScores.reduce((sum, score) => sum + score, 0) / episodeScores.length
        : null;

      const seasonUserRow = seasonUserRowBySeasonId.get(season.id);
      const manual = seasonUserRow?.manual_score === null || seasonUserRow?.manual_score === undefined
        ? null
        : Number(seasonUserRow.manual_score);
      const adjustment = Number(seasonUserRow?.adjustment || 0);
      const effective = manual !== null
        ? clamp(manual, 0, 10)
        : (Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);

      if (Number.isFinite(effective)) {
        seasonScores.push(effective);

        const phase = String(season.phase || "").trim();
        if (phase) {
          const phaseRows = seasonScoresByPhase.get(phase) || [];
          phaseRows.push({
            score: effective,
            start_date: season.start_date || null
          });
          seasonScoresByPhase.set(phase, phaseRows);

          const seasonLabel = String(season.name || "").trim()
            || (Number.isFinite(Number(season.season_number))
              ? `Saison ${season.season_number}`
              : "Saison");
          const seasonPhaseRows = seasonRowsByPhase.get(phase) || [];
          seasonPhaseRows.push({
            season_id: season.id,
            title: `${serie.title} - ${seasonLabel}`,
            sort_date: season.start_date || serie.start_date || null,
            score: effective
          });
          seasonRowsByPhase.set(phase, seasonPhaseRows);
        }
      }
    }

    const score = seasonScores.length
      ? seasonScores.reduce((sum, seasonScore) => sum + seasonScore, 0) / seasonScores.length
      : null;

    const rows = [{
      type: "series",
      series_id: serie.id,
      title: serie.title,
      sort_date: serie.start_date,
      franchise: String(serie.franchise || "").trim(),
      phase: "",
      score
    }];

    for (const [phase, phaseRows] of seasonScoresByPhase.entries()) {
      const phaseScore = phaseRows.reduce((sum, row) => sum + row.score, 0) / phaseRows.length;
      const phaseSortDate = phaseRows
        .map((row) => row.start_date)
        .filter(Boolean)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || serie.start_date;

      rows.push({
        type: "series_phase",
        series_id: serie.id,
        title: serie.title,
        sort_date: phaseSortDate,
        franchise: String(serie.franchise || "").trim(),
        phase,
        score: phaseScore
      });

      const seasonPhaseRows = seasonRowsByPhase.get(phase) || [];
      for (const seasonRow of seasonPhaseRows) {
        rows.push({
          type: "season_phase",
          series_id: serie.id,
          season_id: seasonRow.season_id,
          title: seasonRow.title,
          sort_date: seasonRow.sort_date,
          franchise: String(serie.franchise || "").trim(),
          phase,
          score: seasonRow.score
        });
      }
    }

    return rows;
  });

  personalRankingState.allRows = [...filmRows, ...seriesRows];
  setupRankingFilterOptions();
  renderPersonalRatings();
}

async function saveQuickRating(filmId) {
  if (!currentUserId) return;

  const { data: film, error: filmError } = await supabase
    .from("films")
    .select("release_date")
    .eq("id", filmId)
    .maybeSingle();

  if (filmError) throw filmError;
  if (!isReleasedOnOrBeforeToday(film?.release_date || null)) {
    setMessage("#ratings-quick-message", "Impossible de noter un film non sorti ou sans date de sortie.", true);
    return;
  }

  const scoreInput = document.querySelector(`[data-field="score"][data-film-id="${filmId}"]`);
  const scoreRaw = scoreInput?.value.trim() || "";

  if (!scoreRaw) {
    setMessage("#ratings-quick-message", "Le score est obligatoire pour sauvegarder.", true);
    return;
  }

  const score = Number(scoreRaw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#ratings-quick-message", "Le score doit être entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const { error } = await supabase.from("ratings").upsert(
    {
      user_id: currentUserId,
      film_id: filmId,
      score
    },
    { onConflict: "user_id,film_id" }
  );

  if (error) throw error;

  setMessage("#ratings-quick-message", "Note sauvegardée.");
  await loadPersonalRatings(currentUserId);
}

async function deleteQuickRating(filmId) {
  if (!currentUserId) return;

  const { error } = await supabase
    .from("ratings")
    .delete()
    .eq("user_id", currentUserId)
    .eq("film_id", filmId);

  if (error) throw error;

  setMessage("#ratings-quick-message", "Note supprimée.");
  await loadPersonalRatings(currentUserId);
}

async function loadProfile() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const user = session.user;
  currentUserId = user.id;

  try {
    await loadMediaOutlets();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      document.querySelector("#username").value = data.username || "";
      document.querySelector("#admin-badge").textContent = data.is_admin ? "Oui" : "Non";
    }

    await Promise.all([loadMemberships(user.id), loadPersonalRatings(user.id)]);
    document.querySelector("#profile-email").textContent = user.email || "";
  } catch (error) {
    setMessage("#form-message", error.message || "Erreur de chargement profil.", true);
  }
}

document.querySelector("#profile-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const username = document.querySelector("#username").value.trim();
  const mediaOutletId = document.querySelector("#media_outlet_id").value || null;

  if (!username) {
    setMessage("#form-message", "Le nom d'utilisateur est obligatoire.", true);
    return;
  }

  try {
    const payload = {
      id: session.user.id,
      username
    };

    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) throw error;

    if (mediaOutletId) {
      const { error: membershipError } = await supabase.from("profile_media_memberships").upsert(
        {
          profile_id: session.user.id,
          media_id: mediaOutletId,
          status: "pending",
          decided_at: null,
          decided_by: null
        },
        { onConflict: "profile_id,media_id" }
      );

      if (membershipError) throw membershipError;
    }

    setMessage("#form-message", "Profil enregistré. Demande média ajoutée ou mise à jour.");
    await loadMemberships(session.user.id);
  } catch (error) {
    setMessage("#form-message", error.message || "Sauvegarde impossible.", true);
  }
});

document.querySelector("#personal-ratings-body")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const filmId = button.dataset.filmId;
  if (!filmId) return;

  try {
    if (button.dataset.action === "save-rating") {
      await saveQuickRating(filmId);
      return;
    }

    if (button.dataset.action === "delete-rating") {
      await deleteQuickRating(filmId);
    }
  } catch (error) {
    setMessage("#ratings-quick-message", error.message || "Opération impossible.", true);
  }
});

loadProfile();
bindRankingFilters();
