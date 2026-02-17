import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  formatDate,
  formatScore,
  getScoreClass,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";

const LATEST_CONTENT_INITIAL_LIMIT = 4;
const LATEST_CONTENT_EXPANDED_LIMIT = 8;
const LATEST_ACTIVITY_LIMIT = 20;
const state = {
  latestContentExpanded: false
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTimeValue(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSeriesHighlightDate(seriesRow, seasonsBySeriesId) {
  const seasons = seasonsBySeriesId.get(seriesRow.id) || [];
  const releasedSeasonDates = seasons
    .map((season) => season.start_date || null)
    .filter((date) => isReleasedOnOrBeforeToday(date));

  if (releasedSeasonDates.length) {
    releasedSeasonDates.sort((a, b) => getTimeValue(b) - getTimeValue(a));
    return releasedSeasonDates[0];
  }

  return seriesRow.start_date || null;
}

function computeSeriesListAverages(seriesList, seasons, episodes, episodeRatings, seasonUserRatings) {
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

  const averageBySeriesId = new Map();
  for (const serie of seriesList || []) {
    const serieSeasons = seasonsBySeriesId.get(serie.id) || [];
    const totalSeasons = serieSeasons.length;
    if (!totalSeasons) {
      averageBySeriesId.set(serie.id, { average: null, count: 0 });
      continue;
    }

    const userSeasonScores = new Map();

    for (const season of serieSeasons) {
      const seasonEpisodes = episodesBySeasonId.get(season.id) || [];
      const seasonEpisodeCount = seasonEpisodes.length;
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
        const hasAllEpisodeRatings = seasonEpisodeCount > 0 && Number(episodeValues?.count || 0) === seasonEpisodeCount;
        const manual = manualRow?.manual_score === null || manualRow?.manual_score === undefined
          ? null
          : Number(manualRow.manual_score);
        const adjustment = Number(manualRow?.adjustment || 0);
        const effective = manual !== null
          ? clamp(manual, 0, 10)
          : (hasAllEpisodeRatings && Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);
        if (!Number.isFinite(effective)) continue;

        const current = userSeasonScores.get(userId) || [];
        current.push(effective);
        userSeasonScores.set(userId, current);
      }
    }

    const weightedScores = [];
    let weightedSum = 0;
    let coverageWeightSum = 0;

    for (const seasonScores of userSeasonScores.values()) {
      if (!seasonScores.length) continue;
      const userAverage = seasonScores.reduce((sum, value) => sum + value, 0) / seasonScores.length;
      const coverage = seasonScores.length / totalSeasons;
      weightedScores.push(userAverage);
      weightedSum += userAverage * coverage;
      coverageWeightSum += coverage;
    }

    const average = weightedScores.length && coverageWeightSum > 0
      ? weightedSum / coverageWeightSum
      : null;

    averageBySeriesId.set(serie.id, { average, count: weightedScores.length });
  }

  return averageBySeriesId;
}

async function loadMembershipMapForUsers(userIds) {
  if (!userIds.length) return new Map();

  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("profile_id, status, media_outlets(name)")
    .in("profile_id", userIds)
    .eq("status", "approved");

  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    const existing = map.get(row.profile_id) || [];
    const mediaName = row.media_outlets?.name;
    if (mediaName) existing.push(mediaName);
    map.set(row.profile_id, existing);
  }

  return map;
}

function renderLatestContent(allItems) {
  const listEl = document.querySelector("#home-latest-content-list");
  const toggleEl = document.querySelector("#home-latest-content-toggle");
  if (!listEl) return;

  if (!allItems.length) {
    listEl.innerHTML = "<p>Aucun contenu sorti pour le moment.</p>";
    if (toggleEl) toggleEl.style.display = "none";
    return;
  }

  const visibleLimit = state.latestContentExpanded
    ? LATEST_CONTENT_EXPANDED_LIMIT
    : LATEST_CONTENT_INITIAL_LIMIT;
  const items = allItems.slice(0, visibleLimit);

  listEl.innerHTML = items
    .map((item) => {
      const averageLabel = item.rating_count > 0
        ? `<span class="score-badge film-average-badge ${getScoreClass(item.average)}">${formatScore(item.average, 2, 2)} / 10</span>`
        : `<span class="score-badge film-average-badge stade-neutre">pas de note</span>`;
      const dateLabel = item.kind === "film" ? "Sortie" : "Derniere sortie";
      const secondDate = item.kind === "series" ? `<p>Fin: ${formatDate(item.end_date)}</p>` : "";
      const linkLabel = item.kind === "film" ? "Voir la page film" : "Voir la page serie";
      const linkHref = item.kind === "film" ? `/film.html?id=${item.id}` : `/series.html?id=${item.id}`;

      return `
        <article class="card film-card">
          <img src="${escapeHTML(item.poster_url || "https://via.placeholder.com/240x360?text=Marvel")}" alt="Affiche de ${escapeHTML(item.title)}" />
          <div>
            <h3>${escapeHTML(item.title)}</h3>
            <p class="film-average">Moyenne: ${averageLabel}</p>
            <p>${dateLabel}: ${formatDate(item.date)}</p>
            ${secondDate}
            <p class="film-meta">${escapeHTML(item.franchise || "-")} - ${escapeHTML(item.type || "-")}</p>
            <a class="button" href="${linkHref}">${linkLabel}</a>
          </div>
        </article>
      `;
    })
    .join("");

  if (!toggleEl) return;
  const canExpand = allItems.length > LATEST_CONTENT_INITIAL_LIMIT;
  toggleEl.style.display = canExpand ? "inline-flex" : "none";
  toggleEl.textContent = state.latestContentExpanded ? "Voir moins" : "Voir plus";
}

function buildSeasonActivityRows(seasons, episodes, episodeRatings, seasonUserRatings) {
  const rows = [];
  const seasonsById = new Map((seasons || []).map((season) => [season.id, season]));
  const episodesBySeasonId = new Map();
  for (const episode of episodes || []) {
    const current = episodesBySeasonId.get(episode.season_id) || [];
    current.push(episode);
    episodesBySeasonId.set(episode.season_id, current);
  }

  const episodeRatingsBySeasonAndUser = new Map();
  const episodesById = new Map((episodes || []).map((episode) => [episode.id, episode]));
  for (const rating of episodeRatings || []) {
    const episode = episodesById.get(rating.episode_id);
    if (!episode) continue;
    const key = `${episode.season_id}::${rating.user_id}`;
    const current = episodeRatingsBySeasonAndUser.get(key) || {
      total: 0,
      count: 0,
      lastCreatedAt: null,
      lastCreatedAtTs: 0,
      username: null
    };
    current.total += Number(rating.score || 0);
    current.count += 1;
    const createdTs = getTimeValue(rating.created_at);
    if (createdTs >= current.lastCreatedAtTs) {
      current.lastCreatedAtTs = createdTs;
      current.lastCreatedAt = rating.created_at || null;
      current.username = rating.profiles?.username || current.username;
    }
    episodeRatingsBySeasonAndUser.set(key, current);
  }

  const seasonRowsBySeasonAndUser = new Map();
  for (const row of seasonUserRatings || []) {
    seasonRowsBySeasonAndUser.set(`${row.season_id}::${row.user_id}`, row);
  }

  for (const season of seasons || []) {
    const seasonEpisodeCount = (episodesBySeasonId.get(season.id) || []).length;
    const seasonRowUsers = (seasonUserRatings || [])
      .filter((row) => row.season_id === season.id)
      .map((row) => row.user_id);
    const episodeUsers = Array.from(episodeRatingsBySeasonAndUser.keys())
      .filter((key) => key.startsWith(`${season.id}::`))
      .map((key) => key.split("::")[1]);
    const allUserIds = new Set([...episodeUsers, ...seasonRowUsers]);

    for (const userId of allUserIds) {
      const stats = episodeRatingsBySeasonAndUser.get(`${season.id}::${userId}`) || {
        total: 0,
        count: 0,
        lastCreatedAt: null,
        username: null
      };
      const seasonRow = seasonRowsBySeasonAndUser.get(`${season.id}::${userId}`);
      const manualScore = seasonRow?.manual_score === null || seasonRow?.manual_score === undefined
        ? null
        : Number(seasonRow.manual_score);
      const adjustment = Number(seasonRow?.adjustment || 0);
      const episodeAverage = stats.count ? stats.total / stats.count : null;
      const hasAllEpisodeRatings = seasonEpisodeCount > 0 && stats.count === seasonEpisodeCount;
      const effectiveScore = Number.isFinite(manualScore)
        ? clamp(manualScore, 0, 10)
        : (hasAllEpisodeRatings && Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);
      const hasManual = Number.isFinite(Number(seasonRow?.manual_score));
      const hasAdjustment = adjustment !== 0;
      const hasReview = String(seasonRow?.review || "").trim().length > 0;
      const hasAutoStatement = Number.isFinite(effectiveScore) && !hasManual && !hasAdjustment;
      if (!hasManual && !hasAdjustment && !hasReview && !hasAutoStatement) continue;

      rows.push({
        id: seasonRow?.id ? `season-${seasonRow.id}` : `season-auto-${season.id}-${userId}`,
        type: "season",
        user_id: userId,
        username: seasonRow?.profiles?.username || stats.username || "Utilisateur",
        created_at: seasonRow?.created_at || stats.lastCreatedAt,
        score: Number.isFinite(effectiveScore) ? effectiveScore : null,
        review: seasonRow?.review || "",
        adjustment,
        title: season.name || "Saison",
        seasonLabel: season.season_number ? `S${season.season_number}` : "Saison",
        href: `/season.html?id=${season.id}`
      });
    }
  }

  return rows;
}

function renderLatestActivity(rows, mediaByUserId) {
  const listEl = document.querySelector("#home-latest-activity-list");
  if (!listEl) return;

  if (!rows.length) {
    listEl.innerHTML = "<p>Aucune note ou critique enregistree pour le moment.</p>";
    return;
  }

  listEl.innerHTML = rows
    .map((row) => {
      const mediaNames = mediaByUserId.get(row.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";
      const scorePart = Number.isFinite(row.score)
        ? `<span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score, 2, 2)} / 10</span>`
        : '<span class="score-badge stade-neutre">Sans note</span>';
      const adjustmentPart = row.type === "season" && row.adjustment !== 0
        ? ` | Ajustement ${row.adjustment > 0 ? "+" : ""}${formatScore(row.adjustment, 2, 2)}`
        : "";
      const typeLabel = row.type === "film"
        ? "Film"
        : row.type === "series"
          ? "Serie"
          : row.type === "episode"
            ? "Episode"
            : "Saison";

      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(row.username || "Utilisateur")}</strong>
            <span>${escapeHTML(mediaLabel)}</span>
          </div>
          <p class="film-meta">${typeLabel} - ${escapeHTML(row.seasonLabel || "-")} - <a href="${row.href}" class="film-link">${escapeHTML(row.title)}</a></p>
          <p>${scorePart}<span class="film-meta">${escapeHTML(adjustmentPart)}</span></p>
          <p>${escapeHTML(row.review || "(Pas de commentaire)")}</p>
          <small>${formatDate(row.created_at)}</small>
        </article>
      `;
    })
    .join("");
}

async function loadHomePage() {
  try {
    const [
      { data: films, error: filmsError },
      { data: filmRatings, error: filmRatingsError },
      { data: series, error: seriesError },
      { data: seasons, error: seasonsError },
      { data: episodes, error: episodesError },
      { data: episodeRatings, error: episodeRatingsError },
      { data: seasonUserRatings, error: seasonUserRatingsError },
      { data: seriesReviews, error: seriesReviewsError },
      { data: ratings, error: ratingsError }
    ] = await Promise.all([
      supabase.from("films").select("id, title, release_date, poster_url, franchise, type"),
      supabase.from("ratings").select("film_id, score"),
      supabase.from("series").select("id, title, start_date, end_date, poster_url, franchise, type"),
      supabase.from("series_seasons").select("id, series_id, name, season_number, start_date"),
      supabase.from("series_episodes").select("id, season_id, title, episode_number"),
      supabase.from("episode_ratings").select("id, user_id, episode_id, score, review, created_at, profiles(username)"),
      supabase.from("season_user_ratings").select("id, user_id, season_id, manual_score, adjustment, review, created_at, profiles(username)"),
      supabase.from("series_reviews").select("id, user_id, series_id, review, created_at, profiles(username)"),
      supabase.from("ratings").select("id, user_id, film_id, score, review, created_at, profiles(username)")
    ]);

    if (filmsError) throw filmsError;
    if (filmRatingsError) throw filmRatingsError;
    if (seriesError) throw seriesError;
    if (seasonsError) throw seasonsError;
    if (episodesError) throw episodesError;
    if (episodeRatingsError) throw episodeRatingsError;
    if (seasonUserRatingsError) throw seasonUserRatingsError;
    if (seriesReviewsError) throw seriesReviewsError;
    if (ratingsError) throw ratingsError;

    const filmScoreById = new Map();
    for (const row of filmRatings || []) {
      const current = filmScoreById.get(row.film_id) || { total: 0, count: 0 };
      current.total += Number(row.score || 0);
      current.count += 1;
      filmScoreById.set(row.film_id, current);
    }

    const seriesAverageById = computeSeriesListAverages(
      series || [],
      seasons || [],
      episodes || [],
      episodeRatings || [],
      seasonUserRatings || []
    );

    const releasedFilms = (films || [])
      .filter((film) => isReleasedOnOrBeforeToday(film.release_date))
      .map((film) => {
        const scoreData = filmScoreById.get(film.id) || { total: 0, count: 0 };
        return {
          kind: "film",
          id: film.id,
          title: film.title,
          poster_url: film.poster_url,
          franchise: film.franchise,
          type: film.type,
          date: film.release_date,
          end_date: null,
          rating_count: scoreData.count,
          average: scoreData.count ? scoreData.total / scoreData.count : null
        };
      });

    const seasonsBySeriesId = new Map();
    for (const season of seasons || []) {
      const current = seasonsBySeriesId.get(season.series_id) || [];
      current.push(season);
      seasonsBySeriesId.set(season.series_id, current);
    }

    const releasedSeries = (series || [])
      .map((row) => {
        const highlightDate = getSeriesHighlightDate(row, seasonsBySeriesId);
        if (!isReleasedOnOrBeforeToday(highlightDate)) return null;
        const averageData = seriesAverageById.get(row.id) || { average: null, count: 0 };
        return {
          kind: "series",
          id: row.id,
          title: row.title,
          poster_url: row.poster_url,
          franchise: row.franchise,
          type: row.type,
          date: highlightDate,
          end_date: row.end_date,
          rating_count: averageData.count,
          average: averageData.average
        };
      })
      .filter(Boolean);

    const latestContent = [...releasedFilms, ...releasedSeries]
      .sort((a, b) => getTimeValue(b.date) - getTimeValue(a.date))
      .slice(0, LATEST_CONTENT_EXPANDED_LIMIT);

    renderLatestContent(latestContent);
    const contentToggleEl = document.querySelector("#home-latest-content-toggle");
    contentToggleEl?.addEventListener("click", () => {
      state.latestContentExpanded = !state.latestContentExpanded;
      renderLatestContent(latestContent);
    });

    const filmById = new Map((films || []).map((film) => [film.id, film]));
    const seriesById = new Map((series || []).map((row) => [row.id, row]));
    const seasonById = new Map((seasons || []).map((season) => [season.id, season]));
    const episodeById = new Map((episodes || []).map((episode) => [episode.id, episode]));

    const activityRows = [];

    for (const rating of ratings || []) {
      const film = filmById.get(rating.film_id);
      if (!film) continue;
      activityRows.push({
        id: `film-${rating.id}`,
        type: "film",
        user_id: rating.user_id,
        username: rating.profiles?.username || "Utilisateur",
        created_at: rating.created_at || null,
        score: Number(rating.score),
        review: rating.review || "",
        seasonLabel: "Film",
        title: film.title || "Film",
        href: `/film.html?id=${film.id}`,
        adjustment: 0
      });
    }

    for (const review of seriesReviews || []) {
      const serie = seriesById.get(review.series_id);
      if (!serie) continue;
      activityRows.push({
        id: `series-${review.id}`,
        type: "series",
        user_id: review.user_id,
        username: review.profiles?.username || "Utilisateur",
        created_at: review.created_at || null,
        score: null,
        review: review.review || "",
        seasonLabel: "Serie",
        title: serie.title || "Serie",
        href: `/series.html?id=${serie.id}`,
        adjustment: 0
      });
    }

    for (const rating of episodeRatings || []) {
      const episode = episodeById.get(rating.episode_id);
      if (!episode) continue;
      const season = seasonById.get(episode.season_id);
      if (!Number.isFinite(Number(rating.score)) && !String(rating.review || "").trim()) continue;
      activityRows.push({
        id: `episode-${rating.id}`,
        type: "episode",
        user_id: rating.user_id,
        username: rating.profiles?.username || "Utilisateur",
        created_at: rating.created_at || null,
        score: Number(rating.score),
        review: rating.review || "",
        seasonLabel: season?.season_number ? `S${season.season_number}` : "Saison",
        title: episode.title || "Episode",
        href: `/episode.html?id=${episode.id}`,
        adjustment: 0
      });
    }

    const seasonRows = buildSeasonActivityRows(
      seasons || [],
      episodes || [],
      episodeRatings || [],
      seasonUserRatings || []
    );
    activityRows.push(...seasonRows);

    const latestActivity = activityRows
      .sort((a, b) => getTimeValue(b.created_at) - getTimeValue(a.created_at))
      .slice(0, LATEST_ACTIVITY_LIMIT);

    const userIds = [...new Set(latestActivity.map((row) => row.user_id).filter(Boolean))];
    const mediaByUserId = await loadMembershipMapForUsers(userIds);
    renderLatestActivity(latestActivity, mediaByUserId);
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement de la page d'accueil.", true);
  }
}

loadHomePage();
