import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  buildDenseRankLabels,
  formatDate,
  formatScore,
  getScoreClass,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";
import { getSession } from "./auth.js";

const state = {
  currentUserId: null,
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function fillSelect(selectEl, values, allLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

function updatePhaseVisibility() {
  const showPhase = state.filters.franchise === "MCU";
  if (phaseFilterWrapEl) {
    phaseFilterWrapEl.style.display = showPhase ? "grid" : "none";
  }

  if (!showPhase) {
    state.filters.phase = "";
    if (phaseFilterEl) phaseFilterEl.value = "";
  }
}

function buildSeasonScoresByUser(season, episodesBySeasonId, episodeRatingsByEpisodeId, seasonRowsBySeasonId) {
  const seasonEpisodes = episodesBySeasonId.get(season.id) || [];
  const episodeByUser = new Map();

  for (const episode of seasonEpisodes) {
    const ratings = episodeRatingsByEpisodeId.get(episode.id) || [];
    for (const rating of ratings) {
      const current = episodeByUser.get(rating.user_id) || { total: 0, count: 0 };
      current.total += Number(rating.score || 0);
      current.count += 1;
      episodeByUser.set(rating.user_id, current);
    }
  }

  const seasonRows = seasonRowsBySeasonId.get(season.id) || [];
  const manualByUser = new Map(seasonRows.map((row) => [row.user_id, row]));
  const allUserIds = new Set([...episodeByUser.keys(), ...manualByUser.keys()]);

  const scoresByUser = new Map();
  for (const userId of allUserIds) {
    const manualRow = manualByUser.get(userId);
    const manual = manualRow?.manual_score === null || manualRow?.manual_score === undefined
      ? null
      : Number(manualRow.manual_score);
    const adjustment = Number(manualRow?.adjustment || 0);
    const episodeValues = episodeByUser.get(userId);
    const episodeAverage = episodeValues ? episodeValues.total / episodeValues.count : null;

    let effective = null;
    if (Number.isFinite(manual)) {
      effective = clamp(manual, 0, 10);
    } else if (Number.isFinite(episodeAverage)) {
      effective = clamp(episodeAverage + adjustment, 0, 10);
    }

    if (Number.isFinite(effective)) {
      scoresByUser.set(userId, effective);
    }
  }

  const values = [...scoresByUser.values()];
  const average = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

  return {
    scoresByUser,
    average,
    count: values.length
  };
}

function computeSeriesAndSeasonRows(seriesList, seasons, episodes, episodeRatings, seasonUserRatings, currentUserId) {
  const seriesById = new Map((seriesList || []).map((serie) => [serie.id, serie]));

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

  const episodeRatingsByEpisodeId = new Map();
  for (const rating of episodeRatings || []) {
    const rows = episodeRatingsByEpisodeId.get(rating.episode_id) || [];
    rows.push(rating);
    episodeRatingsByEpisodeId.set(rating.episode_id, rows);
  }

  const seasonRowsBySeasonId = new Map();
  for (const row of seasonUserRatings || []) {
    const rows = seasonRowsBySeasonId.get(row.season_id) || [];
    rows.push(row);
    seasonRowsBySeasonId.set(row.season_id, rows);
  }

  const seasonScoreBySeasonId = new Map();
  for (const season of seasons || []) {
    seasonScoreBySeasonId.set(
      season.id,
      buildSeasonScoresByUser(season, episodesBySeasonId, episodeRatingsByEpisodeId, seasonRowsBySeasonId)
    );
  }

  const seasonRows = (seasons || [])
    .map((season) => {
      const serie = seriesById.get(season.series_id);
      if (!serie) return null;

      const seasonStats = seasonScoreBySeasonId.get(season.id) || { average: null, count: 0, scoresByUser: new Map() };
      return {
        id: `season-${season.id}`,
        title: `${serie.title} - ${season.name || `Saison ${season.season_number || ""}`}`.trim(),
        type: "season",
        dateLabel: `${formatDate(season.start_date)} - ${formatDate(season.end_date)}`,
        average: seasonStats.average,
        count: seasonStats.count,
        myScore: currentUserId ? (seasonStats.scoresByUser.get(currentUserId) ?? null) : null,
        href: `/season.html?id=${season.id}`,
        franchise: String(serie.franchise || "").trim(),
        phase: String(season.phase || "").trim()
      };
    })
    .filter(Boolean);

  const seriesRows = (seriesList || []).map((serie) => {
    const serieSeasons = seasonsBySeriesId.get(serie.id) || [];
    const totalSeasons = serieSeasons.length;

    if (!totalSeasons) {
      return {
        id: `series-${serie.id}`,
        title: serie.title,
        type: "series",
        dateLabel: `${formatDate(serie.start_date)} - ${formatDate(serie.end_date)}`,
        average: null,
        count: 0,
        myScore: null,
        href: `/series.html?id=${serie.id}`,
        franchise: String(serie.franchise || "").trim(),
        phase: ""
      };
    }

    const userSeasonScores = new Map();
    for (const season of serieSeasons) {
      const seasonStats = seasonScoreBySeasonId.get(season.id) || { scoresByUser: new Map() };
      for (const [userId, score] of seasonStats.scoresByUser.entries()) {
        const current = userSeasonScores.get(userId) || [];
        current.push(score);
        userSeasonScores.set(userId, current);
      }
    }

    let weightedSum = 0;
    let coverageWeightSum = 0;
    let myScore = null;
    let contributorCount = 0;

    for (const [userId, seasonScores] of userSeasonScores.entries()) {
      if (!seasonScores.length) continue;
      contributorCount += 1;

      const userAverage = seasonScores.reduce((sum, value) => sum + value, 0) / seasonScores.length;
      const coverage = seasonScores.length / totalSeasons;
      weightedSum += userAverage * coverage;
      coverageWeightSum += coverage;

      if (currentUserId && userId === currentUserId) {
        myScore = userAverage;
      }
    }

    const average = contributorCount && coverageWeightSum > 0
      ? weightedSum / coverageWeightSum
      : null;

    return {
      id: `series-${serie.id}`,
      title: serie.title,
      type: "series",
      dateLabel: `${formatDate(serie.start_date)} - ${formatDate(serie.end_date)}`,
      average,
      count: contributorCount,
      myScore,
      href: `/series.html?id=${serie.id}`,
      franchise: String(serie.franchise || "").trim(),
      phase: ""
    };
  });

  return { seriesRows, seasonRows };
}

function computeFilmRows(films, ratings, currentUserId) {
  const releasedFilms = (films || []).filter((film) => isReleasedOnOrBeforeToday(film.release_date));
  const byFilmId = new Map();

  for (const film of releasedFilms) {
    byFilmId.set(film.id, { ...film, average: 0, count: 0, myScore: null });
  }

  for (const rating of ratings || []) {
    const item = byFilmId.get(rating.film_id);
    if (!item) continue;
    item.average += Number(rating.score || 0);
    item.count += 1;
    if (currentUserId && rating.user_id === currentUserId) {
      item.myScore = Number(rating.score);
    }
  }

  return Array.from(byFilmId.values()).map((film) => ({
    id: `film-${film.id}`,
    title: film.title,
    type: "film",
    dateLabel: formatDate(film.release_date),
    average: film.count ? film.average / film.count : null,
    count: film.count,
    myScore: film.myScore,
    href: `/film.html?id=${film.id}`,
    franchise: String(film.franchise || "").trim(),
    phase: String(film.phase || "").trim()
  }));
}

function getFilteredRows() {
  const phaseSelected = Boolean(state.filters.phase);

  return state.allRows.filter((row) => {
    if (row.type === "film" && !state.filters.films) return false;
    if ((row.type === "series" || row.type === "season") && !state.filters.series) return false;

    if (state.filters.franchise && row.franchise !== state.filters.franchise) return false;

    if (!phaseSelected) {
      return row.type !== "season";
    }

    if (row.type === "series") return false;
    if (row.type === "season") return row.phase === state.filters.phase;
    if (row.type === "film") return row.phase === state.filters.phase;
    return false;
  });
}

function renderRanking() {
  const tableHeadRowEl = document.querySelector("#ranking-head-row");
  const bodyEl = document.querySelector("#ranking-body");
  const showMyScore = Boolean(state.currentUserId);

  if (tableHeadRowEl) {
    tableHeadRowEl.innerHTML = `
      <th>#</th>
      <th>Contenu</th>
      <th>Moyenne</th>
      ${showMyScore ? "<th>Ta note</th>" : ""}
      <th>Notes</th>
    `;
  }

  const filtered = getFilteredRows();
  const ranked = [...filtered].sort((a, b) => {
    const aAverage = a.average ?? -1;
    const bAverage = b.average ?? -1;
    if (bAverage !== aAverage) return bAverage - aAverage;
    if (b.count !== a.count) return b.count - a.count;
    return a.title.localeCompare(b.title, "fr");
  });

  if (!ranked.length) {
    bodyEl.innerHTML = `<tr><td colspan="${showMyScore ? 5 : 4}">Aucun resultat pour ce filtre.</td></tr>`;
    return;
  }

  const rankLabels = buildDenseRankLabels(ranked, (item) => item.average, 2);

  bodyEl.innerHTML = ranked
    .map((item, index) => {
      const averageCell = item.count
        ? `<span class="score-badge ${getScoreClass(item.average)}">${formatScore(item.average, 2, 2)} / 10</span>`
        : `<span class="score-badge stade-neutre">Pas de note</span>`;

      const myScoreCell = item.myScore === null
        ? `<span class="score-badge stade-neutre">-</span>`
        : `<span class="score-badge ta-note-badge ${getScoreClass(item.myScore)}">${formatScore(item.myScore, 2, 2)} / 10</span>`;

      const typeLabel = item.type === "film"
        ? "Film"
        : (item.type === "season" ? "Saison" : "Serie");
      const phasePart = item.phase ? ` - ${escapeHTML(item.phase)}` : "";

      return `
        <tr>
          <td>${rankLabels[index]}</td>
          <td>
            <a href="${item.href}" class="film-link">${escapeHTML(item.title)}</a>
            <small>(${typeLabel} - ${escapeHTML(item.dateLabel)}${phasePart})</small>
          </td>
          <td>${averageCell}</td>
          ${showMyScore ? `<td>${myScoreCell}</td>` : ""}
          <td>${item.count}</td>
        </tr>
      `;
    })
    .join("");
}

function setupFilterOptions() {
  const franchises = Array.from(
    new Set(
      state.allRows
        .map((row) => row.franchise)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const mcuPhases = Array.from(
    new Set(
      state.allRows
        .filter((row) => row.franchise === "MCU")
        .map((row) => row.phase)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  fillSelect(franchiseFilterEl, franchises, "Toutes les franchises");
  fillSelect(phaseFilterEl, mcuPhases, "Toutes les phases");

  if (franchiseFilterEl) franchiseFilterEl.value = state.filters.franchise;
  if (phaseFilterEl) phaseFilterEl.value = state.filters.phase;
  updatePhaseVisibility();
}

function bindFilters() {
  filmsFilterEl?.addEventListener("change", () => {
    state.filters.films = filmsFilterEl.checked;
    renderRanking();
  });

  seriesFilterEl?.addEventListener("change", () => {
    state.filters.series = seriesFilterEl.checked;
    renderRanking();
  });

  franchiseFilterEl?.addEventListener("change", () => {
    state.filters.franchise = franchiseFilterEl.value || "";
    updatePhaseVisibility();
    renderRanking();
  });

  phaseFilterEl?.addEventListener("change", () => {
    state.filters.phase = phaseFilterEl.value || "";
    renderRanking();
  });
}

async function loadRanking() {
  try {
    const session = await getSession();
    state.currentUserId = session?.user?.id || null;

    const [
      { data: films, error: filmsError },
      { data: ratings, error: ratingsError },
      { data: seriesList, error: seriesError },
      { data: seasons, error: seasonsError },
      { data: episodes, error: episodesError },
      { data: episodeRatings, error: episodeRatingsError },
      { data: seasonUserRatings, error: seasonUserRatingsError }
    ] = await Promise.all([
      supabase
        .from("films")
        .select("id, title, release_date, franchise, phase")
        .order("title", { ascending: true }),
      supabase
        .from("ratings")
        .select("film_id, user_id, score"),
      supabase
        .from("series")
        .select("id, title, start_date, end_date, franchise")
        .order("title", { ascending: true }),
      supabase
        .from("series_seasons")
        .select("id, series_id, name, season_number, start_date, end_date, phase"),
      supabase
        .from("series_episodes")
        .select("id, season_id"),
      supabase
        .from("episode_ratings")
        .select("episode_id, user_id, score"),
      supabase
        .from("season_user_ratings")
        .select("season_id, user_id, manual_score, adjustment")
    ]);

    if (filmsError) throw filmsError;
    if (ratingsError) throw ratingsError;
    if (seriesError) throw seriesError;
    if (seasonsError) throw seasonsError;
    if (episodesError) throw episodesError;
    if (episodeRatingsError) throw episodeRatingsError;
    if (seasonUserRatingsError) throw seasonUserRatingsError;

    const filmRows = computeFilmRows(films || [], ratings || [], state.currentUserId);
    const { seriesRows, seasonRows } = computeSeriesAndSeasonRows(
      seriesList || [],
      seasons || [],
      episodes || [],
      episodeRatings || [],
      seasonUserRatings || [],
      state.currentUserId
    );

    state.allRows = [...filmRows, ...seriesRows, ...seasonRows];
    setupFilterOptions();
    renderRanking();
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du classement.", true);
  }
}

bindFilters();
loadRanking();
