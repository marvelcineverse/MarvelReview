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
  allRows: [],
  filters: {
    films: true,
    series: true
  }
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

  const result = [];
  for (const serie of seriesList || []) {
    const serieSeasons = seasonsBySeriesId.get(serie.id) || [];
    const totalSeasons = serieSeasons.length;

    if (!totalSeasons) {
      result.push({
        id: serie.id,
        title: serie.title,
        type: "series",
        dateLabel: `${formatDate(serie.start_date)} - ${formatDate(serie.end_date)}`,
        average: null,
        count: 0,
        myScore: null,
        href: `/series.html?id=${serie.id}`
      });
      continue;
    }

    const userSeasonScores = new Map();

    for (const season of serieSeasons) {
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
      const allUserIds = new Set([...episodeByUser.keys(), ...seasonRows.map((row) => row.user_id)]);

      for (const userId of allUserIds) {
        const manualRow = seasonRows.find((row) => row.user_id === userId);
        const episodeValues = episodeByUser.get(userId);
        const episodeAverage = episodeValues ? episodeValues.total / episodeValues.count : null;
        const manual = manualRow?.manual_score === null || manualRow?.manual_score === undefined
          ? null
          : Number(manualRow.manual_score);
        const adjustment = Number(manualRow?.adjustment || 0);

        const base = manual !== null ? manual : episodeAverage;
        if (!Number.isFinite(base)) continue;

        const effective = clamp(base + adjustment, 0, 10);
        const current = userSeasonScores.get(userId) || [];
        current.push(effective);
        userSeasonScores.set(userId, current);
      }
    }

    const weightedScores = [];
    let myScore = null;

    for (const [userId, seasonScores] of userSeasonScores.entries()) {
      if (!seasonScores.length) continue;
      const avg = seasonScores.reduce((sum, value) => sum + value, 0) / seasonScores.length;
      const coverage = seasonScores.length / totalSeasons;
      const weighted = avg * coverage;
      weightedScores.push(weighted);

      if (currentUserId && userId === currentUserId) {
        myScore = weighted;
      }
    }

    const average = weightedScores.length
      ? weightedScores.reduce((sum, value) => sum + value, 0) / weightedScores.length
      : null;

    result.push({
      id: serie.id,
      title: serie.title,
      type: "series",
      dateLabel: `${formatDate(serie.start_date)} - ${formatDate(serie.end_date)}`,
      average,
      count: weightedScores.length,
      myScore,
      href: `/series.html?id=${serie.id}`
    });
  }

  return result;
}

function renderRanking() {
  const bodyEl = document.querySelector("#ranking-body");

  const filtered = state.allRows.filter((row) => {
    if (row.type === "film") return state.filters.films;
    if (row.type === "series") return state.filters.series;
    return false;
  });

  const ranked = [...filtered].sort((a, b) => {
    const aAverage = a.average ?? -1;
    const bAverage = b.average ?? -1;
    if (bAverage !== aAverage) return bAverage - aAverage;
    if (b.count !== a.count) return b.count - a.count;
    return a.title.localeCompare(b.title, "fr");
  });

  if (!ranked.length) {
    bodyEl.innerHTML = `<tr><td colspan="5">Aucun resultat pour ce filtre.</td></tr>`;
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

      const typeLabel = item.type === "film" ? "Film" : "Serie";

      return `
        <tr>
          <td>${rankLabels[index]}</td>
          <td>
            <a href="${item.href}" class="film-link">${escapeHTML(item.title)}</a>
            <small>(${escapeHTML(typeLabel)} - ${escapeHTML(item.dateLabel)})</small>
          </td>
          <td>${averageCell}</td>
          <td>${myScoreCell}</td>
          <td>${item.count}</td>
        </tr>
      `;
    })
    .join("");
}

function bindFilters() {
  const filmsEl = document.querySelector("#filter-films");
  const seriesEl = document.querySelector("#filter-series");

  filmsEl?.addEventListener("change", () => {
    state.filters.films = filmsEl.checked;
    renderRanking();
  });

  seriesEl?.addEventListener("change", () => {
    state.filters.series = seriesEl.checked;
    renderRanking();
  });
}

async function loadRanking() {
  try {
    const session = await getSession();
    const currentUserId = session?.user?.id || null;

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
        .select("id, title, release_date")
        .order("title", { ascending: true }),
      supabase
        .from("ratings")
        .select("film_id, user_id, score"),
      supabase
        .from("series")
        .select("id, title, start_date, end_date")
        .order("title", { ascending: true }),
      supabase
        .from("series_seasons")
        .select("id, series_id"),
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

    const filmRows = Array.from(byFilmId.values()).map((film) => ({
      id: film.id,
      title: film.title,
      type: "film",
      dateLabel: formatDate(film.release_date),
      average: film.count ? film.average / film.count : null,
      count: film.count,
      myScore: film.myScore,
      href: `/film.html?id=${film.id}`
    }));

    const seriesRows = computeSeriesRows(
      seriesList || [],
      seasons || [],
      episodes || [],
      episodeRatings || [],
      seasonUserRatings || [],
      currentUserId
    );

    state.allRows = [...filmRows, ...seriesRows];
    renderRanking();
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du classement.", true);
  }
}

bindFilters();
loadRanking();
