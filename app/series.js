import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  formatDate,
  formatScore,
  getScoreClass,
  getSeriesIdFromURL,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";
import { getSession, requireAuth } from "./auth.js";

const state = {
  currentUserId: null,
  series: null,
  seasons: [],
  episodes: [],
  episodeRatings: [],
  seasonUserRatings: [],
  seriesReviews: [],
  socialExpanded: {
    reviews: false,
    activity: false
  }
};

const SOCIAL_MOBILE_QUERY = "(max-width: 700px)";
const SOCIAL_MOBILE_VISIBLE_ITEMS = 4;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getDateSortValue(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function toFixedNumber(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function buildAdjustmentTargets(base) {
  const minEffective = clamp(base - 2, 0, 10);
  const maxEffective = clamp(base + 2, 0, 10);
  const targets = new Set([toFixedNumber(clamp(base, 0, 10))]);

  const startQuarter = Math.ceil((minEffective - 1e-9) * 4);
  const endQuarter = Math.floor((maxEffective + 1e-9) * 4);
  for (let quarter = startQuarter; quarter <= endQuarter; quarter += 1) {
    targets.add(toFixedNumber(quarter / 4));
  }

  return Array.from(targets).sort((a, b) => a - b);
}

function getOpenSeasonIdsFromDOM() {
  return new Set(
    Array.from(document.querySelectorAll("details[data-season-id][open]"))
      .map((el) => el.dataset.seasonId)
      .filter(Boolean)
  );
}

function canReviewSeries() {
  return isReleasedOnOrBeforeToday(state.series?.start_date || null);
}

function applySeriesReviewAvailability() {
  const canReview = canReviewSeries();
  const messageEl = document.querySelector("#series-rating-unavailable-message");
  const form = document.querySelector("#series-review-form");
  const message = "Cette serie n'est pas encore sortie (ou n'a pas de date de debut). Les critiques sont desactivees.";

  if (messageEl) {
    messageEl.textContent = canReview ? "" : message;
    messageEl.style.display = canReview ? "none" : "block";
  }

  if (!form) return;
  const controls = form.querySelectorAll("textarea, button");
  for (const control of controls) {
    control.disabled = !canReview;
  }
}

function isSeasonRateable(season) {
  return isReleasedOnOrBeforeToday(season?.start_date || null);
}

function computeSeasonMetrics(seasonId) {
  const seasonEpisodes = state.episodes.filter((episode) => episode.season_id === seasonId);
  const episodeIds = new Set(seasonEpisodes.map((episode) => episode.id));

  const episodeAveragesByUser = new Map();
  for (const rating of state.episodeRatings) {
    if (!episodeIds.has(rating.episode_id)) continue;
    const current = episodeAveragesByUser.get(rating.user_id) || { total: 0, count: 0 };
    current.total += Number(rating.score || 0);
    current.count += 1;
    episodeAveragesByUser.set(rating.user_id, current);
  }

  const perUser = new Map();
  for (const [userId, value] of episodeAveragesByUser.entries()) {
    perUser.set(userId, {
      episodeAverage: value.count ? value.total / value.count : null,
      manualScore: null,
      adjustment: 0
    });
  }

  for (const row of state.seasonUserRatings.filter((item) => item.season_id === seasonId)) {
    const existing = perUser.get(row.user_id) || { episodeAverage: null, manualScore: null, adjustment: 0 };
    existing.manualScore = row.manual_score === null ? null : Number(row.manual_score);
    existing.adjustment = Number(row.adjustment || 0);
    perUser.set(row.user_id, existing);
  }

  const effectiveScores = [];
  for (const value of perUser.values()) {
    if (value.manualScore !== null) {
      const effective = clamp(value.manualScore, 0, 10);
      effectiveScores.push(effective);
      continue;
    }
    if (!Number.isFinite(value.episodeAverage)) continue;
    const effective = clamp(value.episodeAverage + value.adjustment, 0, 10);
    effectiveScores.push(effective);
  }

  const siteAverage = effectiveScores.length
    ? effectiveScores.reduce((sum, score) => sum + score, 0) / effectiveScores.length
    : null;

  const user = perUser.get(state.currentUserId) || { episodeAverage: null, manualScore: null, adjustment: 0 };
  const userEffective = user.manualScore !== null
    ? clamp(user.manualScore, 0, 10)
    : (Number.isFinite(user.episodeAverage) ? clamp(user.episodeAverage + user.adjustment, 0, 10) : null);

  return {
    episodeCount: seasonEpisodes.length,
    userEpisodeAverage: user.episodeAverage,
    userManualScore: user.manualScore,
    userAdjustment: user.adjustment,
    userEffective,
    siteAverage
  };
}

function computeSeriesAverageByUserId() {
  const totalSeasons = state.seasons.length;
  const userAverageById = new Map();
  if (!totalSeasons) {
    return userAverageById;
  }

  const userSeasonScores = new Map();
  for (const season of state.seasons) {
    const seasonEpisodes = state.episodes.filter((episode) => episode.season_id === season.id);
    const episodeIds = new Set(seasonEpisodes.map((episode) => episode.id));

    const episodeByUser = new Map();
    for (const rating of state.episodeRatings) {
      if (!episodeIds.has(rating.episode_id)) continue;
      const current = episodeByUser.get(rating.user_id) || { total: 0, count: 0 };
      current.total += Number(rating.score || 0);
      current.count += 1;
      episodeByUser.set(rating.user_id, current);
    }

      const seasonRows = state.seasonUserRatings.filter((row) => row.season_id === season.id);
      const allUserIds = new Set([...episodeByUser.keys(), ...seasonRows.map((row) => row.user_id)]);

      for (const userId of allUserIds) {
        const manualRow = seasonRows.find((row) => row.user_id === userId);
        const episodeValues = episodeByUser.get(userId);
        const episodeAverage = episodeValues ? episodeValues.total / episodeValues.count : null;
        const manual = manualRow?.manual_score === null || manualRow?.manual_score === undefined
          ? null
          : Number(manualRow.manual_score);
        const adjustment = Number(manualRow?.adjustment || 0);
        const effective = manual !== null
          ? clamp(manual, 0, 10)
          : (Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);
        if (!Number.isFinite(effective)) continue;

        const current = userSeasonScores.get(userId) || [];
        current.push(effective);
        userSeasonScores.set(userId, current);
      }
  }

  for (const [userId, seasonScores] of userSeasonScores.entries()) {
    if (!seasonScores.length) continue;
    const userAverage = seasonScores.reduce((sum, value) => sum + value, 0) / seasonScores.length;
    userAverageById.set(userId, userAverage);
  }

  return userAverageById;
}

function computeSeriesAverages() {
  const totalSeasons = state.seasons.length;
  const userAverageById = computeSeriesAverageByUserId();
  if (!totalSeasons || !userAverageById.size) {
    return {
      globalAverage: null,
      myAverage: null,
      contributorCount: 0
    };
  }

  const userSeasonScores = new Map();
  for (const season of state.seasons) {
    const seasonEpisodes = state.episodes.filter((episode) => episode.season_id === season.id);
    const episodeIds = new Set(seasonEpisodes.map((episode) => episode.id));

    const episodeByUser = new Map();
    for (const rating of state.episodeRatings) {
      if (!episodeIds.has(rating.episode_id)) continue;
      const current = episodeByUser.get(rating.user_id) || { total: 0, count: 0 };
      current.total += Number(rating.score || 0);
      current.count += 1;
      episodeByUser.set(rating.user_id, current);
    }

    const seasonRows = state.seasonUserRatings.filter((row) => row.season_id === season.id);
    const allUserIds = new Set([...episodeByUser.keys(), ...seasonRows.map((row) => row.user_id)]);

    for (const userId of allUserIds) {
      const manualRow = seasonRows.find((row) => row.user_id === userId);
      const episodeValues = episodeByUser.get(userId);
      const episodeAverage = episodeValues ? episodeValues.total / episodeValues.count : null;
      const manual = manualRow?.manual_score === null || manualRow?.manual_score === undefined
        ? null
        : Number(manualRow.manual_score);
      const adjustment = Number(manualRow?.adjustment || 0);
      const effective = manual !== null
        ? clamp(manual, 0, 10)
        : (Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);
      if (!Number.isFinite(effective)) continue;

      const current = userSeasonScores.get(userId) || [];
      current.push(effective);
      userSeasonScores.set(userId, current);
    }
  }

  let weightedSum = 0;
  let coverageWeightSum = 0;
  for (const [userId, seasonScores] of userSeasonScores.entries()) {
    if (!seasonScores.length) continue;
    const userAverage = userAverageById.get(userId);
    if (!Number.isFinite(userAverage)) continue;
    const coverage = seasonScores.length / totalSeasons;
    weightedSum += userAverage * coverage;
    coverageWeightSum += coverage;
  }

  if (coverageWeightSum <= 0) {
    return {
      globalAverage: null,
      myAverage: null,
      contributorCount: 0
    };
  }

  return {
    globalAverage: weightedSum / coverageWeightSum,
    myAverage: state.currentUserId ? (userAverageById.get(state.currentUserId) ?? null) : null,
    contributorCount: userAverageById.size
  };
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
        const effective = manual !== null
          ? clamp(manual, 0, 10)
          : (Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);
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

function renderSeriesList(rows) {
  const listEl = document.querySelector("#series-list");
  if (!rows.length) {
    listEl.innerHTML = "<p>Aucune serie pour le moment.</p>";
    return;
  }

  listEl.innerHTML = rows
    .map((item) => `
      <article class="card film-card">
        <img src="${escapeHTML(item.poster_url || "https://via.placeholder.com/240x360?text=Serie")}" alt="Affiche de ${escapeHTML(item.title)}" />
        <div>
          <h3>${escapeHTML(item.title)}</h3>
          <p class="film-average">${
            item.rating_count > 0
              ? `Moyenne: <span class="score-badge film-average-badge ${getScoreClass(item.average)}">${formatScore(item.average, 2, 2)} / 10</span>`
              : `Moyenne: <span class="score-badge film-average-badge stade-neutre">pas de note</span>`
          }</p>
          <p>Debut: ${formatDate(item.start_date)}</p>
          <p>Fin: ${formatDate(item.end_date)}</p>
          <p class="film-meta">${escapeHTML(item.franchise || "-")} - ${escapeHTML(item.type || "Serie")}</p>
          <a class="button" href="/series.html?id=${item.id}">Voir la page serie</a>
        </div>
      </article>
    `)
    .join("");
}

function renderSeriesHeader() {
  const detailsEl = document.querySelector("#series-details");
  const series = state.series;
  detailsEl.innerHTML = `
    <article class="card film-hero">
      <div class="film-hero-content">
        <h1>${escapeHTML(series.title)}</h1>
        <p>Debut: ${formatDate(series.start_date)} - Fin: ${formatDate(series.end_date)}</p>
        <p>${escapeHTML(series.synopsis || "Aucun synopsis.")}</p>
      </div>
      <img class="film-hero-poster" src="${escapeHTML(series.poster_url || "https://via.placeholder.com/260x390?text=Serie")}" alt="Affiche de ${escapeHTML(series.title)}" />
    </article>
  `;
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

function isSocialMobileLayout() {
  return window.matchMedia(SOCIAL_MOBILE_QUERY).matches;
}

function updateSocialMoreButton(selector, shouldShow, expanded) {
  const button = document.querySelector(selector);
  if (!button) return;
  button.style.display = shouldShow ? "inline-flex" : "none";
  button.textContent = expanded ? "Voir moins" : "Voir plus";
}

function getSeriesSocialUserIds() {
  return [...new Set([
    ...state.seriesReviews.map((row) => row.user_id),
    ...state.episodeRatings.map((row) => row.user_id),
    ...state.seasonUserRatings.map((row) => row.user_id)
  ])];
}

function getSocialTimeValue(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeSeasonEffectiveScoreForUser(seasonId, userId) {
  const seasonEpisodeIds = new Set(
    state.episodes
      .filter((episode) => episode.season_id === seasonId)
      .map((episode) => episode.id)
  );

  let episodeTotal = 0;
  let episodeCount = 0;
  for (const rating of state.episodeRatings) {
    if (rating.user_id !== userId || !seasonEpisodeIds.has(rating.episode_id)) continue;
    const score = Number(rating.score);
    if (!Number.isFinite(score)) continue;
    episodeTotal += score;
    episodeCount += 1;
  }

  const seasonRow = state.seasonUserRatings.find(
    (row) => row.season_id === seasonId && row.user_id === userId
  );
  const manualScore = seasonRow?.manual_score === null || seasonRow?.manual_score === undefined
    ? null
    : Number(seasonRow.manual_score);
  const adjustment = Number(seasonRow?.adjustment || 0);

  if (Number.isFinite(manualScore)) {
    return clamp(manualScore, 0, 10);
  }

  if (!episodeCount) {
    return null;
  }

  const episodeAverage = episodeTotal / episodeCount;
  return clamp(episodeAverage + adjustment, 0, 10);
}

function buildSeriesSocialActivityRows() {
  const seasonsById = new Map(state.seasons.map((season) => [season.id, season]));
  const episodesById = new Map(state.episodes.map((episode) => [episode.id, episode]));
  const rows = [];

  for (const rating of state.episodeRatings) {
    if (!Number.isFinite(Number(rating.score)) && !String(rating.review || "").trim()) continue;
    const episode = episodesById.get(rating.episode_id);
    if (!episode) continue;
    const season = seasonsById.get(episode.season_id);
    rows.push({
      id: `episode-${rating.id}`,
      type: "episode",
      user_id: rating.user_id,
      username: rating.profiles?.username || "Utilisateur",
      created_at: rating.created_at || null,
      score: Number(rating.score),
      review: rating.review || "",
      href: `/episode.html?id=${episode.id}`,
      title: episode.title || "Episode",
      seasonLabel: season?.season_number ? `S${season.season_number}` : "Saison"
    });
  }

  for (const rating of state.seasonUserRatings) {
    const hasManual = Number.isFinite(Number(rating.manual_score));
    const hasAdjustment = Number(rating.adjustment || 0) !== 0;
    const hasReview = String(rating.review || "").trim().length > 0;
    if (!hasManual && !hasAdjustment && !hasReview) continue;
    const season = seasonsById.get(rating.season_id);
    const effectiveScore = computeSeasonEffectiveScoreForUser(rating.season_id, rating.user_id);
    rows.push({
      id: `season-${rating.id}`,
      type: "season",
      user_id: rating.user_id,
      username: rating.profiles?.username || "Utilisateur",
      created_at: rating.created_at || null,
      score: Number.isFinite(effectiveScore) ? effectiveScore : null,
      adjustment: Number(rating.adjustment || 0),
      review: rating.review || "",
      href: `/season.html?id=${rating.season_id}`,
      title: season?.name || "Saison",
      seasonLabel: season?.season_number ? `S${season.season_number}` : "Saison"
    });
  }

  return rows.sort((a, b) => getSocialTimeValue(b.created_at) - getSocialTimeValue(a.created_at));
}

function renderSeriesReviews(mediaByUserId = new Map()) {
  const listEl = document.querySelector("#series-reviews-list");
  if (!listEl) return;
  const userAverageById = computeSeriesAverageByUserId();
  const isMobile = isSocialMobileLayout();
  const shouldTruncate = isMobile && !state.socialExpanded.reviews;

  if (!state.seriesReviews.length) {
    listEl.innerHTML = "<p>Aucune critique pour cette serie.</p>";
    updateSocialMoreButton('[data-action="toggle-series-reviews-more"]', false, state.socialExpanded.reviews);
    return;
  }

  const reviewsToShow = shouldTruncate
    ? state.seriesReviews.slice(0, SOCIAL_MOBILE_VISIBLE_ITEMS)
    : state.seriesReviews;

  listEl.innerHTML = reviewsToShow
    .map((review) => {
      const profile = review.profiles || {};
      const mediaNames = mediaByUserId.get(review.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";
      const userAverage = userAverageById.get(review.user_id);
      const userAverageLabel = Number.isFinite(userAverage)
        ? `<span class="score-badge ${getScoreClass(userAverage)}">${formatScore(userAverage, 2, 2)} / 10</span>`
        : `<span class="score-badge stade-neutre">Pas de moyenne</span>`;

      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(profile.username || "Utilisateur")}</strong>
            <span>${escapeHTML(mediaLabel)}</span>
          </div>
          <p class="film-meta">Moyenne de la personne sur cette serie: ${userAverageLabel}</p>
          <p>${escapeHTML(review.review || "(Pas de commentaire)")}</p>
          <small>${formatDate(review.created_at)}</small>
        </article>
      `;
    })
    .join("");

  updateSocialMoreButton(
    '[data-action="toggle-series-reviews-more"]',
    isMobile && state.seriesReviews.length > SOCIAL_MOBILE_VISIBLE_ITEMS,
    state.socialExpanded.reviews
  );
}

function renderSeriesSocialActivity(mediaByUserId = new Map()) {
  const listEl = document.querySelector("#series-social-activity-list");
  if (!listEl) return;

  const rows = buildSeriesSocialActivityRows();
  const isMobile = isSocialMobileLayout();
  const shouldTruncate = isMobile && !state.socialExpanded.activity;
  const rowsToShow = shouldTruncate ? rows.slice(0, SOCIAL_MOBILE_VISIBLE_ITEMS) : rows;

  if (!rows.length) {
    listEl.innerHTML = "<p>Aucune note ou critique recente sur les saisons/episodes.</p>";
    updateSocialMoreButton('[data-action="toggle-series-activity-more"]', false, state.socialExpanded.activity);
    return;
  }

  listEl.innerHTML = rowsToShow
    .map((row) => {
      const mediaNames = mediaByUserId.get(row.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";
      const scorePart = Number.isFinite(row.score)
        ? `<span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score, 2, 2)} / 10</span>`
        : '<span class="score-badge stade-neutre">Sans note</span>';
      const adjustmentPart = row.type === "season" && row.adjustment !== 0
        ? ` | Ajustement ${row.adjustment > 0 ? "+" : ""}${formatScore(row.adjustment, 2, 2)}`
        : "";

      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(row.username)}</strong>
            <span>${escapeHTML(mediaLabel)}</span>
          </div>
          <p class="film-meta">
            ${row.type === "episode" ? "Episode" : "Saison"} - ${escapeHTML(row.seasonLabel)} - <a href="${row.href}" class="film-link">${escapeHTML(row.title)}</a>
          </p>
          <p>${scorePart}<span class="film-meta">${escapeHTML(adjustmentPart)}</span></p>
          <p>${escapeHTML(row.review || "(Pas de commentaire)")}</p>
          <small>${formatDate(row.created_at)}</small>
        </article>
      `;
    })
    .join("");

  updateSocialMoreButton(
    '[data-action="toggle-series-activity-more"]',
    isMobile && rows.length > SOCIAL_MOBILE_VISIBLE_ITEMS,
    state.socialExpanded.activity
  );
}

function fillCurrentUserSeriesReview() {
  const textarea = document.querySelector("#series-review");
  const deleteBtn = document.querySelector("#series-review-delete-button");
  if (!textarea || !deleteBtn) return;

  const myReview = state.seriesReviews.find((row) => row.user_id === state.currentUserId);
  textarea.value = myReview?.review || "";
  deleteBtn.style.display = myReview ? "inline-flex" : "none";
}

function renderSeriesAverage() {
  const globalEl = document.querySelector("#series-global-average");
  const myEl = document.querySelector("#series-my-average");
  const metrics = computeSeriesAverages();

  globalEl.innerHTML = metrics.globalAverage === null
    ? `<span class="score-badge stade-neutre">Pas encore de note</span>`
    : `
      <span class="score-badge ${getScoreClass(metrics.globalAverage)}">${formatScore(metrics.globalAverage, 2, 2)} / 10</span>
      <span>${metrics.contributorCount} profil(s) contributeur(s)</span>
    `;

  myEl.innerHTML = metrics.myAverage === null
    ? `<span class="score-badge stade-neutre">Tu n'as pas encore de moyenne sur cette serie</span>`
    : `<span class="score-badge ${getScoreClass(metrics.myAverage)}">${formatScore(metrics.myAverage, 2, 2)} / 10</span>`;
}

function renderSeasons(openSeasonIds = null) {
  const container = document.querySelector("#series-seasons-list");
  if (!state.seasons.length) {
    container.innerHTML = "<p>Aucune saison pour cette serie.</p>";
    return;
  }

  const initialOpenAll = openSeasonIds === null;

  container.innerHTML = state.seasons
    .map((season) => {
      const seasonEpisodes = state.episodes
        .filter((episode) => episode.season_id === season.id)
        .sort((a, b) => a.episode_number - b.episode_number);
      const metrics = computeSeasonMetrics(season.id);
      const canRateSeason = isSeasonRateable(season);
      const episodeAverageById = new Map();
      for (const episode of seasonEpisodes) {
        const ratings = state.episodeRatings.filter((rating) => rating.episode_id === episode.id);
        if (!ratings.length) {
          episodeAverageById.set(episode.id, null);
          continue;
        }
        const total = ratings.reduce((sum, rating) => sum + Number(rating.score || 0), 0);
        episodeAverageById.set(episode.id, total / ratings.length);
      }

      const seasonAverage = metrics.userEpisodeAverage === null
        ? `Pas de note`
        : `${formatScore(metrics.userEpisodeAverage, 2, 2)} / 10`;

      const siteAverage = metrics.siteAverage === null
        ? `Pas de note`
        : `${formatScore(metrics.siteAverage, 2, 2)} / 10`;
      const siteAverageBadge = metrics.siteAverage === null
        ? `<span class="score-badge stade-neutre">Pas de note</span>`
        : `<span class="score-badge ${getScoreClass(metrics.siteAverage)}">${formatScore(metrics.siteAverage, 2, 2)} / 10</span>`;

      const userAverage = metrics.userEffective === null
        ? `<span class="score-badge stade-neutre">-</span>`
        : `<span class="score-badge ${getScoreClass(metrics.userEffective)}">${formatScore(metrics.userEffective, 2, 2)} / 10</span>`;

      const manualValue = metrics.userManualScore === null ? "" : String(metrics.userManualScore);
      const adjustmentValue = formatScore(metrics.userAdjustment, 2, 2);
      const isOpen = initialOpenAll || openSeasonIds.has(season.id);

      return `
        <article class="card">
          <div class="season-card-header">
            <h3>
              <a href="/season.html?id=${season.id}" class="film-link">${escapeHTML(season.name || `Saison ${season.season_number}`)}</a>
              <small>(voir details)</small>
              - Moyenne du site: ${siteAverageBadge}
            </h3>
            <a href="/season.html?id=${season.id}" class="ghost-button season-open-button">Ouvrir</a>
          </div>
          <p>Phase: ${escapeHTML(season.phase || "-")} | Debut: ${formatDate(season.start_date)} | Fin: ${formatDate(season.end_date)}</p>
          <p>Moyenne de tes episodes: <b>${seasonAverage}</b></p>

          <div class="inline-actions season-adjuster">
            <span>Ajusteur de moyenne</span>
            <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-down" data-season-id="${season.id}" aria-label="Diminuer l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
              <i class="fa-solid fa-minus" aria-hidden="true"></i>
            </button>
            <strong data-field="season-adjustment-value">${adjustmentValue}</strong>
            <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-up" data-season-id="${season.id}" aria-label="Augmenter l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
              <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
            <button type="button" class="icon-circle-btn neutral small" data-action="reset-season-adjustment" data-season-id="${season.id}" aria-label="Reinitialiser l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>

          <p>Ta note effective de saison: ${userAverage}</p>
          <p class="film-meta">Base perso: ${metrics.userManualScore === null ? "Moyenne de tes episodes" : "Note de saison manuelle"} | Episodes: ${metrics.episodeCount}</p>

          <div class="season-controls">
            <p class="film-meta season-manual-help">Renseigner une note generale pour toute la saison (optionnel).</p>
            <div class="inline-actions inline-edit">
              <input data-field="season-manual-score" data-season-id="${season.id}" type="number" min="0" max="10" step="0.25" value="${manualValue}" placeholder="Note saison (optionnelle)" ${canRateSeason ? "" : "disabled"} />
              <button type="button" class="icon-circle-btn save" data-action="save-season-manual" data-season-id="${season.id}" aria-label="Valider la note de saison" ${canRateSeason ? "" : "disabled"}>
                <i class="fa-solid fa-check" aria-hidden="true"></i>
              </button>
              ${metrics.userManualScore === null ? "" : `
                <button type="button" class="icon-circle-btn delete" data-action="delete-season-manual" data-season-id="${season.id}" aria-label="Supprimer la note manuelle de saison" ${canRateSeason ? "" : "disabled"}>
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
              `}
            </div>
          </div>

          <details class="season-episodes" data-season-id="${season.id}" ${isOpen ? "open" : ""}>
            <summary class="season-episodes-summary">
              <span>Episodes</span>
              <small>Cliquer pour replier / deplier</small>
            </summary>
            <div class="table-wrapper">
              <table class="ranking-table compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Episode</th>
                    <th>Diffusion</th>
                    <th>Moyenne</th>
                    <th>Ta note</th>
                    <th>Modifier</th>
                  </tr>
                </thead>
                <tbody>
                  ${seasonEpisodes.map((episode) => {
                    const userRating = state.episodeRatings.find(
                      (rating) => rating.episode_id === episode.id && rating.user_id === state.currentUserId
                    );
                    const canRate = isReleasedOnOrBeforeToday(episode.air_date);
                    const scoreValue = userRating ? String(userRating.score) : "";
                    const scoreBadge = userRating
                      ? `<span class="score-badge ${getScoreClass(userRating.score)}">${formatScore(userRating.score)} / 10</span>`
                      : `<span class="score-badge stade-neutre">-</span>`;
                    const episodeAverage = episodeAverageById.get(episode.id);
                    const averageBadge = Number.isFinite(episodeAverage)
                      ? `<span class="score-badge ${getScoreClass(episodeAverage)}">${formatScore(episodeAverage, 2, 2)}</span>`
                      : `<span class="score-badge stade-neutre">-</span>`;

                    return `
                      <tr>
                        <td>${episode.episode_number}</td>
                        <td><a href="/episode.html?id=${episode.id}" class="film-link">${escapeHTML(episode.title)}</a></td>
                        <td>${formatDate(episode.air_date)}</td>
                        <td>${averageBadge}</td>
                        <td>${scoreBadge}</td>
                        <td class="actions-cell">
                          <div class="inline-actions inline-edit">
                            <a href="/episode.html?id=${episode.id}" class="icon-circle-btn neutral small icon-link" aria-label="Ouvrir la page episode">
                              <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>
                            </a>
                            <input data-field="episode-score" data-episode-id="${episode.id}" type="number" min="0" max="10" step="0.25" value="${scoreValue}" placeholder="0 a 10" ${canRate ? "" : "disabled"} />
                            <button type="button" class="icon-circle-btn save" data-action="save-episode-rating" data-episode-id="${episode.id}" ${canRate ? "" : "disabled"} aria-label="Valider la note d'episode">
                              <i class="fa-solid fa-check" aria-hidden="true"></i>
                            </button>
                            ${userRating ? `
                              <button type="button" class="icon-circle-btn delete" data-action="delete-episode-rating" data-episode-id="${episode.id}" ${canRate ? "" : "disabled"} aria-label="Supprimer la note d'episode">
                                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                              </button>
                            ` : ""}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </details>
        </article>
      `;
    })
    .join("");
}

async function loadSeriesStructure(seriesId) {
  const [{ data: series, error: seriesError }, { data: seasons, error: seasonsError }] = await Promise.all([
    supabase
      .from("series")
      .select("id, title, slug, synopsis, poster_url, start_date, end_date, franchise, type")
      .eq("id", seriesId)
      .single(),
    supabase
      .from("series_seasons")
      .select("id, series_id, name, season_number, slug, poster_url, start_date, end_date, phase")
      .eq("series_id", seriesId)
      .order("season_number", { ascending: true })
  ]);

  if (seriesError) throw seriesError;
  if (seasonsError) throw seasonsError;

  const seasonIds = (seasons || []).map((season) => season.id);
  const { data: episodes, error: episodesError } = seasonIds.length
    ? await supabase
      .from("series_episodes")
      .select("id, season_id, episode_number, title, air_date")
      .in("season_id", seasonIds)
    : { data: [], error: null };

  if (episodesError) throw episodesError;

  state.series = series;
  state.seasons = seasons || [];
  state.episodes = episodes || [];
}

async function loadRatingsData() {
  const seasonIds = state.seasons.map((season) => season.id);
  const episodeIds = state.episodes.map((episode) => episode.id);

  const [
    { data: episodeRatings, error: episodeRatingsError },
    { data: seasonUserRatings, error: seasonUserRatingsError },
    { data: seriesReviews, error: seriesReviewsError }
  ] = await Promise.all([
    episodeIds.length
      ? supabase
        .from("episode_ratings")
        .select("id, episode_id, user_id, score, review, created_at, profiles(username)")
        .in("episode_id", episodeIds)
    : Promise.resolve({ data: [], error: null }),
    seasonIds.length
      ? supabase
        .from("season_user_ratings")
        .select("id, season_id, user_id, manual_score, adjustment, review, created_at, profiles(username)")
        .in("season_id", seasonIds)
      : Promise.resolve({ data: [], error: null }),
    state.series?.id
      ? supabase
        .from("series_reviews")
        .select("id, series_id, user_id, review, created_at, profiles(username)")
        .eq("series_id", state.series.id)
        .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);

  if (episodeRatingsError) throw episodeRatingsError;
  if (seasonUserRatingsError) throw seasonUserRatingsError;
  if (seriesReviewsError) throw seriesReviewsError;

  state.episodeRatings = episodeRatings || [];
  state.seasonUserRatings = seasonUserRatings || [];
  state.seriesReviews = seriesReviews || [];
}

async function reloadSeriesDetails(seriesId) {
  await loadSeriesStructure(seriesId);
  await loadRatingsData();
  renderSeriesHeader();
  applySeriesReviewAvailability();
  fillCurrentUserSeriesReview();
  renderSeriesAverage();
  const userIds = getSeriesSocialUserIds();
  const mediaByUserId = await loadMembershipMapForUsers(userIds);
  renderSeriesReviews(mediaByUserId);
  renderSeriesSocialActivity(mediaByUserId);
  renderSeasons();
}

async function refreshRatingsOnly() {
  const openSeasonIds = getOpenSeasonIdsFromDOM();
  await loadRatingsData();
  applySeriesReviewAvailability();
  fillCurrentUserSeriesReview();
  renderSeriesAverage();
  const userIds = getSeriesSocialUserIds();
  const mediaByUserId = await loadMembershipMapForUsers(userIds);
  renderSeriesReviews(mediaByUserId);
  renderSeriesSocialActivity(mediaByUserId);
  renderSeasons(openSeasonIds);
}

async function saveSeriesReview() {
  const session = await requireAuth("/login.html");
  if (!session) return;
  if (!canReviewSeries()) {
    setMessage("#series-review-message", "Impossible de commenter une serie non sortie ou sans date de debut.", true);
    return;
  }

  const textarea = document.querySelector("#series-review");
  const reviewValue = textarea?.value?.trim() || "";
  if (!reviewValue) {
    setMessage("#series-review-message", "La critique est vide.", true);
    return;
  }

  const { error } = await supabase.from("series_reviews").upsert(
    {
      user_id: session.user.id,
      series_id: state.series.id,
      review: reviewValue
    },
    { onConflict: "user_id,series_id" }
  );
  if (error) throw error;
  setMessage("#series-review-message", "Critique serie enregistree.");
}

async function deleteSeriesReview() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const { error } = await supabase
    .from("series_reviews")
    .delete()
    .eq("user_id", session.user.id)
    .eq("series_id", state.series.id);
  if (error) throw error;
  setMessage("#series-review-message", "Critique serie supprimee.");
}

async function saveEpisodeRating(episodeId) {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const episode = state.episodes.find((item) => item.id === episodeId);
  if (!isReleasedOnOrBeforeToday(episode?.air_date || null)) {
    setMessage("#page-message", "Impossible de noter un episode non diffuse ou sans date de diffusion.", true);
    return;
  }

  const scoreInput = document.querySelector(`[data-field="episode-score"][data-episode-id="${episodeId}"]`);
  const scoreRaw = scoreInput?.value.trim() || "";
  if (!scoreRaw) {
    setMessage("#page-message", "Le score est obligatoire.", true);
    return;
  }

  const score = Number(scoreRaw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#page-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const { error } = await supabase.from("episode_ratings").upsert(
    {
      user_id: session.user.id,
      episode_id: episodeId,
      score
    },
    { onConflict: "user_id,episode_id" }
  );
  if (error) throw error;
}

async function deleteEpisodeRating(episodeId) {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const { error } = await supabase
    .from("episode_ratings")
    .delete()
    .eq("user_id", session.user.id)
    .eq("episode_id", episodeId);
  if (error) throw error;
}

function getCurrentSeasonUserRow(seasonId) {
  return state.seasonUserRatings.find(
    (row) => row.season_id === seasonId && row.user_id === state.currentUserId
  );
}

async function saveSeasonManualScore(seasonId) {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const season = state.seasons.find((item) => item.id === seasonId);
  if (!isSeasonRateable(season)) {
    setMessage("#page-message", "Impossible de noter une saison non sortie ou sans date de debut.", true);
    return;
  }

  const existing = getCurrentSeasonUserRow(seasonId);
  const scoreInput = document.querySelector(`[data-field="season-manual-score"][data-season-id="${seasonId}"]`);
  const raw = scoreInput?.value.trim() || "";
  if (!raw) {
    setMessage("#page-message", "Saisis une note de saison ou utilise suppression.", true);
    return;
  }

  const score = Number(raw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#page-message", "La note de saison doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const { error } = await supabase.from("season_user_ratings").upsert(
    {
      user_id: session.user.id,
      season_id: seasonId,
      manual_score: score,
      adjustment: 0,
      review: existing?.review ?? null
    },
    { onConflict: "user_id,season_id" }
  );
  if (error) throw error;
}

async function deleteSeasonManualScore(seasonId) {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const existing = getCurrentSeasonUserRow(seasonId);
  if (!existing) return;

  if (Number(existing.adjustment || 0) === 0) {
    const { error } = await supabase
      .from("season_user_ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("season_id", seasonId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("season_user_ratings")
    .update({ manual_score: null })
    .eq("user_id", session.user.id)
    .eq("season_id", seasonId);
  if (error) throw error;
}

async function adjustSeason(seasonId, delta) {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const season = state.seasons.find((item) => item.id === seasonId);
  if (!isSeasonRateable(season)) {
    setMessage("#page-message", "Impossible d'ajuster une saison non sortie ou sans date de debut.", true);
    return;
  }

  const existing = getCurrentSeasonUserRow(seasonId);
  const metrics = computeSeasonMetrics(seasonId);
  const base = Number.isFinite(metrics.userEpisodeAverage)
    ? toFixedNumber(metrics.userEpisodeAverage, 2)
    : null;

  if (metrics.userManualScore !== null) {
    setMessage("#page-message", "L'ajusteur est desactive quand une note manuelle de saison est definie.", true);
    return;
  }

  if (!Number.isFinite(base)) {
    setMessage("#page-message", "Il faut noter des episodes pour utiliser l'ajusteur.", true);
    return;
  }

  const currentAdjustment = Number(existing?.adjustment ?? metrics.userAdjustment ?? 0);
  const currentEffective = clamp(base + currentAdjustment, 0, 10);
  const targets = buildAdjustmentTargets(base);
  const epsilon = 0.000001;

  let nextEffective = currentEffective;
  if (delta > 0) {
    nextEffective = targets.find((value) => value > currentEffective + epsilon) ?? currentEffective;
  } else if (delta < 0) {
    for (let idx = targets.length - 1; idx >= 0; idx -= 1) {
      if (targets[idx] < currentEffective - epsilon) {
        nextEffective = targets[idx];
        break;
      }
    }
  }

  nextEffective = clamp(nextEffective, 0, 10);
  const nextAdjustment = toFixedNumber(clamp(nextEffective - base, -2, 2), 2);

  const payload = {
    user_id: session.user.id,
    season_id: seasonId,
    manual_score: existing?.manual_score ?? null,
    adjustment: nextAdjustment,
    review: existing?.review ?? null
  };

  if (payload.manual_score === null && payload.adjustment === 0) {
    const { error } = await supabase
      .from("season_user_ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("season_id", seasonId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("season_user_ratings").upsert(payload, { onConflict: "user_id,season_id" });
  if (error) throw error;
}

async function resetSeasonAdjustment(seasonId) {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const existing = getCurrentSeasonUserRow(seasonId);
  if (!existing) return;

  const { error } = await supabase
    .from("season_user_ratings")
    .upsert(
      {
        user_id: session.user.id,
        season_id: seasonId,
        manual_score: existing.manual_score ?? null,
        adjustment: 0,
        review: existing.review ?? null
      },
      { onConflict: "user_id,season_id" }
    );
  if (error) throw error;
}

function bindDetailEvents() {
  const detailRoot = document.querySelector("#series-detail-section");
  detailRoot.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const episodeId = button.dataset.episodeId;
    const seasonId = button.dataset.seasonId;

    try {
      if (action === "toggle-series-reviews-more") {
        state.socialExpanded.reviews = !state.socialExpanded.reviews;
      } else if (action === "toggle-series-activity-more") {
        state.socialExpanded.activity = !state.socialExpanded.activity;
      } else if (action === "save-episode-rating" && episodeId) {
        await saveEpisodeRating(episodeId);
      } else if (action === "delete-episode-rating" && episodeId) {
        await deleteEpisodeRating(episodeId);
      } else if (action === "save-season-manual" && seasonId) {
        await saveSeasonManualScore(seasonId);
      } else if (action === "delete-season-manual" && seasonId) {
        await deleteSeasonManualScore(seasonId);
      } else if (action === "adjust-season-up" && seasonId) {
        await adjustSeason(seasonId, 0.25);
      } else if (action === "adjust-season-down" && seasonId) {
        await adjustSeason(seasonId, -0.25);
      } else if (action === "reset-season-adjustment" && seasonId) {
        await resetSeasonAdjustment(seasonId);
      } else {
        return;
      }

      if (!action.startsWith("toggle-series-")) {
        setMessage("#page-message", "Sauvegarde reussie.");
      }
      await refreshRatingsOnly();
    } catch (error) {
      const message = error?.message || "Operation impossible.";
      if (message.includes("season_user_ratings_adjustment_check")) {
        setMessage(
          "#page-message",
          "Ajustement refuse par la base de donnees. Applique la derniere version de supabase/schema.sql (contrainte season_user_ratings_adjustment_check).",
          true
        );
      } else {
        setMessage("#page-message", message, true);
      }
    }
  });
}

async function initPage() {
  try {
    const session = await getSession();
    state.currentUserId = session?.user?.id || null;

    const seriesId = getSeriesIdFromURL();
    if (!seriesId) {
      const [
        { data: seriesList, error: seriesError },
        { data: seasons, error: seasonsError },
        { data: episodes, error: episodesError },
        { data: episodeRatings, error: episodeRatingsError },
        { data: seasonUserRatings, error: seasonUserRatingsError }
      ] = await Promise.all([
        supabase
          .from("series")
          .select("id, title, poster_url, start_date, end_date, franchise, type")
          .order("start_date", { ascending: false, nullsFirst: false }),
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

      if (seriesError) throw seriesError;
      if (seasonsError) throw seasonsError;
      if (episodesError) throw episodesError;
      if (episodeRatingsError) throw episodeRatingsError;
      if (seasonUserRatingsError) throw seasonUserRatingsError;

      const averageBySeriesId = computeSeriesListAverages(
        seriesList || [],
        seasons || [],
        episodes || [],
        episodeRatings || [],
        seasonUserRatings || []
      );

      const rows = (seriesList || [])
        .map((serie) => {
          const averageData = averageBySeriesId.get(serie.id) || { average: null, count: 0 };
          return {
            ...serie,
            average: averageData.average,
            rating_count: averageData.count
          };
        })
        .sort((a, b) => {
          const aTs = getDateSortValue(a.start_date);
          const bTs = getDateSortValue(b.start_date);
          if (aTs !== bTs) return bTs - aTs;
          return (a.title || "").localeCompare(b.title || "", "fr");
        });

      renderSeriesList(rows);
      return;
    }

    document.querySelector("#series-list-section").style.display = "none";
    document.querySelector("#series-detail-section").style.display = "block";
    document.querySelector("#series-subtitle").textContent = "Saisons, episodes et notation.";

    await reloadSeriesDetails(seriesId);
    bindDetailEvents();

    document.querySelector("#series-review-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await saveSeriesReview();
        await refreshRatingsOnly();
      } catch (error) {
        setMessage("#series-review-message", error.message || "Impossible d'enregistrer la critique serie.", true);
      }
    });

    document.querySelector("#series-review-delete-button")?.addEventListener("click", async () => {
      try {
        await deleteSeriesReview();
        await refreshRatingsOnly();
      } catch (error) {
        setMessage("#series-review-message", error.message || "Impossible de supprimer la critique serie.", true);
      }
    });
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement des series.", true);
  }
}

initPage();
