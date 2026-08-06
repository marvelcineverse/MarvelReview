import { supabase } from "../supabaseClient.js";
import {
  buildAdminReviewEditButtonMarkup,
  buildDenseRankLabels,
  escapeHTML,
  formatDate,
  formatScore,
  getLastEpisodeAirDate,
  getScoreClass,
  isReleasedOnOrBeforeToday,
  isSpoilerCurrentlyBlurred,
  resolveReviewEditTarget,
  setMessage
} from "./utils.js";
import { getCurrentProfile, getSession } from "./auth.js";

const LATEST_CONTENT_LIMIT = 2;
const TOP_RANKED_LIMIT = 10;
const LATEST_ACTIVITY_INITIAL_LIMIT = 6;
const LATEST_ACTIVITY_LIMIT = 20;
const ACTIVITY_REVIEW_PREVIEW_LENGTH = 320;
const state = {
  isAdmin: false,
  latestActivityExpanded: false,
  latestActivityExpandedReviewIds: new Set()
};
const SUPABASE_PAGE_SIZE = 1000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTimeValue(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumericOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function renderHomeCommunityStats(activeUsersCount, activeUsers30DaysCount, mediaCount) {
  const statsEl = document.querySelector("#home-community-stats");
  if (!statsEl) return;

  statsEl.innerHTML =
    `<strong>${activeUsersCount} utilisateurs</strong> actifs (<strong>${activeUsers30DaysCount} actifs</strong> sous 30 jours) - <strong>${mediaCount} m\u00E9dias</strong> pr\u00E9sents`;
}

function includeItemsThroughDenseRank(items, limit, scoreAccessor, precision = 2) {
  if (!Array.isArray(items) || !items.length) return [];
  if (!Number.isInteger(limit) || limit < 1) return [];

  let previousScore = null;
  let currentRank = 0;
  let hasRank = false;

  for (let index = 0; index < items.length; index += 1) {
    const rawScore = Number(scoreAccessor(items[index]));
    if (!Number.isFinite(rawScore)) break;

    const normalizedScore = Number(rawScore.toFixed(precision));
    if (!hasRank) {
      currentRank = 1;
      previousScore = normalizedScore;
      hasRank = true;
    } else if (normalizedScore !== previousScore) {
      currentRank += 1;
      previousScore = normalizedScore;
    }

    if (currentRank > limit) {
      return items.slice(0, index);
    }
  }

  return items;
}

function getReviewPreview(rawReview, maxLength = ACTIVITY_REVIEW_PREVIEW_LENGTH) {
  const full = String(rawReview || "").trim();
  if (!full) return { full: "", preview: "", isTruncated: false };
  if (full.length <= maxLength) return { full, preview: full, isTruncated: false };

  let preview = full.slice(0, maxLength);
  const lastSpace = preview.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLength * 0.6)) {
    preview = preview.slice(0, lastSpace);
  }

  return {
    full,
    preview: `${preview.trimEnd()} [...]`,
    isTruncated: true
  };
}

function getSeriesLatestReleasedSeason(seriesRow, seasonsBySeriesId) {
  const seasons = seasonsBySeriesId.get(seriesRow.id) || [];
  const releasedSeasons = seasons
    .filter((season) => isReleasedOnOrBeforeToday(season.start_date))
    .sort((a, b) => getTimeValue(b.start_date) - getTimeValue(a.start_date));

  return releasedSeasons[0] || null;
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

function computeSeasonAverages(seasons, episodes, episodeRatings, seasonUserRatings) {
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

  const averageBySeasonId = new Map();
  for (const season of seasons || []) {
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
    const effectiveScores = [];
    const partialEpisodeAverages = [];

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
      if (Number.isFinite(effective)) {
        effectiveScores.push(effective);
      }
      if (Number.isFinite(episodeAverage)) {
        partialEpisodeAverages.push(episodeAverage);
      }
    }

    const average = effectiveScores.length
      ? effectiveScores.reduce((sum, value) => sum + value, 0) / effectiveScores.length
      : null;

    const temporaryAverage = average === null && partialEpisodeAverages.length
      ? partialEpisodeAverages.reduce((sum, value) => sum + value, 0) / partialEpisodeAverages.length
      : null;

    averageBySeasonId.set(season.id, { average, count: effectiveScores.length, temporaryAverage });
  }

  return averageBySeasonId;
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

function renderLatestContent(items) {
  const listEl = document.querySelector("#home-latest-content-list");
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = "<p>Aucun contenu sorti pour le moment.</p>";
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const averageLabel = item.rating_count > 0
        ? `<span class="score-badge film-average-badge ${getScoreClass(item.average)}">${formatScore(item.average, 2, 2)}</span> / 10`
        : item.temporary_average !== null && item.temporary_average !== undefined
          ? `<span class="score-badge film-average-badge ${getScoreClass(item.temporary_average)}">${formatScore(item.temporary_average, 2, 2)}</span> / 10<small class="score-temporary-tag">⚠️ Temporaire</small>`
          : `<span class="score-badge film-average-badge stade-neutre">pas de note</span>`;
      const dateLabel = "Sortie";
      const linkLabel = item.kind === "film" ? "Voir la page film" : "Voir la page s\u00E9rie";
      const linkHref = item.kind === "film" ? `/film.html?id=${item.id}` : `/series.html?id=${item.id}`;
      const subtitle = item.kind === "series" && item.season_name
        ? `<small class="home-latest-card-subtitle">${escapeHTML(item.season_name)}</small>`
        : `<small class="home-latest-card-subtitle home-latest-card-subtitle--empty" aria-hidden="true">&nbsp;</small>`;

      return `
        <article class="card film-card home-latest-card">
          <img src="${escapeHTML(item.poster_url || "https://via.placeholder.com/240x360?text=Marvel")}" alt="Affiche de ${escapeHTML(item.title)}" />
          <div>
            <h3>${escapeHTML(item.title)}</h3>
            ${subtitle}
            <p class="film-average">${averageLabel}</p>
            <p>${dateLabel} : ${formatDate(item.date)}</p>
            <p class="film-meta">${escapeHTML(item.franchise || "-")} - ${escapeHTML(item.type || "-")}</p>
            <div class="home-latest-card-action">
              <a class="button" href="${linkHref}">${linkLabel}</a>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTopRankedContent(items) {
  const bodyEl = document.querySelector("#home-top-ranked-body");
  if (!bodyEl) return;

  if (!items.length) {
    bodyEl.innerHTML = `<tr><td colspan="3">Aucune moyenne disponible pour le moment.</td></tr>`;
    return;
  }

  const rankLabels = buildDenseRankLabels(items, (item) => item.average, 2);

  bodyEl.innerHTML = items
    .map((item, index) => {
      const href = item.kind === "film" ? `/film.html?id=${item.id}` : `/series.html?id=${item.id}`;

      return `
        <tr>
          <td>${rankLabels[index]}</td>
          <td>
            <a href="${href}" class="film-link">${escapeHTML(item.title)}</a>
          </td>
          <td><span class="score-badge ${getScoreClass(item.average)}">${formatScore(item.average, 2, 2)}</span> / 10</td>
        </tr>
      `;
    })
    .join("");
}

function buildSeasonActivityRows(seasons, episodes, episodeRatings, seasonUserRatings, seriesById = new Map()) {
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
      lastActivityAt: null,
      lastActivityAtTs: 0,
      username: null
    };
    current.total += Number(rating.score || 0);
    current.count += 1;
    const activityAt = rating.updated_at || rating.created_at || null;
    const activityTs = getTimeValue(activityAt);
    if (activityTs >= current.lastActivityAtTs) {
      current.lastActivityAtTs = activityTs;
      current.lastActivityAt = activityAt;
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
        lastActivityAt: null,
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
        activity_at: seasonRow?.updated_at || seasonRow?.created_at || stats.lastActivityAt,
        score: Number.isFinite(effectiveScore) ? effectiveScore : null,
        review: seasonRow?.review || "",
        hasSpoiler: Boolean(seasonRow?.has_spoiler),
        referenceDate: getLastEpisodeAirDate(episodesBySeasonId.get(season.id) || []) || season.end_date || null,
        adjustment,
        seriesTitle: seriesById.get(season.series_id)?.title || "",
        title: season.name || "Saison",
        seasonLabel: season.season_number ? `S${season.season_number}` : "Saison",
        href: `/season.html?id=${season.id}`
      });
    }
  }

  return rows;
}

async function fetchLatestActivityViaApi(limit = LATEST_ACTIVITY_LIMIT) {
  const safeLimit = Math.max(0, Number(limit) || LATEST_ACTIVITY_LIMIT);
  const { data, error } = await supabase.rpc("api_latest_activity", { p_limit: safeLimit });
  if (error) throw error;

  return (data || []).map((row) => {
    const type = row.activity_type || "film";
    const targetId = row.target_id || null;
    let href = "#";
    if (type === "film" && targetId) href = `/film.html?id=${targetId}`;
    if (type === "series" && targetId) href = `/series.html?id=${targetId}`;
    if (type === "episode" && targetId) href = `/episode.html?id=${targetId}`;
    if (type === "season" && targetId) href = `/season.html?id=${targetId}`;

    const seasonNumber = Number(row.season_number);
    return {
      id: row.activity_id || `${type}-${targetId || "unknown"}`,
      type,
      user_id: row.user_id,
      username: row.username || "Utilisateur",
      activity_at: row.activity_at || null,
      score: toNumericOrNull(row.score),
      review: row.review || "",
      hasSpoiler: Boolean(row.has_spoiler),
      referenceDate: row.content_date || null,
      adjustment: toNumericOrNull(row.adjustment) || 0,
      title: row.title || "",
      seriesTitle: row.series_title || "",
      seasonLabel: Number.isFinite(seasonNumber) ? `S${seasonNumber}` : "Saison",
      href
    };
  });
}

function renderLatestActivity(allRows, mediaByUserId) {
  const listEl = document.querySelector("#home-latest-activity-list");
  const toggleEl = document.querySelector("#home-latest-activity-toggle");
  if (!listEl) return;

  if (!allRows.length) {
    listEl.innerHTML = "<p>Aucune note ou critique enregistrée pour le moment.</p>";
    if (toggleEl) toggleEl.style.display = "none";
    return;
  }

  const visibleLimit = state.latestActivityExpanded
    ? LATEST_ACTIVITY_LIMIT
    : LATEST_ACTIVITY_INITIAL_LIMIT;
  const rows = allRows.slice(0, visibleLimit);

  listEl.innerHTML = rows
    .map((row) => {
      const mediaNames = mediaByUserId.get(row.user_id) || [];
      const mediaLabel = mediaNames.join(", ");
      const scorePart = Number.isFinite(row.score)
        ? `<span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score, 2, 2)}</span> / 10`
        : '<span class="score-badge stade-neutre">Sans note</span>';
      const adjustmentPart = row.type === "season" && row.adjustment !== 0
        ? ` | Ajustement ${row.adjustment > 0 ? "+" : ""}${formatScore(row.adjustment, 2, 2)}`
        : "";
      const typeLabel = row.type === "film"
        ? "Film"
        : row.type === "series"
          ? "S\u00E9rie"
          : row.type === "episode"
            ? "\u00C9pisode"
            : "Saison";
      const episodeSeriesPart = row.type === "episode" && row.seriesTitle
        ? `${escapeHTML(row.seriesTitle)} - `
        : "";
      const seasonSeriesPart = row.type === "season" && row.seriesTitle
        ? `${escapeHTML(row.seriesTitle)} - `
        : "";
      const detailLabel = row.type === "film" || row.type === "series"
        ? `${typeLabel} - <a href="${row.href}" class="film-link">${escapeHTML(row.title)}</a>`
        : row.type === "episode"
          ? `${typeLabel} - ${episodeSeriesPart}${escapeHTML(row.seasonLabel || "-")} - <a href="${row.href}" class="film-link">${escapeHTML(row.title)}</a>`
          : `${typeLabel} - ${seasonSeriesPart}${escapeHTML(row.seasonLabel || "-")} - <a href="${row.href}" class="film-link">${escapeHTML(row.title)}</a>`;
      const isSpoilerBlurred = isSpoilerCurrentlyBlurred(row.hasSpoiler, row.referenceDate);
      const reviewPreview = getReviewPreview(row.review);
      const isReviewExpanded = state.latestActivityExpandedReviewIds.has(row.id);
      const displayedReview = isReviewExpanded || !reviewPreview.isTruncated
        ? reviewPreview.full
        : reviewPreview.preview;
      const toggleReviewButton = reviewPreview.full && reviewPreview.isTruncated && !isSpoilerBlurred
        ? `<button type="button" class="ghost-button social-inline-more" data-action="toggle-activity-review" data-activity-id="${escapeHTML(row.id)}">${isReviewExpanded ? "Voir moins" : "Voir plus"}</button>`
        : "";
      const reviewMarkup = !reviewPreview.full
        ? ""
        : isSpoilerBlurred
          ? `
            <div class="spoiler-wrap" role="button" tabindex="0" aria-label="Critique masqu&eacute;e car elle contient des spoilers. Survolez ou appuyez pour la r&eacute;v&eacute;ler.">
              <p class="social-review-text spoiler-text">${escapeHTML(reviewPreview.full).replace(/\n/g, "<br>")}</p>
              <div class="spoiler-badge" aria-hidden="true">
                <span class="spoiler-badge-title">Spoiler</span>
                <span class="spoiler-badge-hint">Survolez ou touchez pour r&eacute;v&eacute;ler</span>
              </div>
            </div>
          `
          : `
            <p class="social-review-text">${escapeHTML(displayedReview).replace(/\n/g, "<br>")}</p>
          `;
      const footerMarkup = `
        <div class="social-inline-footer">
          ${toggleReviewButton}
          <small class="social-inline-date">${formatDate(row.activity_at)}</small>
        </div>
      `;
      const editTarget = state.isAdmin && reviewPreview.full
        ? resolveReviewEditTarget(row.type, row.id)
        : null;
      const editButton = editTarget
        ? buildAdminReviewEditButtonMarkup(editTarget.table, editTarget.rowId, {
          authorLabel: row.username || "Utilisateur",
          contentLabel: row.title || ""
        })
        : "";

      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(row.username || "Utilisateur")}</strong>
            ${mediaLabel ? `<span>${escapeHTML(mediaLabel)}</span>` : ""}
            ${editButton}
          </div>
          <p class="film-meta">${detailLabel}</p>
          <p>${scorePart}<span class="film-meta">${escapeHTML(adjustmentPart)}</span></p>
          ${reviewMarkup}
          ${footerMarkup}
        </article>
      `;
    })
    .join("");

  listEl.querySelectorAll('[data-action="toggle-activity-review"]').forEach((button) => {
    button.addEventListener("click", () => {
      const activityId = button.getAttribute("data-activity-id");
      if (!activityId) return;
      if (state.latestActivityExpandedReviewIds.has(activityId)) {
        state.latestActivityExpandedReviewIds.delete(activityId);
      } else {
        state.latestActivityExpandedReviewIds.add(activityId);
      }
      renderLatestActivity(allRows, mediaByUserId);
    });
  });

  if (!toggleEl) return;
  const canExpand = allRows.length > LATEST_ACTIVITY_INITIAL_LIMIT;
  toggleEl.style.display = canExpand ? "flex" : "none";
  toggleEl.textContent = state.latestActivityExpanded ? "Voir moins" : "Voir plus";
}

async function loadHomePage() {
  try {
    const [
      films,
      series,
      profiles,
      mediaOutlets,
      seasons,
      episodes,
      episodeRatings,
      seasonUserRatings,
      seriesReviews,
      ratings,
      isAdmin
    ] = await Promise.all([
      fetchAllRows("films", "id, title, release_date, poster_url, franchise, type"),
      fetchAllRows("series", "id, title, start_date, end_date, poster_url, franchise, type"),
      fetchAllRows("profiles", "id, moderation_status"),
      fetchAllRows("media_outlets", "id"),
      fetchAllRows("series_seasons", "id, series_id, name, season_number, start_date, end_date, poster_url"),
      fetchAllRows("series_episodes", "id, season_id, title, episode_number, air_date"),
      fetchAllRows("episode_ratings", "id, user_id, episode_id, score, review, has_spoiler, created_at, updated_at, profiles(username)"),
      fetchAllRows("season_user_ratings", "id, user_id, season_id, manual_score, adjustment, review, has_spoiler, created_at, updated_at, profiles(username)"),
      fetchAllRows("series_reviews", "id, user_id, series_id, review, has_spoiler, created_at, updated_at, profiles(username)"),
      fetchAllRows("ratings", "id, user_id, film_id, score, review, has_spoiler, created_at, updated_at, profiles(username)"),
      getSession().then((session) => (session ? getCurrentProfile() : null)).then((profile) => Boolean(profile?.is_admin))
    ]);
    state.isAdmin = isAdmin;

    const filmScoreById = new Map();
    for (const row of ratings || []) {
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
    const seasonAverageById = computeSeasonAverages(
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
        const latestSeason = getSeriesLatestReleasedSeason(row, seasonsBySeriesId);
        const highlightDate = latestSeason?.start_date || row.start_date || null;
        if (!isReleasedOnOrBeforeToday(highlightDate)) return null;
        const latestSeasonAverageData = latestSeason
          ? (seasonAverageById.get(latestSeason.id) || { average: null, count: 0, temporaryAverage: null })
          : { average: null, count: 0, temporaryAverage: null };
        const seriesAverageData = seriesAverageById.get(row.id) || { average: null, count: 0 };
        return {
          kind: "series",
          id: row.id,
          title: row.title,
          poster_url: latestSeason?.poster_url || row.poster_url,
          franchise: row.franchise,
          type: row.type,
          date: highlightDate,
          season_name: latestSeason?.name || "",
          rating_count: latestSeasonAverageData.count,
          average: latestSeasonAverageData.average,
          temporary_average: latestSeasonAverageData.temporaryAverage,
          series_rating_count: seriesAverageData.count,
          series_average: seriesAverageData.average
        };
      })
      .filter(Boolean);

    const latestContent = [...releasedFilms, ...releasedSeries]
      .sort((a, b) => getTimeValue(b.date) - getTimeValue(a.date))
      .slice(0, LATEST_CONTENT_LIMIT);

    const activeProfileIds = new Set(
      (profiles || [])
        .filter((profile) => String(profile?.moderation_status || "active").toLowerCase() === "active")
        .map((profile) => profile.id)
        .filter(Boolean)
    );
    const recentActivityThreshold = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const activeUsers30Days = new Set();
    const registerRecentUser = (rows) => {
      for (const row of rows || []) {
        const userId = row?.user_id;
        if (!userId || !activeProfileIds.has(userId)) continue;
        const activityAt = getTimeValue(row.updated_at || row.created_at || null);
        if (activityAt >= recentActivityThreshold) {
          activeUsers30Days.add(userId);
        }
      }
    };

    registerRecentUser(ratings);
    registerRecentUser(seriesReviews);
    registerRecentUser(episodeRatings);
    registerRecentUser(seasonUserRatings);

    const topRankedContent = [
      ...releasedFilms,
      ...releasedSeries.map((item) => ({
        ...item,
        rating_count: item.series_rating_count,
        average: item.series_average
      }))
    ]
      .filter((item) => Number.isFinite(item.average) && Number(item.rating_count || 0) > 0)
      .sort((a, b) => {
        if (b.average !== a.average) return b.average - a.average;
        if (b.rating_count !== a.rating_count) return b.rating_count - a.rating_count;
        return getTimeValue(b.date) - getTimeValue(a.date);
      });

    const topRankedWithTies = includeItemsThroughDenseRank(
      topRankedContent,
      TOP_RANKED_LIMIT,
      (item) => item.average,
      2
    );

    renderTopRankedContent(topRankedWithTies);
    renderLatestContent(latestContent);
    renderHomeCommunityStats(activeProfileIds.size, activeUsers30Days.size, (mediaOutlets || []).length);

    let latestActivity = [];
    try {
      latestActivity = await fetchLatestActivityViaApi(LATEST_ACTIVITY_LIMIT);
    } catch (_apiError) {
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
          activity_at: rating.updated_at || rating.created_at || null,
          score: Number(rating.score),
          review: rating.review || "",
          hasSpoiler: Boolean(rating.has_spoiler),
          referenceDate: film.release_date || null,
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
          activity_at: review.updated_at || review.created_at || null,
          score: null,
          review: review.review || "",
          hasSpoiler: Boolean(review.has_spoiler),
          referenceDate: serie.end_date || null,
          seasonLabel: "S\u00E9rie",
          title: serie.title || "S\u00E9rie",
          href: `/series.html?id=${serie.id}`,
          adjustment: 0
        });
      }

      for (const rating of episodeRatings || []) {
        const episode = episodeById.get(rating.episode_id);
        if (!episode) continue;
        const season = seasonById.get(episode.season_id);
        const serie = seriesById.get(season?.series_id);
        if (!Number.isFinite(Number(rating.score)) && !String(rating.review || "").trim()) continue;
        activityRows.push({
          id: `episode-${rating.id}`,
          type: "episode",
          user_id: rating.user_id,
          username: rating.profiles?.username || "Utilisateur",
          activity_at: rating.updated_at || rating.created_at || null,
          score: Number(rating.score),
          review: rating.review || "",
          hasSpoiler: Boolean(rating.has_spoiler),
          referenceDate: episode.air_date || null,
          seriesTitle: serie?.title || "",
          seasonLabel: season?.season_number ? `S${season.season_number}` : "Saison",
          title: episode.title || "Épisode",
          href: `/episode.html?id=${episode.id}`,
          adjustment: 0
        });
      }

      const seasonRows = buildSeasonActivityRows(
        seasons || [],
        episodes || [],
        episodeRatings || [],
        seasonUserRatings || [],
        seriesById
      );
      activityRows.push(...seasonRows);

      latestActivity = activityRows
        .sort((a, b) => getTimeValue(b.activity_at) - getTimeValue(a.activity_at))
        .slice(0, LATEST_ACTIVITY_LIMIT);
    }

    const userIds = [...new Set(latestActivity.map((row) => row.user_id).filter(Boolean))];
    const mediaByUserId = await loadMembershipMapForUsers(userIds);
    state.latestActivityExpandedReviewIds = new Set();
    renderLatestActivity(latestActivity, mediaByUserId);
    const activityToggleEl = document.querySelector("#home-latest-activity-toggle");
    activityToggleEl?.addEventListener("click", () => {
      state.latestActivityExpanded = !state.latestActivityExpanded;
      renderLatestActivity(latestActivity, mediaByUserId);
    });
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement de la page d'accueil.", true);
  }
}

loadHomePage();
