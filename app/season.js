import { supabase } from "../supabaseClient.js";
import {
  buildAdminReviewEditButtonMarkup,
  buildSpoilerCheckboxMarkup,
  escapeHTML,
  formatDate,
  formatScore,
  getLastEpisodeAirDate,
  getScoreClass,
  getSeasonIdFromURL,
  getSeasonScoreBasisLabel,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  renderReviewParagraph,
  setMessage
} from "./utils.js";
import { getCurrentProfile, getSession, requireAuth } from "./auth.js";

const state = {
  currentUserId: null,
  isAdmin: false,
  season: null,
  series: null,
  episodes: [],
  episodeRatings: [],
  seasonUserRatings: [],
  episodeReviewEditorEpisodeIds: new Set(),
  episodeReviewPromptEpisodeId: null,
  pendingSeasonAdjustPromptCheck: false,
  showSeasonAdjustPrompt: false
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
  if (!isReleasedOnOrBeforeToday(state.season?.start_date || null)) return false;

  const lastEpisodeAirDate = getLastEpisodeAirDate(state.episodes);
  if (lastEpisodeAirDate === null && !state.episodes.length) return true;

  return isReleasedOnOrBeforeToday(lastEpisodeAirDate);
}

function applySeasonAvailability() {
  const canManageSeasonRating = Boolean(state.currentUserId);
  const canRate = isSeasonRateable();
  const messageEl = document.querySelector("#season-rating-unavailable-message");
  const seasonNotReleased = !isReleasedOnOrBeforeToday(state.season?.start_date || null);
  const message = seasonNotReleased
    ? "Cette saison n'est pas encore sortie (ou n'a pas de date de début). La notation est désactivée."
    : "Le dernier épisode de cette saison n'a pas encore été diffusé. La notation de la saison est désactivée.";
  if (messageEl) {
    const shouldShow = canManageSeasonRating && !canRate;
    messageEl.textContent = shouldShow ? message : "";
    messageEl.style.display = shouldShow ? "block" : "none";
  }
}

function applyAuthVisibility() {
  const reviewSection = document.querySelector("#season-review-section");
  if (reviewSection) {
    reviewSection.style.display = state.currentUserId && isSeasonRateable() ? "" : "none";
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
  const partialEpisodeAverages = [];
  for (const userId of allUserIds) {
    const resolved = resolveSeasonUserScoreFromContext(context, userId);
    if (Number.isFinite(resolved.effectiveScore)) effectiveScores.push(resolved.effectiveScore);
    if (Number.isFinite(resolved.episodeAverage)) partialEpisodeAverages.push(resolved.episodeAverage);
  }

  const siteAverage = effectiveScores.length
    ? effectiveScores.reduce((sum, score) => sum + score, 0) / effectiveScores.length
    : null;

  const siteTemporaryAverage = siteAverage === null && partialEpisodeAverages.length
    ? partialEpisodeAverages.reduce((sum, score) => sum + score, 0) / partialEpisodeAverages.length
    : null;

  const user = resolveSeasonUserScoreFromContext(context, state.currentUserId);

  return {
    episodeCount: context.episodeCount,
    userEpisodeAverage: user.episodeAverage,
    userManualScore: user.manualScore,
    userAdjustment: user.adjustment,
    userEffective: user.effectiveScore,
    userHasAllEpisodeRatings: user.isComplete,
    siteAverage,
    siteTemporaryAverage
  };
}

function renderSeasonDetails() {
  const detailsEl = document.querySelector("#season-details");
  if (!detailsEl) return;

  const seasonLabel = state.season?.name || `Saison ${state.season?.season_number || "?"}`;
  const slugLabel = state.season?.slug ? escapeHTML(state.season.slug) : "-";
  detailsEl.innerHTML = `
    <h1>${escapeHTML(seasonLabel)}</h1>
    <p>
      S&eacute;rie:
      <a href="/series.html?id=${state.series?.id || ""}" class="film-link">${escapeHTML(state.series?.title || "-")}</a>
    </p>
    <p class="film-meta">Slug: <code>${slugLabel}</code></p>
  `;
}

function renderSeasonCard() {
  const container = document.querySelector("#season-card-root");
  if (!container) return;

  const reviewSection = document.querySelector("#season-review-section");
  if (reviewSection) {
    reviewSection.remove();
  }

  const metrics = computeSeasonMetrics();
  const showUserEpisodeActions = Boolean(state.currentUserId);
  const canRateSeason = isSeasonRateable();

  const seasonAverage = metrics.userEpisodeAverage === null
    ? `Pas de note`
    : `${formatScore(metrics.userEpisodeAverage, 2, 2)} / 10`;

  const siteAverageBadge = metrics.siteAverage !== null
    ? `<span class="score-badge ${getScoreClass(metrics.siteAverage)}">${formatScore(metrics.siteAverage, 2, 2)}</span> / 10`
    : metrics.siteTemporaryAverage !== null
      ? `<span class="score-badge ${getScoreClass(metrics.siteTemporaryAverage)}">${formatScore(metrics.siteTemporaryAverage, 2, 2)}</span> / 10<small class="score-temporary-tag">⚠️ Temporaire</small>`
      : `<span class="score-badge stade-neutre">Pas de note</span>`;

  const userAverage = metrics.userEffective === null
    ? `<span class="score-badge stade-neutre">-</span>`
    : `<span class="score-badge ${getScoreClass(metrics.userEffective)}">${formatScore(metrics.userEffective, 2, 2)}</span> / 10`;

  const userScoreBasisLabel = metrics.userEffective === null
    ? ""
    : getSeasonScoreBasisLabel(metrics.userManualScore, metrics.userAdjustment);

  const manualValue = metrics.userManualScore === null ? "" : String(metrics.userManualScore);
  const adjustmentValue = formatScore(metrics.userAdjustment, 2, 2);

  const adjustPromptModal = state.showSeasonAdjustPrompt ? `
    <div class="season-adjust-modal">
      <div class="season-adjust-backdrop"></div>
      <div class="season-adjust-dialog" role="dialog" aria-modal="true" aria-labelledby="season-adjust-prompt-title">
        <p id="season-adjust-prompt-title" class="season-adjust-prompt-average">
          Votre moyenne des &eacute;pisodes de cette saison donne
          <span class="score-badge ${getScoreClass(metrics.userEpisodeAverage)}">${formatScore(metrics.userEpisodeAverage, 2, 2)}</span> / 10
        </p>
        <p>Cette moyenne vous convient-elle ? Vous pouvez l'ajuster</p>
        <section class="season-rating-panel">
          <div class="inline-actions season-adjuster">
            <span>Ajusteur de moyenne</span>
            <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-down" aria-label="Diminuer l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
              <i class="fa-solid fa-minus" aria-hidden="true"></i>
            </button>
            <strong>${adjustmentValue}</strong>
            <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-up" aria-label="Augmenter l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
              <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
            <button type="button" class="icon-circle-btn neutral small" data-action="reset-season-adjustment" aria-label="R&eacute;initialiser l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
        </section>
        <p class="film-meta season-adjust-prompt-hint">(Ce syst&egrave;me est utilisable sur chaque s&eacute;rie &#x1F609;)</p>
        <div class="season-adjust-prompt-actions">
          <button type="button" class="button" data-action="confirm-season-adjust-prompt">Valider</button>
          <button type="button" class="ghost-button" data-action="dismiss-season-adjust-prompt">Non, &ccedil;a me convient !</button>
        </div>
      </div>
    </div>
  ` : "";

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
        <h3>${escapeHTML(state.season.name || `Saison ${state.season.season_number}`)}</h3>
        <a href="/series.html?id=${state.series?.id || ""}" class="button season-open-button">Voir page s&eacute;rie</a>
      </div>
      <p>${seasonMetaLine}</p>

      <div class="series-average-row">
        <div class="series-average-block">
          <p class="season-average-label">Moyenne du site</p>
          <p class="score-row">${siteAverageBadge}</p>
        </div>
        ${showUserEpisodeActions ? `
          <div class="series-average-block">
            <p class="season-average-label">Ta note effective de la saison</p>
            <p class="score-row">${userAverage}</p>
            ${userScoreBasisLabel ? `<small class="season-score-basis">${userScoreBasisLabel}</small>` : ""}
          </div>
        ` : ""}
      </div>

      ${showUserEpisodeActions ? `
        <div id="season-review-anchor"></div>

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
              <button type="button" class="icon-circle-btn neutral small" data-action="reset-season-adjustment" aria-label="Réinitialiser l'ajusteur de saison" ${canRateSeason ? "" : "disabled"}>
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
          </section>
        </div>
      ` : `<div id="season-review-anchor"></div>`}

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
                  ? `<span class="score-badge ${getScoreClass(userRating.score)}">${formatScore(userRating.score)}</span> / 10`
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
                          ${buildSpoilerCheckboxMarkup(`episode-review-has-spoiler-${episode.id}`, {
                            checked: Boolean(userRating?.has_spoiler),
                            extraAttrs: `data-field="episode-review-has-spoiler" data-episode-id="${episode.id}"`
                          })}
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
                        <a href="/episode.html?id=${episode.id}" class="icon-circle-btn neutral small icon-link episode-open-link" aria-label="Ouvrir la page épisode">
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
                          <button type="button" class="icon-circle-btn save" data-action="save-episode-rating" data-episode-id="${episode.id}" ${canRate ? "" : "disabled"} aria-label="Valider la note d'épisode">
                            <i class="fa-solid fa-check" aria-hidden="true"></i>
                          </button>
                          ${userRating ? `
                            <button type="button" class="icon-circle-btn delete" data-action="delete-episode-rating" data-episode-id="${episode.id}" ${canRate ? "" : "disabled"} aria-label="Supprimer la note d'épisode">
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
    ${adjustPromptModal}
  `;

  const reviewAnchor = container.querySelector("#season-review-anchor");
  if (reviewAnchor && reviewSection) {
    reviewAnchor.replaceWith(reviewSection);
  }

  document.body.classList.toggle("season-adjust-open", state.showSeasonAdjustPrompt);
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

function getSeasonReferenceDate() {
  return getLastEpisodeAirDate(state.episodes) || state.season?.end_date || null;
}

function renderSeasonReviews(mediaByUserId = new Map()) {
  const listEl = document.querySelector("#season-reviews-list");
  const rows = state.seasonUserRatings.filter((row) => row.review && row.review.trim());

  if (!rows.length) {
    listEl.innerHTML = "<p>Aucune critique pour cette saison.</p>";
    return;
  }

  const referenceDate = getSeasonReferenceDate();
  listEl.innerHTML = rows
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .map((row) => {
      const mediaNames = mediaByUserId.get(row.user_id) || [];
      const mediaLabel = mediaNames.join(", ");
      const editButton = state.isAdmin
        ? buildAdminReviewEditButtonMarkup("season_user_ratings", row.id, {
          authorLabel: row.profiles?.username || "Utilisateur",
          contentLabel: state.season?.name || ""
        })
        : "";
      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(row.profiles?.username || "Utilisateur")}</strong>
            ${mediaLabel ? `<span>${escapeHTML(mediaLabel)}</span>` : ""}
            ${editButton}
          </div>
          ${renderReviewParagraph(row.review, { hasSpoiler: Boolean(row.has_spoiler), referenceDate })}
          <small>${formatDate(row.created_at)}</small>
        </article>
      `;
    })
    .join("");
}

function fillCurrentUserSeasonReview() {
  const textarea = document.querySelector("#season-review");
  const spoilerInput = document.querySelector("#season-review-has-spoiler");
  const deleteBtn = document.querySelector("#delete-season-review-button");
  const row = state.seasonUserRatings.find((item) => item.user_id === state.currentUserId);
  if (!textarea || !deleteBtn) return;

  textarea.value = row?.review || "";
  if (spoilerInput) spoilerInput.checked = Boolean(row?.has_spoiler);
  deleteBtn.style.display = row?.review ? "inline-flex" : "none";
}

function getCurrentSeasonUserRow() {
  return state.seasonUserRatings.find((row) => row.user_id === state.currentUserId);
}

async function loadSeasonData() {
  const seasonId = getSeasonIdFromURL();
  if (!seasonId) {
    setMessage("#page-message", "Saison introuvable: paramètre id manquant.", true);
    return;
  }

  const session = await getSession();
  state.currentUserId = session?.user?.id || null;
  state.isAdmin = session ? Boolean((await getCurrentProfile())?.is_admin) : false;

  const { data: season, error: seasonError } = await supabase
    .from("series_seasons")
    .select("id, series_id, name, season_number, slug, start_date, end_date, phase")
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
      "id, episode_id, user_id, score, review, has_spoiler, created_at, profiles(username)",
      "episode_id",
      episodeIds
    ),
    fetchPagedRows((from, to) =>
      supabase
        .from("season_user_ratings")
        .select("id, season_id, user_id, manual_score, adjustment, review, has_spoiler, created_at, profiles(username)")
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

  if (state.pendingSeasonAdjustPromptCheck) {
    state.pendingSeasonAdjustPromptCheck = false;
    if (computeSeasonMetrics().userHasAllEpisodeRatings) {
      state.showSeasonAdjustPrompt = true;
    }
  }

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
    setMessage("#season-form-message", "Impossible de noter un épisode non diffusé ou sans date de diffusion.", true);
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
    setMessage("#season-form-message", "Le score doit être entre 0 et 10, par pas de 0,25.", true);
    return { saved: false };
  }

  const existing = state.episodeRatings.find((row) => row.episode_id === episodeId && row.user_id === session.user.id);
  const reviewInput = document.querySelector(`[data-field="episode-review"][data-episode-id="${episodeId}"]`);
  const spoilerInput = document.querySelector(`[data-field="episode-review-has-spoiler"][data-episode-id="${episodeId}"]`);
  const reviewValue = reviewInput ? reviewInput.value.trim() : "";
  const hasExistingReview = String(existing?.review || "").trim().length > 0;
  const nextReview = reviewInput ? (reviewValue || null) : (existing?.review ?? null);
  const nextHasSpoiler = reviewInput
    ? Boolean(nextReview && spoilerInput?.checked)
    : Boolean(existing?.has_spoiler);
  const { error } = await supabase.from("episode_ratings").upsert(
    {
      user_id: session.user.id,
      episode_id: episodeId,
      score,
      review: nextReview,
      has_spoiler: nextHasSpoiler
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
    setMessage("#season-form-message", "Impossible de noter une saison non sortie ou dont le dernier épisode n'a pas été diffusé.", true);
    return;
  }

  const raw = document.querySelector(`[data-field="season-manual-score"]`)?.value?.trim() || "";
  if (!raw) {
    setMessage("#season-form-message", "Saisis une note de saison ou utilise suppression.", true);
    return;
  }

  const score = Number(raw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#season-form-message", "La note de saison doit être entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const existing = getCurrentSeasonUserRow();
  const { error } = await supabase.from("season_user_ratings").upsert(
    {
      user_id: session.user.id,
      season_id: state.season.id,
      manual_score: score,
      adjustment: 0,
      review: existing?.review ?? null,
      has_spoiler: existing?.has_spoiler ?? false
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
    setMessage("#season-form-message", "Impossible d'ajuster une saison non sortie ou dont le dernier épisode n'a pas été diffusé.", true);
    return;
  }

  const existing = getCurrentSeasonUserRow();
  const metrics = computeSeasonMetrics();
  const base = Number.isFinite(metrics.userEpisodeAverage) ? toFixedNumber(metrics.userEpisodeAverage, 2) : null;

  if (metrics.userManualScore !== null) {
    setMessage("#season-form-message", "L'ajusteur est désactivé quand une note manuelle de saison est définie.", true);
    return;
  }

  if (!Number.isFinite(base) || !metrics.userHasAllEpisodeRatings) {
    setMessage("#season-form-message", "Il faut noter tous les épisodes pour utiliser l'ajusteur.", true);
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
    review: existing?.review ?? null,
    has_spoiler: existing?.has_spoiler ?? false
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
        review: existing.review ?? null,
        has_spoiler: existing.has_spoiler ?? false
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
  const hasSpoiler = document.querySelector("#season-review-has-spoiler").checked;
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
          review: reviewValue || null,
          has_spoiler: reviewValue ? hasSpoiler : false
        },
        { onConflict: "user_id,season_id" }
      );
    if (error) throw error;
  }

  setMessage("#season-review-message", "Critique saison enregistrée.");
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
      .update({ review: null, has_spoiler: false })
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
  }

  setMessage("#season-review-message", "Critique saison supprimée.");
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
        const savedEpisode = state.episodes.find((item) => item.id === episodeId);
        const lastEpisodeNumber = Math.max(...state.episodes.map((item) => item.episode_number));
        state.pendingSeasonAdjustPromptCheck = savedEpisode?.episode_number === lastEpisodeNumber;
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "confirm-season-adjust-prompt" || action === "dismiss-season-adjust-prompt") {
        state.showSeasonAdjustPrompt = false;
        renderSeasonCard();
        return;
      } else if (action === "delete-episode-rating" && episodeId) {
        const existingReview = state.episodeRatings.find(
          (rating) => rating.episode_id === episodeId && rating.user_id === state.currentUserId
        )?.review;
        if (String(existingReview || "").trim()) {
          const confirmed = window.confirm(
            "Supprimer ta note supprimera aussi la critique que tu as écrite pour cet épisode. Continuer ?"
          );
          if (!confirmed) return;
        }
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
        setMessage("#season-form-message", "Sauvegarde réussie.");
      }
      if (shouldRefresh) {
        await refreshAll();
      }
    } catch (error) {
      setMessage("#season-form-message", error.message || "Opération impossible.", true);
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
