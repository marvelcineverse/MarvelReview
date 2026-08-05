import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  buildDenseRankLabels,
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
    franchise: ""
  }
};
const SUPABASE_PAGE_SIZE = 1000;

const filmsFilterEl = document.querySelector("#filter-films");
const seriesFilterEl = document.querySelector("#filter-series");
const franchiseFilterEl = document.querySelector("#ranking-franchise-filter");

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function fillSelect(selectEl, values, allLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

function buildSeasonScoresByUser(season, episodesBySeasonId, episodeRatingsByEpisodeId, seasonRowsBySeasonId) {
  const seasonEpisodes = episodesBySeasonId.get(season.id) || [];
  const totalEpisodeCount = seasonEpisodes.length;
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
    const hasCompleteEpisodeCoverage = totalEpisodeCount > 0
      && episodeValues
      && episodeValues.count === totalEpisodeCount;

    let effective = null;
    if (Number.isFinite(manual)) {
      effective = clamp(manual, 0, 10);
    } else if (hasCompleteEpisodeCoverage && Number.isFinite(episodeAverage)) {
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

function computeSeriesRows(seriesList, seasons, episodes, episodeRatings, seasonUserRatings, currentUserId) {
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

  const seriesRows = (seriesList || []).map((serie) => {
    if (!isReleasedOnOrBeforeToday(serie.start_date)) return null;
    const serieSeasons = seasonsBySeriesId.get(serie.id) || [];
    const totalSeasons = serieSeasons.length;

    if (!totalSeasons) {
      return {
        id: `series-${serie.id}`,
        title: serie.title,
        type: "series",
        typeLabel: String(serie.type || "Série").trim(),
        average: null,
        count: 0,
        myScore: null,
        href: `/series.html?id=${serie.id}`,
        franchise: String(serie.franchise || "").trim()
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
      typeLabel: String(serie.type || "Série").trim(),
      average,
      count: contributorCount,
      myScore,
      href: `/series.html?id=${serie.id}`,
      franchise: String(serie.franchise || "").trim()
    };
  }).filter(Boolean);

  return seriesRows;
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
    typeLabel: String(film.type || "Film").trim(),
    average: film.count ? film.average / film.count : null,
    count: film.count,
    myScore: film.myScore,
    href: `/film.html?id=${film.id}`,
    franchise: String(film.franchise || "").trim()
  }));
}

function getFilteredRows() {
  return state.allRows.filter((row) => {
    if (row.type === "film" && !state.filters.films) return false;
    if (row.type === "series" && !state.filters.series) return false;

    if (state.filters.franchise && row.franchise !== state.filters.franchise) return false;
    return true;
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
    bodyEl.innerHTML = `<tr><td colspan="${showMyScore ? 5 : 4}">Aucun résultat pour ce filtre.</td></tr>`;
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

      const detailParts = [];
      if (!state.filters.franchise && item.franchise) {
        detailParts.push(escapeHTML(item.franchise));
      }
      if (item.typeLabel) {
        detailParts.push(escapeHTML(item.typeLabel));
      }
      const detailLabel = detailParts.join(" - ");

      return `
        <tr>
          <td>${rankLabels[index]}</td>
          <td>
            <a href="${item.href}" class="film-link">${escapeHTML(item.title)}</a>
            ${detailLabel ? `<small>(${detailLabel})</small>` : ""}
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

  fillSelect(franchiseFilterEl, franchises, "Toutes les franchises");
  if (franchiseFilterEl) franchiseFilterEl.value = state.filters.franchise;
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
    renderRanking();
  });
}

async function loadRanking() {
  try {
    const session = await getSession();
    state.currentUserId = session?.user?.id || null;

    const [
      films,
      ratings,
      seriesList,
      seasons,
      episodes,
      episodeRatings,
      seasonUserRatings
    ] = await Promise.all([
      fetchAllRows("films", "id, title, release_date, franchise, type"),
      fetchAllRows("ratings", "film_id, user_id, score"),
      fetchAllRows("series", "id, title, start_date, franchise, type"),
      fetchAllRows("series_seasons", "id, series_id"),
      fetchAllRows("series_episodes", "id, season_id"),
      fetchAllRows("episode_ratings", "episode_id, user_id, score"),
      fetchAllRows("season_user_ratings", "season_id, user_id, manual_score, adjustment")
    ]);

    const filmRows = computeFilmRows(films || [], ratings || [], state.currentUserId);
    const seriesRows = computeSeriesRows(
      seriesList || [],
      seasons || [],
      episodes || [],
      episodeRatings || [],
      seasonUserRatings || [],
      state.currentUserId
    );

    state.allRows = [...filmRows, ...seriesRows];
    setupFilterOptions();
    renderRanking();
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du classement.", true);
  }
}

bindFilters();
loadRanking();
