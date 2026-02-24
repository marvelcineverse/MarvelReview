import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  formatDate,
  formatScore,
  getScoreClass,
  getSeasonIdFromURL,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";
import { getSession, requireAuth } from "./auth.js";

const state = {
  currentUserId: null,
  season: null,
  series: null,
  episodes: [],
  episodeRatings: [],
  seasonUserRatings: [],
  episodeReviewEditorEpisodeIds: new Set(),
  episodeReviewPromptEpisodeId: null
};
const SUPABASE_PAGE_SIZE = 1000;
const IN_FILTER_CHUNK_SIZE = 200;

function chunkArray(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
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

async function fetchAllRowsByIn(table, columns, field, values, orderBy = "id", ascending = true) {
  if (!values.length) return [];

  const rows = [];
  for (const chunk of chunkArray(values, IN_FILTER_CHUNK_SIZE)) {
    const paged = await fetchPagedRows((from, to) =>
      supabase
        .from(table)
        .select(columns)
        .in(field, chunk)
        .order(orderBy, { ascending })
        .range(from, to)
    );
    rows.push(...paged);
  }

  return rows;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function isSeasonRateable() {
  return isReleasedOnOrBeforeToday(state.season?.start_date || null);
}

function applySeasonAvailability() {
  const canManageSeasonRating = Boolean(state.currentUserId);
  const canRate = isSeasonRateable();
  const messageEl = document.querySelector("#season-rating-unavailable-message");
  const message = "Cette saison n'est pas encore sortie (ou n'a pas de date de debut). La notation est desactivee.";
  if (messageEl) {
    const shouldShow = canManageSeasonRating && !canRate;
    messageEl.textContent = shouldShow ? message : "";
    messageEl.style.display = shouldShow ? "block" : "none";
  }
}

function applyAuthVisibility() {
  const reviewSection = document.querySelector("#season-review-section");
  if (reviewSection) {
    reviewSection.style.display = state.currentUserId ? "" : "none";
  }

  if (!state.currentUserId) {
    state.episodeReviewEditorEpisodeIds.clear();
    state.episodeReviewPromptEpisodeId = null;
    setMessage("#season-form-message", "");
    setMessage("#season-review-message", "");
  }
}

function syncEpisodeMiniReviewUiState() {
  const validEpisodeIds = new Set(state.episodes.map((episode) => episode.id));
  for (const episodeId of [...state.episodeReviewEditorEpisodeIds]) {
    if (!validEpisodeIds.has(episodeId)) {
      state.episodeReviewEditorEpisodeIds.delete(episodeId);
    }
  }

  if (state.episodeReviewPromptEpisodeId && !validEpisodeIds.has(state.episodeReviewPromptEpisodeId)) {
    state.episodeReviewPromptEpisodeId = null;
  }
}

function focusEpisodeReviewInput(episodeId) {
  window.requestAnimationFrame(() => {
    const textarea = document.querySelector(`[data-field="episode-review"][data-episode-id="${episodeId}"]`);
    if (!textarea) return;
    textarea.focus();
    const textLength = textarea.value.length;
    textarea.setSelectionRange(textLength, textLength);
  });
}

function buildSeasonComputationContext() {
  const episodeCount = state.episodes.length;
  const episodeIds = new Set(state.episodes.map((episode) => episode.id));
  const episodeStatsByUser = new Map();

  for (const rating of state.episodeRatings) {
    if (!episodeIds.has(rating.episode_id)) continue;
    const current = episodeStatsByUser.get(rating.user_id) || { total: 0, count: 0 };
    current.total += Number(rating.score || 0);
    current.count += 1;
    episodeStatsByUser.set(rating.user_id, current);
  }

  const seasonRowsByUser = new Map();
  for (const row of state.seasonUserRatings) {
    seasonRowsByUser.set(row.user_id, row);
  }

  return {
    episodeCount,
    episodeStatsByUser,
    seasonRowsByUser
  };
}

function resolveSeasonUserScoreFromContext(context, userId) {
  const stats = context.episodeStatsByUser.get(userId) || { total: 0, count: 0 };
  const seasonRow = context.seasonRowsByUser.get(userId);
  const manualScore = seasonRow?.manual_score === null || seasonRow?.manual_score === undefined
    ? null
    : Number(seasonRow.manual_score);
  const adjustment = Number(seasonRow?.adjustment || 0);
  const episodeAverage = stats.count ? stats.total / stats.count : null;
  const isComplete = context.episodeCount > 0 && stats.count === context.episodeCount;

  const effectiveScore = Number.isFinite(manualScore)
    ? clamp(manualScore, 0, 10)
    : (isComplete && Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);

  return {
    episodeAverage,
    manualScore,
    adjustment,
    effectiveScore,
    isComplete
  };
}

function computeSeasonMetrics() {
  const context = buildSeasonComputationContext();
  const allUserIds = new Set([...context.episodeStatsByUser.keys(), ...context.seasonRowsByUser.keys()]);
  const effectiveScores = [];
  for (const userId of allUserIds) {
    const resolved = resolveSeasonUserScoreFromContext(context, userId);
    if (Number.isFinite(resolved.effectiveScore)) effectiveScores.push(resolved.effectiveScore);
  }

  const siteAverage = effectiveScores.length
    ? effectiveScores.reduce((sum, score) => sum + score, 0) / effectiveScores.length
    : null;

  const user = resolveSeasonUserScoreFromContext(context, state.currentUserId);

  return {
    episodeCount: context.episodeCount,
    userEpisodeAverage: user.episodeAverage,
    userManualScore: user.manualScore,
    userAdjustment: user.adjustment,
    userEffective: user.effectiveScore,
    userHasAllEpisodeRatings: user.isComplete,
    siteAverage
  };
}

function renderSeasonDetails() {
  const detailsEl = document.querySelector("#season-details");
  if (!detailsEl) return;

  const seasonLabel = state.season?.name || `Saison ${state.season?.season_number || "?"}`;
  detailsEl.innerHTML = `
    <h1>${escapeHTML(seasonLabel)}</h1>
    <p>
      S&eacute;rie:
      <a href="/series.html?id=${state.series?.id || ""}" class="film-link">${escapeHTML(state.series?.title || "-")}</a>
    </p>
  `;
}

function renderSeasonCard() {
  const container = document.querySelector("#season-card-root");
  if (!container) return;

  const metrics = computeSeasonMetrics();
  const showUserEpisodeActions = Boolean(state.currentUserId);
  const canRateSeason = isSeasonRateable();

  const seasonAverage = metrics.userEpisodeAverage === null
    ? `Pas de note`
    : `${formatScore(metrics.userEpisodeAverage, 2, 2)} / 10`;

  const siteAverageBadge = metrics.siteAverage === null
    ? `<span class="score-badge stade-neutre">Pas de note</span>`
    : `<span class="score-badge ${getScoreClass(metrics.siteAverage)}">${formatScore(metrics.siteAverage, 2, 2)} / 10</span>`;

  const userAverage = metrics.userEffective === null
    ? `<span class="score-badge stade-neutre">-</span>`
    : `<span class="score-badge ${getScoreClass(metrics.userEffective)}">${formatScore(metrics.userEffective, 2, 2)} / 10</span>`;

  const manualValue = metrics.userManualScore === null ? "" : String(metrics.userManualScore);
  const adjustmentValue = formatScore(metrics.userAdjustment, 2, 2);
  const phaseLabel = String(state.season?.phase || "").trim();
  const seasonMetaParts = [];
  if (phaseLabel) {
    seasonMetaParts.push(`Phase: ${escapeHTML(phaseLabel)}`);
  }
  seasonMetaParts.push(`D&eacute;but: ${formatDate(state.season?.start_date)}`);
  seasonMetaParts.push(`Fin: ${formatDate(state.season?.end_date)}`);
  const seasonMetaLine = seasonMetaParts.join(" | ");
  const sortedEpisodes = [...state.episodes].sort((a, b) => a.episode_number - b.episode_number);

  const episodeAverageById = new Map();
  for (const episode of sortedEpisodes) {
    const ratings = state.episodeRatings.filter((rating) => rating.episode_id === episode.id);
    if (!ratings.length) {
      episodeAverageById.set(episode.id, null);
      continue;
    }
    const total = ratings.reduce((sum, rating) => sum + Number(rating.score || 0), 0);
    episodeAverageById.set(episode.id, total / ratings.length);
  }

  container.innerHTML = `
    <article>
      <div class="season-card-header">
        <h3>
          ${escapeHTML(state.season.name || `Saison ${state.season.season_number}`)}
          - Moyenne du site: ${siteAverageBadge}
        </h3>
        <a href="/series.html?id=${state.series?.id || ""}" class="button season-open-button">Voir page s&eacute;rie</a>
      </div>
      <p>${seasonMetaLine}</p>

      ${showUserEpisodeActions ? `
        <div class="season-rating-separator" aria-hidden="true"></div>
        <p>Ta note effective de la saison: ${userAverage}</p>
        <p class="film-meta">Base utilis&eacute;e pour ta note : ${metrics.userManualScore === null ? "Moyenne de tes &eacute;pisodes" : "Note manuelle de saison"} | &Eacute;pisodes: ${metrics.episodeCount}</p>

        <div class="season-rating-layout">
          <section class="season-rating-panel">
            <p class="film-meta season-manual-help">Renseigne une note g&eacute;n&eacute;rale pour toute la saison (optionnel).</p>
            <div class="inline-actions inline-edit">
              <input data-field="season-manual-score" type="number" min="0" max="10" step="0.25" value="${manualValue}" placeholder="Note saison (optionnelle)" ${canRateSeason ? "" : "disabled"} />
              <button type="button" class="icon-circle-btn save" data-action="save-season-manual" aria-label="Valider la note de saison" ${canRateSeason ? "" : "disabled"}>
                <i class="fa-solid fa-check" aria-hidden="true"></i>
              </button>
              ${metrics.userManualScore === null ? "" : `
                <button type="button" class="icon-circle-btn delete" data-action="delete-season-manual" aria-label="Supprimer la note manuelle de saison" ${canRateSeason ? "" : "disabled"}>
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
              `}
            </div>
          </section>

          <section class="season-rating-panel">
            <p>Moyenne de tes &eacute;pisodes: <b>${seasonAverage}</b></p>
            <div class="inline-actions season-adjuster">
              <span>Ajusteur de moyenne</span>
              <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-down" aria-label="Diminuer l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
                <i class="fa-solid fa-minus" aria-hidden="true"></i>
              </button>
              <strong>${adjustmentValue}</strong>
              <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-up" aria-label="Augmenter l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
              </button>
              <button type="button" class="icon-circle-btn neutral small" data-action="reset-season-adjustment" aria-label="Reinitialiser l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
          </section>
        </div>
      ` : ""}

      <details class="season-episodes" open>
        <summary class="season-episodes-summary">
          <span class="season-summary-label">
            <i class="fa-solid fa-caret-right season-summary-caret" aria-hidden="true"></i>
            &Eacute;pisodes
          </span>
          <small>Cliquer pour replier / d&eacute;plier</small>
        </summary>
        <div class="table-wrapper">
          <table class="ranking-table compact">
            <thead>
              <tr>
                <th>#</th>
                <th>&Eacute;pisode</th>
                <th>Diffusion</th>
                <th>Moyenne</th>
                ${showUserEpisodeActions ? "<th>Ta note</th>" : ""}
                ${showUserEpisodeActions ? "<th>Modifier</th>" : ""}
              </tr>
            </thead>
            <tbody>
              ${sortedEpisodes.map((episode) => {
                const userRating = showUserEpisodeActions
                  ? state.episodeRatings.find(
                    (rating) => rating.episode_id === episode.id && rating.user_id === state.currentUserId
                  )
                  : null;
                const canRate = isReleasedOnOrBeforeToday(episode.air_date);
                const scoreValue = userRating ? String(userRating.score) : "";
                const reviewValue = userRating?.review ? String(userRating.review) : "";
                const hasReview = reviewValue.trim().length > 0;
                const showReviewEditor = hasReview || state.episodeReviewEditorEpisodeIds.has(episode.id);
                const showReviewPrompt = state.episodeReviewPromptEpisodeId === episode.id;
                const scoreBadge = userRating
                  ? `<span class="score-badge ${getScoreClass(userRating.score)}">${formatScore(userRating.score)} / 10</span>`
                  : `<span class="score-badge stade-neutre">-</span>`;
                const episodeAverage = episodeAverageById.get(episode.id);
                const averageBadge = Number.isFinite(episodeAverage)
                  ? `<span class="score-badge ${getScoreClass(episodeAverage)}">${formatScore(episodeAverage, 2, 2)}</span>`
                  : `<span class="score-badge stade-neutre">-</span>`;
                const reviewRowMarkup = showUserEpisodeActions && showReviewEditor
                  ? `
                    <tr class="episode-mini-review-row" data-episode-review-row="${episode.id}">
                      <td colspan="6">
                        <div class="episode-mini-review-box">
                          <label for="episode-review-${episode.id}">Mini-critique (optionnel)</label>
                          <textarea id="episode-review-${episode.id}" data-field="episode-review" data-episode-id="${episode.id}" maxlength="2500" placeholder="Ton avis rapide en quelques lignes...">${escapeHTML(reviewValue)}</textarea>
                        </div>
                      </td>
                    </tr>
                  `
                  : "";

                return `
                  <tr>
                    <td>${episode.episode_number}</td>
                    <td>
                      <span class="episode-title-inline">
                        <a href="/episode.html?id=${episode.id}" class="film-link">${escapeHTML(episode.title)}</a>
                        <a href="/episode.html?id=${episode.id}" class="icon-circle-btn neutral small icon-link episode-open-link" aria-label="Ouvrir la page episode">
                          <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>
                        </a>
                      </span>
                    </td>
                    <td>${formatDate(episode.air_date)}</td>
                    <td>${averageBadge}</td>
                    ${showUserEpisodeActions ? `<td>${scoreBadge}</td>` : ""}
                    ${showUserEpisodeActions ? `
                      <td class="actions-cell">
                        <div class="inline-actions inline-edit">
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
                        ${showReviewPrompt ? `
                          <div class="episode-mini-review-prompt" role="group" aria-live="polite">
                            <span>Ajouter une mini-critique ?</span>
                            <div class="episode-mini-review-prompt-actions">
                              <button type="button" class="ghost-button" data-action="show-episode-review-editor" data-episode-id="${episode.id}">Oui</button>
                              <button type="button" class="ghost-button" data-action="dismiss-episode-review-prompt" data-episode-id="${episode.id}">Non</button>
                            </div>
                          </div>
                        ` : ""}
                      </td>
                    ` : ""}
                  </tr>
                  ${reviewRowMarkup}
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  `;
}

async function loadMembershipMapForUsers(userIds) {
  if (!userIds.length) return new Map();

  const map = new Map();
  for (const profileIdChunk of chunkArray([...new Set(userIds)], IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("profile_media_memberships")
      .select("profile_id, status, media_outlets(name)")
      .in("profile_id", profileIdChunk)
      .eq("status", "approved");

    if (error) throw error;

    for (const row of data || []) {
      const existing = map.get(row.profile_id) || [];
      const mediaName = row.media_outlets?.name;
      if (mediaName) existing.push(mediaName);
      map.set(row.profile_id, existing);
    }
  }

  return map;
}

function renderSeasonReviews(mediaByUserId = new Map()) {
  const listEl = document.querySelector("#season-reviews-list");
  const rows = state.seasonUserRatings.filter((row) => row.review && row.review.trim());

  if (!rows.length) {
    listEl.innerHTML = "<p>Aucune critique pour cette saison.</p>";
    return;
  }

  listEl.innerHTML = rows
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .map((row) => {
      const mediaNames = mediaByUserId.get(row.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";
      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(row.profiles?.username || "Utilisateur")}</strong>
            <span>${escapeHTML(mediaLabel)}</span>
          </div>
          <p>${escapeHTML(row.review || "(Pas de commentaire)")}</p>
          <small>${formatDate(row.created_at)}</small>
        </article>
      `;
    })
    .join("");
}

function fillCurrentUserSeasonReview() {
  const textarea = document.querySelector("#season-review");
  const deleteBtn = document.querySelector("#delete-season-review-button");
  const row = state.seasonUserRatings.find((item) => item.user_id === state.currentUserId);
  if (!textarea || !deleteBtn) return;

  textarea.value = row?.review || "";
  deleteBtn.style.display = row?.review ? "inline-flex" : "none";
}

function getCurrentSeasonUserRow() {
  return state.seasonUserRatings.find((row) => row.user_id === state.currentUserId);
}

async function loadSeasonData() {
  const seasonId = getSeasonIdFromURL();
  if (!seasonId) {
    setMessage("#page-message", "Saison introuvable: parametre id manquant.", true);
    return;
  }

  const session = await getSession();
  state.currentUserId = session?.user?.id || null;

  const { data: season, error: seasonError } = await supabase
    .from("series_seasons")
    .select("id, series_id, name, season_number, start_date, end_date, phase")
    .eq("id", seasonId)
    .single();
  if (seasonError) throw seasonError;

  const [{ data: series, error: seriesError }, episodes] = await Promise.all([
    supabase
      .from("series")
      .select("id, title")
      .eq("id", season.series_id)
      .single(),
    fetchPagedRows((from, to) =>
      supabase
        .from("series_episodes")
        .select("id, season_id, episode_number, title, air_date")
        .eq("season_id", season.id)
        .order("episode_number", { ascending: true })
        .range(from, to)
    )
  ]);

  if (seriesError) throw seriesError;

  state.season = season;
  state.series = series;
  state.episodes = episodes || [];
}

async function loadRatingsData() {
  const episodeIds = state.episodes.map((episode) => episode.id);
  const [episodeRatings, seasonUserRatings] = await Promise.all([
    fetchAllRowsByIn(
      "episode_ratings",
      "id, episode_id, user_id, score, review, created_at, profiles(username)",
      "episode_id",
      episodeIds
    ),
    fetchPagedRows((from, to) =>
      supabase
        .from("season_user_ratings")
        .select("id, season_id, user_id, manual_score, adjustment, review, created_at, profiles(username)")
        .eq("season_id", state.season.id)
        .order("id", { ascending: true })
        .range(from, to)
    )
  ]);

  state.episodeRatings = episodeRatings || [];
  state.seasonUserRatings = seasonUserRatings || [];
  syncEpisodeMiniReviewUiState();
}

async function refreshAll() {
  await loadSeasonData();
  await loadRatingsData();

  applyAuthVisibility();
  renderSeasonDetails();
  applySeasonAvailability();
  renderSeasonCard();
  fillCurrentUserSeasonReview();
  const userIds = [...new Set(state.seasonUserRatings.map((row) => row.user_id))];
  const mediaByUserId = await loadMembershipMapForUsers(userIds);
  renderSeasonReviews(mediaByUserId);
}

async function saveEpisodeRating(episodeId) {
  const session = await requireAuth("/login.html");
  if (!session) return { saved: false };

  const episode = state.episodes.find((item) => item.id === episodeId);
  if (!isReleasedOnOrBeforeToday(episode?.air_date || null)) {
    setMessage("#season-form-message", "Impossible de noter un episode non diffuse ou sans date de diffusion.", true);
    return { saved: false };
  }

  const scoreInput = document.querySelector(`[data-field="episode-score"][data-episode-id="${episodeId}"]`);
  const scoreRaw = scoreInput?.value.trim() || "";
  if (!scoreRaw) {
    setMessage("#season-form-message", "Le score est obligatoire.", true);
    return { saved: false };
  }

  const score = Number(scoreRaw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#season-form-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
    return { saved: false };
  }

  const existing = state.episodeRatings.find((row) => row.episode_id === episodeId && row.user_id === session.user.id);
  const reviewInput = document.querySelector(`[data-field="episode-review"][data-episode-id="${episodeId}"]`);
  const reviewValue = reviewInput ? reviewInput.value.trim() : "";
  const hasExistingReview = String(existing?.review || "").trim().length > 0;
  const nextReview = reviewInput ? (reviewValue || null) : (existing?.review ?? null);
  const { error } = await supabase.from("episode_ratings").upsert(
    {
      user_id: session.user.id,
      episode_id: episodeId,
      score,
      review: nextReview
    },
    { onConflict: "user_id,episode_id" }
  );
  if (error) throw error;
  return { saved: true, shouldOfferMiniReview: !reviewInput && !hasExistingReview };
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

async function saveSeasonManualScore() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  if (!isSeasonRateable()) {
    setMessage("#season-form-message", "Impossible de noter une saison non sortie ou sans date de debut.", true);
    return;
  }

  const raw = document.querySelector(`[data-field="season-manual-score"]`)?.value?.trim() || "";
  if (!raw) {
    setMessage("#season-form-message", "Saisis une note de saison ou utilise suppression.", true);
    return;
  }

  const score = Number(raw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#season-form-message", "La note de saison doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const existing = getCurrentSeasonUserRow();
  const { error } = await supabase.from("season_user_ratings").upsert(
    {
      user_id: session.user.id,
      season_id: state.season.id,
      manual_score: score,
      adjustment: 0,
      review: existing?.review ?? null
    },
    { onConflict: "user_id,season_id" }
  );
  if (error) throw error;
}

async function deleteSeasonManualScore() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const existing = getCurrentSeasonUserRow();
  if (!existing) return;

  if (Number(existing.adjustment || 0) === 0 && !existing.review) {
    const { error } = await supabase
      .from("season_user_ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("season_user_ratings")
    .update({ manual_score: null })
    .eq("user_id", session.user.id)
    .eq("season_id", state.season.id);
  if (error) throw error;
}

async function adjustSeason(delta) {
  const session = await requireAuth("/login.html");
  if (!session) return;

  if (!isSeasonRateable()) {
    setMessage("#season-form-message", "Impossible d'ajuster une saison non sortie ou sans date de debut.", true);
    return;
  }

  const existing = getCurrentSeasonUserRow();
  const metrics = computeSeasonMetrics();
  const base = Number.isFinite(metrics.userEpisodeAverage) ? toFixedNumber(metrics.userEpisodeAverage, 2) : null;

  if (metrics.userManualScore !== null) {
    setMessage("#season-form-message", "L'ajusteur est desactive quand une note manuelle de saison est definie.", true);
    return;
  }

  if (!Number.isFinite(base) || !metrics.userHasAllEpisodeRatings) {
    setMessage("#season-form-message", "Il faut noter tous les episodes pour utiliser l'ajusteur.", true);
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
    season_id: state.season.id,
    manual_score: existing?.manual_score ?? null,
    adjustment: nextAdjustment,
    review: existing?.review ?? null
  };

  if (payload.manual_score === null && payload.adjustment === 0 && !payload.review) {
    const { error } = await supabase
      .from("season_user_ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("season_user_ratings").upsert(payload, { onConflict: "user_id,season_id" });
  if (error) throw error;
}

async function resetSeasonAdjustment() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const existing = getCurrentSeasonUserRow();
  if (!existing) return;

  const { error } = await supabase
    .from("season_user_ratings")
    .upsert(
      {
        user_id: session.user.id,
        season_id: state.season.id,
        manual_score: existing.manual_score ?? null,
        adjustment: 0,
        review: existing.review ?? null
      },
      { onConflict: "user_id,season_id" }
    );
  if (error) throw error;
}

async function saveSeasonReview(event) {
  event.preventDefault();
  const session = await requireAuth("/login.html");
  if (!session) return;

  const reviewValue = document.querySelector("#season-review").value.trim();
  const existing = getCurrentSeasonUserRow();

  if (!reviewValue && existing?.manual_score === null && Number(existing?.adjustment || 0) === 0) {
    const { error } = await supabase
      .from("season_user_ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("season_user_ratings")
      .upsert(
        {
          user_id: session.user.id,
          season_id: state.season.id,
          manual_score: existing?.manual_score ?? null,
          adjustment: Number(existing?.adjustment || 0),
          review: reviewValue || null
        },
        { onConflict: "user_id,season_id" }
      );
    if (error) throw error;
  }

  setMessage("#season-review-message", "Critique saison enregistree.");
  await refreshAll();
}

async function deleteSeasonReview() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const existing = getCurrentSeasonUserRow();
  if (!existing) return;

  if (existing.manual_score === null && Number(existing.adjustment || 0) === 0) {
    const { error } = await supabase
      .from("season_user_ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("season_user_ratings")
      .update({ review: null })
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
  }

  setMessage("#season-review-message", "Critique saison supprimee.");
  await refreshAll();
}

function bindSeasonCardEvents() {
  const root = document.querySelector("#season-card-root");
  if (!root) return;

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const episodeId = button.dataset.episodeId;

    try {
      let shouldRefresh = false;
      let shouldShowSuccess = false;

      if (action === "save-episode-rating" && episodeId) {
        const saveResult = await saveEpisodeRating(episodeId);
        if (!saveResult?.saved) return;
        state.episodeReviewPromptEpisodeId = saveResult?.shouldOfferMiniReview ? episodeId : null;
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "delete-episode-rating" && episodeId) {
        await deleteEpisodeRating(episodeId);
        state.episodeReviewEditorEpisodeIds.delete(episodeId);
        if (state.episodeReviewPromptEpisodeId === episodeId) {
          state.episodeReviewPromptEpisodeId = null;
        }
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "show-episode-review-editor" && episodeId) {
        state.episodeReviewEditorEpisodeIds.add(episodeId);
        state.episodeReviewPromptEpisodeId = null;
        renderSeasonCard();
        focusEpisodeReviewInput(episodeId);
        return;
      } else if (action === "dismiss-episode-review-prompt" && episodeId) {
        if (state.episodeReviewPromptEpisodeId === episodeId) {
          state.episodeReviewPromptEpisodeId = null;
        }
        renderSeasonCard();
        return;
      } else if (action === "save-season-manual") {
        await saveSeasonManualScore();
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "delete-season-manual") {
        await deleteSeasonManualScore();
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "adjust-season-up") {
        await adjustSeason(0.25);
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "adjust-season-down") {
        await adjustSeason(-0.25);
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "reset-season-adjustment") {
        await resetSeasonAdjustment();
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else {
        return;
      }

      if (shouldShowSuccess) {
        setMessage("#season-form-message", "Sauvegarde reussie.");
      }
      if (shouldRefresh) {
        await refreshAll();
      }
    } catch (error) {
      setMessage("#season-form-message", error.message || "Operation impossible.", true);
    }
  });
}

async function initPage() {
  try {
    await refreshAll();
    bindSeasonCardEvents();

    document.querySelector("#season-review-form")?.addEventListener("submit", async (event) => {
      try {
        await saveSeasonReview(event);
      } catch (error) {
        setMessage("#season-review-message", error.message || "Impossible d'enregistrer la critique saison.", true);
      }
    });

    document.querySelector("#delete-season-review-button")?.addEventListener("click", async () => {
      try {
        await deleteSeasonReview();
      } catch (error) {
        setMessage("#season-review-message", error.message || "Impossible de supprimer la critique saison.", true);
      }
    });
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement de la saison.", true);
  }
}

initPage();
