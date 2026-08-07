import { supabase } from "../supabaseClient.js";
import { escapeHTML, isReleasedOnOrBeforeToday } from "./utils.js";

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

export async function loadPersonalRankingRows(userId) {
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

  return [...filmRows, ...seriesRows];
}

function fillSelect(selectEl, values, allLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

export function createRankingFilterController({
  filmsFilterSelector = "#filter-films",
  seriesFilterSelector = "#filter-series",
  franchiseFilterSelector = "#ranking-franchise-filter",
  phaseFilterSelector = "#ranking-phase-filter",
  phaseFilterWrapSelector = "#ranking-phase-filter-wrap",
  onChange = () => {}
} = {}) {
  const state = {
    allRows: [],
    filters: {
      films: true,
      series: true,
      franchise: "",
      phase: ""
    }
  };

  const filmsFilterEl = document.querySelector(filmsFilterSelector);
  const seriesFilterEl = document.querySelector(seriesFilterSelector);
  const franchiseFilterEl = document.querySelector(franchiseFilterSelector);
  const phaseFilterEl = document.querySelector(phaseFilterSelector);
  const phaseFilterWrapEl = document.querySelector(phaseFilterWrapSelector);

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

  function setupFilterOptions() {
    const franchises = Array.from(
      new Set(state.allRows.map((row) => row.franchise).filter(Boolean))
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

  function getFilteredRows() {
    const phaseSelected = Boolean(state.filters.phase);

    return state.allRows.filter((row) => {
      const isFilmRow = row.type === "film";
      const isSeriesRow = !isFilmRow;
      const isSeasonPhaseRow = row.type === "season_phase";

      if (isFilmRow && !state.filters.films) return false;
      if (isSeriesRow && !state.filters.series) return false;

      if (state.filters.franchise && row.franchise !== state.filters.franchise) return false;

      if (!phaseSelected) {
        if (isSeriesRow && row.phase) return false;
        return true;
      }

      if (!isFilmRow && !isSeasonPhaseRow) return false;
      return row.phase === state.filters.phase;
    });
  }

  filmsFilterEl?.addEventListener("change", () => {
    state.filters.films = filmsFilterEl.checked;
    onChange();
  });

  seriesFilterEl?.addEventListener("change", () => {
    state.filters.series = seriesFilterEl.checked;
    onChange();
  });

  franchiseFilterEl?.addEventListener("change", () => {
    state.filters.franchise = franchiseFilterEl.value || "";
    updatePhaseVisibility();
    onChange();
  });

  phaseFilterEl?.addEventListener("change", () => {
    state.filters.phase = phaseFilterEl.value || "";
    onChange();
  });

  async function load(userId) {
    state.allRows = await loadPersonalRankingRows(userId);
    setupFilterOptions();
    onChange();
  }

  return { state, load, getFilteredRows };
}
