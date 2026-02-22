import { supabase } from "../supabaseClient.js";
import {
  buildDenseRankLabels,
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

const SERIES_LIST_FILTERS_STORAGE_KEY = "marvelreview:series:list-filters:v1";
const VALID_SERIES_SORT_MODES = new Set(["date_desc", "date_asc", "rating_desc", "rating_asc"]);
const DEFAULT_SERIES_LIST_FILTERS = Object.freeze({
  search: "",
  franchise: "",
  phase: "",
  type: "",
  sort: "date_desc"
});

const state = {
  currentUserId: null,
  series: null,
  seasons: [],
  episodes: [],
  listSeriesRows: [],
  episodeRatings: [],
  seasonUserRatings: [],
  seriesReviews: [],
  listFilters: { ...DEFAULT_SERIES_LIST_FILTERS },
  socialExpanded: {
    reviews: false,
    activity: false
  },
  socialExpandedEntries: new Set(),
  episodeReviewEditorEpisodeIds: new Set(),
  episodeReviewPromptEpisodeId: null
};

const SOCIAL_MOBILE_QUERY = "(max-width: 700px)";
const SOCIAL_MOBILE_VISIBLE_ITEMS = 4;
const SOCIAL_PREVIEW_WORD_LIMIT = 34;
const SUPABASE_PAGE_SIZE = 1000;
const IN_FILTER_CHUNK_SIZE = 200;
const listFranchiseFilterEl = document.querySelector("#series-franchise-filter");
const listPhaseFilterEl = document.querySelector("#series-phase-filter");
const listPhaseFilterWrapEl = document.querySelector("#series-phase-filter-wrap");
const listTypeFilterEl = document.querySelector("#series-type-filter");
const listSortFilterEl = document.querySelector("#series-sort-filter");
const listTitleSearchEl = document.querySelector("#series-title-search");
const resetSeriesFiltersEl = document.querySelector("#series-reset-filters");

function normalizeSeriesListFilters(filters) {
  const source = filters && typeof filters === "object" ? filters : {};
  return {
    search: typeof source.search === "string" ? source.search : "",
    franchise: typeof source.franchise === "string" ? source.franchise : "",
    phase: typeof source.phase === "string" ? source.phase : "",
    type: typeof source.type === "string" ? source.type : "",
    sort: typeof source.sort === "string" && VALID_SERIES_SORT_MODES.has(source.sort)
      ? source.sort
      : DEFAULT_SERIES_LIST_FILTERS.sort
  };
}

function loadSeriesListFilters() {
  try {
    const raw = window.localStorage.getItem(SERIES_LIST_FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SERIES_LIST_FILTERS };
    const parsed = JSON.parse(raw);
    return normalizeSeriesListFilters(parsed);
  } catch (_error) {
    return { ...DEFAULT_SERIES_LIST_FILTERS };
  }
}

function saveSeriesListFilters() {
  try {
    window.localStorage.setItem(
      SERIES_LIST_FILTERS_STORAGE_KEY,
      JSON.stringify(normalizeSeriesListFilters(state.listFilters))
    );
  } catch (_error) {
    // Ignore storage failures (private mode, quota, etc).
  }
}

function setSeriesSelectValue(selectEl, value) {
  if (!selectEl) return "";
  const nextValue = Array.from(selectEl.options).some((option) => option.value === value)
    ? value
    : "";
  selectEl.value = nextValue;
  return nextValue;
}

function applySeriesListFiltersToControls() {
  state.listFilters.franchise = setSeriesSelectValue(listFranchiseFilterEl, state.listFilters.franchise);
  state.listFilters.phase = setSeriesSelectValue(listPhaseFilterEl, state.listFilters.phase);
  state.listFilters.type = setSeriesSelectValue(listTypeFilterEl, state.listFilters.type);

  const selectedSort = setSeriesSelectValue(listSortFilterEl, state.listFilters.sort);
  state.listFilters.sort = selectedSort || DEFAULT_SERIES_LIST_FILTERS.sort;
  if (listSortFilterEl && !selectedSort) {
    listSortFilterEl.value = state.listFilters.sort;
  }

  if (listTitleSearchEl) {
    listTitleSearchEl.value = state.listFilters.search;
  }
}

function resetSeriesListFilters() {
  Object.assign(state.listFilters, DEFAULT_SERIES_LIST_FILTERS);
  applySeriesListFiltersToControls();
  updateListPhaseVisibility();
  saveSeriesListFilters();
  renderSeriesListWithFilters();
}

Object.assign(state.listFilters, loadSeriesListFilters());

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

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

function getDateSortValue(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function fillSelect(selectEl, values, allLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
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

function canReviewSeries() {
  return isReleasedOnOrBeforeToday(state.series?.start_date || null);
}

function applySeriesAuthVisibility() {
  const myAverageBlock = document.querySelector("#series-my-average-block");
  const reviewSection = document.querySelector("#series-review-section");
  const isLoggedIn = Boolean(state.currentUserId);

  if (myAverageBlock) {
    myAverageBlock.style.display = isLoggedIn ? "" : "none";
  }

  if (reviewSection) {
    reviewSection.style.display = isLoggedIn ? "" : "none";
  }

  if (!isLoggedIn) {
    state.episodeReviewEditorEpisodeIds.clear();
    state.episodeReviewPromptEpisodeId = null;
  }
}

function applySeriesReviewAvailability() {
  if (!state.currentUserId) {
    const messageEl = document.querySelector("#series-rating-unavailable-message");
    if (messageEl) {
      messageEl.textContent = "";
      messageEl.style.display = "none";
    }
    return;
  }

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

function buildSeasonComputationContext(seasonId) {
  const seasonEpisodes = state.episodes.filter((episode) => episode.season_id === seasonId);
  const episodeCount = seasonEpisodes.length;
  const episodeIds = new Set(seasonEpisodes.map((episode) => episode.id));

  const episodeStatsByUser = new Map();
  for (const rating of state.episodeRatings) {
    if (!episodeIds.has(rating.episode_id)) continue;
    const current = episodeStatsByUser.get(rating.user_id) || {
      total: 0,
      count: 0,
      lastCreatedAt: null,
      lastCreatedAtTs: 0,
      username: null
    };
    current.total += Number(rating.score || 0);
    current.count += 1;
    const createdAtTs = getSocialTimeValue(rating.created_at);
    if (createdAtTs >= current.lastCreatedAtTs) {
      current.lastCreatedAtTs = createdAtTs;
      current.lastCreatedAt = rating.created_at || null;
      current.username = rating.profiles?.username || current.username;
    }
    episodeStatsByUser.set(rating.user_id, current);
  }

  const seasonRowsByUser = new Map();
  for (const row of state.seasonUserRatings) {
    if (row.season_id !== seasonId) continue;
    seasonRowsByUser.set(row.user_id, row);
  }

  return {
    episodeCount,
    episodeStatsByUser,
    seasonRowsByUser
  };
}

function resolveSeasonUserScoreFromContext(context, userId) {
  const stats = context.episodeStatsByUser.get(userId) || {
    total: 0,
    count: 0,
    lastCreatedAt: null,
    username: null
  };
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
    isComplete,
    statementAt: seasonRow?.created_at || stats.lastCreatedAt || null,
    username: seasonRow?.profiles?.username || stats.username || "Utilisateur"
  };
}

function computeSeasonMetrics(seasonId) {
  const context = buildSeasonComputationContext(seasonId);
  const allUserIds = new Set([...context.episodeStatsByUser.keys(), ...context.seasonRowsByUser.keys()]);
  const effectiveScores = [];
  for (const userId of allUserIds) {
    const resolved = resolveSeasonUserScoreFromContext(context, userId);
    if (Number.isFinite(resolved.effectiveScore)) {
      effectiveScores.push(resolved.effectiveScore);
    }
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

function computeSeriesSeasonScoresByUser() {
  const userSeasonScores = new Map();
  if (!state.seasons.length) {
    return userSeasonScores;
  }

  for (const season of state.seasons) {
    const context = buildSeasonComputationContext(season.id);
    const allUserIds = new Set([...context.episodeStatsByUser.keys(), ...context.seasonRowsByUser.keys()]);
    for (const userId of allUserIds) {
      const resolved = resolveSeasonUserScoreFromContext(context, userId);
      if (!Number.isFinite(resolved.effectiveScore)) continue;
      const current = userSeasonScores.get(userId) || [];
      current.push(resolved.effectiveScore);
      userSeasonScores.set(userId, current);
    }
  }

  return userSeasonScores;
}

function computeSeriesAverageByUserId() {
  const userAverageById = new Map();
  const userSeasonScores = computeSeriesSeasonScoresByUser();

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

  const userSeasonScores = computeSeriesSeasonScoresByUser();

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

function updateListPhaseVisibility() {
  const showPhase = state.listFilters.franchise === "MCU";
  if (listPhaseFilterWrapEl) {
    listPhaseFilterWrapEl.style.display = showPhase ? "grid" : "none";
  }
  if (!showPhase) {
    state.listFilters.phase = "";
    if (listPhaseFilterEl) listPhaseFilterEl.value = "";
  }
}

function sortSeriesRows(rows) {
  const sorted = [...rows];
  const sortMode = state.listFilters.sort || "date_desc";

  sorted.sort((a, b) => {
    if (sortMode === "date_asc" || sortMode === "date_desc") {
      const aTs = getDateSortValue(a.start_date);
      const bTs = getDateSortValue(b.start_date);
      if (aTs !== bTs) return sortMode === "date_asc" ? aTs - bTs : bTs - aTs;
      return (a.title || "").localeCompare(b.title || "", "fr");
    }

    const aAverage = Number.isFinite(a.average) ? a.average : null;
    const bAverage = Number.isFinite(b.average) ? b.average : null;
    if (aAverage === null && bAverage === null) {
      return (a.title || "").localeCompare(b.title || "", "fr");
    }
    if (aAverage === null) return 1;
    if (bAverage === null) return -1;
    if (aAverage !== bAverage) {
      return sortMode === "rating_asc" ? aAverage - bAverage : bAverage - aAverage;
    }
    return (a.title || "").localeCompare(b.title || "", "fr");
  });

  return sorted;
}

function renderSeriesListWithFilters() {
  const searchText = (state.listFilters.search || "").trim().toLocaleLowerCase("fr");
  const filtered = state.listSeriesRows.filter((item) => {
    const franchise = (item.franchise || "").trim();
    const hasFranchise = franchise.length > 0;
    const matchesFranchise = !state.listFilters.franchise
      || (state.listFilters.franchise === "__OTHER__"
        ? !hasFranchise || (franchise !== "MCU" && franchise !== "SSU")
        : franchise === state.listFilters.franchise);
    const matchesType = !state.listFilters.type || (item.type || "") === state.listFilters.type;
    const matchesPhase = !state.listFilters.phase || (item.mcuPhases || []).includes(state.listFilters.phase);
    const matchesSearch = !searchText || (item.title || "").toLocaleLowerCase("fr").includes(searchText);

    return matchesFranchise && matchesType && matchesPhase && matchesSearch;
  });

  renderSeriesList(sortSeriesRows(filtered));
}

function setupSeriesListFilters() {
  const types = Array.from(
    new Set(state.listSeriesRows.map((row) => row.type).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const mcuPhases = Array.from(
    new Set(
      state.listSeriesRows
        .filter((row) => row.franchise === "MCU")
        .flatMap((row) => row.mcuPhases || [])
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  fillSelect(listTypeFilterEl, types, "Tous les types");
  fillSelect(listPhaseFilterEl, mcuPhases, "Toutes les phases");
  applySeriesListFiltersToControls();
  updateListPhaseVisibility();
  saveSeriesListFilters();

  listFranchiseFilterEl?.addEventListener("change", () => {
    state.listFilters.franchise = listFranchiseFilterEl.value || "";
    updateListPhaseVisibility();
    saveSeriesListFilters();
    renderSeriesListWithFilters();
  });

  listPhaseFilterEl?.addEventListener("change", () => {
    state.listFilters.phase = listPhaseFilterEl.value || "";
    saveSeriesListFilters();
    renderSeriesListWithFilters();
  });

  listTypeFilterEl?.addEventListener("change", () => {
    state.listFilters.type = listTypeFilterEl.value || "";
    saveSeriesListFilters();
    renderSeriesListWithFilters();
  });

  listSortFilterEl?.addEventListener("change", () => {
    state.listFilters.sort = listSortFilterEl.value || "date_desc";
    saveSeriesListFilters();
    renderSeriesListWithFilters();
  });

  listTitleSearchEl?.addEventListener("input", () => {
    state.listFilters.search = listTitleSearchEl.value || "";
    saveSeriesListFilters();
    renderSeriesListWithFilters();
  });

  resetSeriesFiltersEl?.addEventListener("click", resetSeriesListFilters);
}

function renderSeriesList(rows) {
  const listEl = document.querySelector("#series-list");
  if (!rows.length) {
    listEl.innerHTML = "<p>Aucune s\u00E9rie pour le moment.</p>";
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
          <p>D\u00E9but: ${formatDate(item.start_date)}</p>
          <p>Fin: ${formatDate(item.end_date)}</p>
          <p class="film-meta">${escapeHTML(item.franchise || "-")} - ${escapeHTML(item.type || "S\u00E9rie")}</p>
          <div class="home-latest-card-action">
            <a class="button" href="/series.html?id=${item.id}">Voir la page s\u00E9rie</a>
          </div>
        </div>
      </article>
    `)
    .join("");
}

function renderSeriesHeader() {
  const detailsEl = document.querySelector("#series-details");
  const series = state.series;
  detailsEl.innerHTML = `
    <article class="film-hero">
      <div class="film-hero-content">
        <h1>${escapeHTML(series.title)}</h1>
        <p><u>D\u00E9but</u> : ${formatDate(series.start_date)} - <u>Fin</u> : ${formatDate(series.end_date)}</p>
        <p>${escapeHTML(series.synopsis || "Aucun synopsis.")}</p>
      </div>
      <img class="film-hero-poster" src="${escapeHTML(series.poster_url || "https://via.placeholder.com/260x390?text=Serie")}" alt="Affiche de ${escapeHTML(series.title)}" />
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

function isSocialMobileLayout() {
  return window.matchMedia(SOCIAL_MOBILE_QUERY).matches;
}

function updateSocialMoreButton(selector, shouldShow, expanded) {
  const button = document.querySelector(selector);
  if (!button) return;
  button.style.display = shouldShow ? "inline-flex" : "none";
  button.textContent = expanded ? "Voir moins" : "Voir plus";
}

function renderSocialReviewSnippet(reviewValue, entryId) {
  const fullText = String(reviewValue || "").trim();
  if (!fullText) return "";

  const words = fullText.split(/\s+/).filter(Boolean);
  const isTruncated = words.length > SOCIAL_PREVIEW_WORD_LIMIT;
  const isExpanded = state.socialExpandedEntries.has(entryId);
  const previewText = isTruncated
    ? `${words.slice(0, SOCIAL_PREVIEW_WORD_LIMIT).join(" ")}...`
    : fullText;
  const textToDisplay = isExpanded ? fullText : previewText;

  return `
    <p class="social-review-text">${escapeHTML(textToDisplay)}</p>
    ${isTruncated ? `
      <button type="button" class="ghost-button social-inline-more" data-action="toggle-series-review-preview" data-entry-id="${escapeHTML(entryId)}">
        ${isExpanded ? "Voir moins" : "Voir plus"}
      </button>
    ` : ""}
  `;
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

function computeSeasonEffectiveScoreForUser(seasonId, userId, context = null) {
  const seasonContext = context || buildSeasonComputationContext(seasonId);
  const resolved = resolveSeasonUserScoreFromContext(seasonContext, userId);
  return Number.isFinite(resolved.effectiveScore) ? resolved.effectiveScore : null;
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

  for (const season of state.seasons) {
    const seasonContext = buildSeasonComputationContext(season.id);
    const allUserIds = new Set([...seasonContext.episodeStatsByUser.keys(), ...seasonContext.seasonRowsByUser.keys()]);

    for (const userId of allUserIds) {
      const seasonRow = seasonContext.seasonRowsByUser.get(userId);
      const resolved = resolveSeasonUserScoreFromContext(seasonContext, userId);
      const hasManual = Number.isFinite(Number(seasonRow?.manual_score));
      const hasAdjustment = Number(seasonRow?.adjustment || 0) !== 0;
      const hasReview = String(seasonRow?.review || "").trim().length > 0;
      const hasAutoStatement = Number.isFinite(resolved.effectiveScore)
        && resolved.manualScore === null
        && resolved.adjustment === 0
        && resolved.isComplete;
      if (!hasManual && !hasAdjustment && !hasReview && !hasAutoStatement) continue;

      rows.push({
        id: seasonRow?.id ? `season-${seasonRow.id}` : `season-auto-${season.id}-${userId}`,
        type: "season",
        user_id: userId,
        username: resolved.username,
        created_at: seasonRow?.created_at || resolved.statementAt,
        score: Number.isFinite(resolved.effectiveScore) ? resolved.effectiveScore : null,
        adjustment: resolved.adjustment,
        review: seasonRow?.review || "",
        href: `/season.html?id=${season.id}`,
        title: season?.name || "Saison",
        seasonLabel: season?.season_number ? `S${season.season_number}` : "Saison"
      });
    }
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
    listEl.innerHTML = "<p>Aucune critique pour cette s\u00E9rie.</p>";
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
      const entryId = `series-review-${review.id || review.user_id}`;
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
          ${renderSocialReviewSnippet(review.review, entryId)}
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
    listEl.innerHTML = "<p>Aucune note ou critique r\u00E9cente sur les saisons/\u00E9pisodes.</p>";
    updateSocialMoreButton('[data-action="toggle-series-activity-more"]', false, state.socialExpanded.activity);
    return;
  }

  listEl.innerHTML = rowsToShow
    .map((row) => {
      const mediaNames = mediaByUserId.get(row.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";
      const entryId = `series-activity-${row.id}`;
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
          ${renderSocialReviewSnippet(row.review, entryId)}
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

  if (!state.currentUserId) {
    myEl.innerHTML = "";
    return;
  }

  myEl.innerHTML = metrics.myAverage === null
    ? `<span class="score-badge stade-neutre">Tu n'as pas encore de moyenne sur cette serie</span>`
    : `<span class="score-badge ${getScoreClass(metrics.myAverage)}">${formatScore(metrics.myAverage, 2, 2)} / 10</span>`;
}

function computeEpisodeSiteRankingRows() {
  const seasonById = new Map(state.seasons.map((season) => [season.id, season]));
  const rows = [];

  for (const episode of state.episodes) {
    const ratings = state.episodeRatings.filter((rating) => rating.episode_id === episode.id);
    if (!ratings.length) continue;

    const total = ratings.reduce((sum, rating) => sum + Number(rating.score || 0), 0);
    const average = total / ratings.length;
    const season = seasonById.get(episode.season_id);

    rows.push({
      id: episode.id,
      title: episode.title || "Episode",
      seasonEpisodeLabel: `S${season?.season_number || "?"} - E${episode.episode_number || "?"}`,
      average,
      count: ratings.length,
      href: `/episode.html?id=${episode.id}`
    });
  }

  return rows.sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    if (b.count !== a.count) return b.count - a.count;
    return a.title.localeCompare(b.title, "fr");
  });
}

function computeSeasonSiteRankingRows() {
  const rows = state.seasons.map((season) => {
    const context = buildSeasonComputationContext(season.id);
    const allUserIds = new Set([...context.episodeStatsByUser.keys(), ...context.seasonRowsByUser.keys()]);
    const scores = [];

    for (const userId of allUserIds) {
      const resolved = resolveSeasonUserScoreFromContext(context, userId);
      if (Number.isFinite(resolved.effectiveScore)) {
        scores.push(resolved.effectiveScore);
      }
    }

    const average = scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null;

    return {
      id: season.id,
      title: season.name || `Saison ${season.season_number}`,
      average,
      count: scores.length,
      href: `/season.html?id=${season.id}`
    };
  });

  return rows
    .filter((row) => Number.isFinite(row.average))
    .sort((a, b) => {
    const aAverage = a.average ?? -1;
    const bAverage = b.average ?? -1;
    if (bAverage !== aAverage) return bAverage - aAverage;
    if (b.count !== a.count) return b.count - a.count;
    return a.title.localeCompare(b.title, "fr");
  });
}

function renderSeriesCompactRows(rows, options = {}) {
  const {
    showEpisodeMeta = false,
    rankLabels = null,
    startIndex = 0
  } = options;

  const resolvedRankLabels = rankLabels || buildDenseRankLabels(rows, (row) => row.average, 2);
  return rows
    .map((row, index) => `
      <article class="series-compact-row ${showEpisodeMeta ? "with-meta" : "without-meta"}">
        <span class="series-compact-rank">${resolvedRankLabels[startIndex + index] || "-"}</span>
        <a href="${row.href}" class="film-link">${escapeHTML(row.title)}</a>
        ${showEpisodeMeta ? `<small>${escapeHTML(row.seasonEpisodeLabel || "-")}</small>` : ""}
        <span class="score-badge ${getScoreClass(row.average)}">${formatScore(row.average, 2, 2)}</span>
      </article>
    `)
    .join("");
}

function renderSeriesCompactRankings() {
  const episodeListEl = document.querySelector("#series-episode-ranking-list");
  const seasonListEl = document.querySelector("#series-season-ranking-list");
  if (!episodeListEl || !seasonListEl) return;

  const episodeRows = computeEpisodeSiteRankingRows();
  const seasonRows = computeSeasonSiteRankingRows();

  if (!episodeRows.length) {
    episodeListEl.innerHTML = `<p class="film-meta">Aucune note d'\u00E9pisode pour le moment.</p>`;
  } else {
    const episodeRankLabels = buildDenseRankLabels(episodeRows, (row) => row.average, 2);
    episodeListEl.innerHTML = `
      <div class="series-compact-list series-compact-list-scroll">
        ${renderSeriesCompactRows(episodeRows, {
          showEpisodeMeta: true,
          rankLabels: episodeRankLabels,
          startIndex: 0
        })}
      </div>
    `;
  }

  if (seasonRows.length < 2) {
    seasonListEl.innerHTML = `<p class="film-meta">Classement disponible \u00E0 partir de 2 saisons not\u00E9es.</p>`;
  } else {
    seasonListEl.innerHTML = `<div class="series-compact-list">${renderSeriesCompactRows(seasonRows)}</div>`;
  }
}

function renderSeasons(openSeasonIds = null) {
  const container = document.querySelector("#series-seasons-list");
  if (!state.seasons.length) {
    container.innerHTML = "<p>Aucune saison pour cette serie.</p>";
    return;
  }

  const initialOpenAll = openSeasonIds === null;
  const showUserEpisodeActions = Boolean(state.currentUserId);

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

      const siteAverageBadge = metrics.siteAverage === null
        ? `<span class="score-badge stade-neutre">Pas de note</span>`
        : `<span class="score-badge ${getScoreClass(metrics.siteAverage)}">${formatScore(metrics.siteAverage, 2, 2)} / 10</span>`;

      const userAverage = metrics.userEffective === null
        ? `<span class="score-badge stade-neutre">-</span>`
        : `<span class="score-badge ${getScoreClass(metrics.userEffective)}">${formatScore(metrics.userEffective, 2, 2)} / 10</span>`;

      const manualValue = metrics.userManualScore === null ? "" : String(metrics.userManualScore);
      const adjustmentValue = formatScore(metrics.userAdjustment, 2, 2);
      const isOpen = initialOpenAll || openSeasonIds.has(season.id);
      const phaseLabel = String(season.phase || "").trim();
      const seasonMetaParts = [];
      if (phaseLabel) {
        seasonMetaParts.push(`Phase: ${escapeHTML(phaseLabel)}`);
      }
      seasonMetaParts.push(`D\u00E9but: ${formatDate(season.start_date)}`);
      seasonMetaParts.push(`Fin: ${formatDate(season.end_date)}`);
      const seasonMetaLine = seasonMetaParts.join(" | ");

      return `
        <article class="card">
          <div class="season-card-header">
            <h3>
              ${escapeHTML(season.name || `Saison ${season.season_number}`)}
              - Moyenne du site: ${siteAverageBadge}
            </h3>
            <a href="/season.html?id=${season.id}" class="button season-open-button">Voir page saison</a>
          </div>
          <p>${seasonMetaLine}</p>

          ${showUserEpisodeActions ? `
            <div class="season-rating-separator" aria-hidden="true"></div>
            <p>Ta note effective de la saison: ${userAverage}</p>
            <p class="film-meta">Base utilis\u00E9e pour ta note : ${metrics.userManualScore === null ? "Moyenne de tes \u00E9pisodes" : "Note manuelle de saison"} | \u00C9pisodes: ${metrics.episodeCount}</p>

            <div class="season-rating-layout">
              <section class="season-rating-panel">
                <p class="film-meta season-manual-help">Renseigne une note g\u00E9n\u00E9rale pour toute la saison (optionnel).</p>
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
              </section>

              <section class="season-rating-panel">
                <p>Moyenne de tes \u00E9pisodes: <b>${seasonAverage}</b></p>
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
              </section>
            </div>
          ` : ""}

          <details class="season-episodes" data-season-id="${season.id}" ${isOpen ? "open" : ""}>
            <summary class="season-episodes-summary">
              <span class="season-summary-label">
                <i class="fa-solid fa-caret-right season-summary-caret" aria-hidden="true"></i>
                \u00C9pisodes
              </span>
              <small>Cliquer pour replier / d\u00E9plier</small>
            </summary>
            <div class="table-wrapper">
              <table class="ranking-table compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>\u00C9pisode</th>
                    <th>Diffusion</th>
                    <th>Moyenne</th>
                    ${showUserEpisodeActions ? "<th>Ta note</th>" : ""}
                    ${showUserEpisodeActions ? "<th>Modifier</th>" : ""}
                  </tr>
                </thead>
                <tbody>
                  ${seasonEpisodes.map((episode) => {
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
                              <textarea id="episode-review-${episode.id}" data-field="episode-review" data-episode-id="${episode.id}" maxlength="420" placeholder="Ton avis rapide en quelques lignes...">${escapeHTML(reviewValue)}</textarea>
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
  const episodes = seasonIds.length
    ? await fetchAllRowsByIn(
      "series_episodes",
      "id, season_id, episode_number, title, air_date",
      "season_id",
      seasonIds,
      "episode_number",
      true
    )
    : [];

  state.series = series;
  state.seasons = seasons || [];
  state.episodes = episodes || [];
}

async function loadRatingsData() {
  const seasonIds = state.seasons.map((season) => season.id);
  const episodeIds = state.episodes.map((episode) => episode.id);

  const [episodeRatings, seasonUserRatings, seriesReviews] = await Promise.all([
    episodeIds.length
      ? fetchAllRowsByIn(
        "episode_ratings",
        "id, episode_id, user_id, score, review, created_at, profiles(username)",
        "episode_id",
        episodeIds
      )
      : Promise.resolve([]),
    seasonIds.length
      ? fetchAllRowsByIn(
        "season_user_ratings",
        "id, season_id, user_id, manual_score, adjustment, review, created_at, profiles(username)",
        "season_id",
        seasonIds
      )
      : Promise.resolve([]),
    state.series?.id
      ? fetchAllRowsByEq(
        "series_reviews",
        "id, series_id, user_id, review, created_at, profiles(username)",
        "series_id",
        state.series.id,
        "created_at",
        false
      )
      : Promise.resolve([])
  ]);

  state.episodeRatings = episodeRatings || [];
  state.seasonUserRatings = seasonUserRatings || [];
  state.seriesReviews = seriesReviews || [];
  syncEpisodeMiniReviewUiState();
}

async function reloadSeriesDetails(seriesId) {
  await loadSeriesStructure(seriesId);
  await loadRatingsData();
  state.socialExpanded.reviews = false;
  state.socialExpanded.activity = false;
  state.socialExpandedEntries.clear();
  state.episodeReviewEditorEpisodeIds.clear();
  state.episodeReviewPromptEpisodeId = null;
  applySeriesAuthVisibility();
  renderSeriesHeader();
  applySeriesReviewAvailability();
  fillCurrentUserSeriesReview();
  renderSeriesAverage();
  renderSeriesCompactRankings();
  const userIds = getSeriesSocialUserIds();
  const mediaByUserId = await loadMembershipMapForUsers(userIds);
  renderSeriesReviews(mediaByUserId);
  renderSeriesSocialActivity(mediaByUserId);
  renderSeasons();
}

async function refreshRatingsOnly() {
  const openSeasonIds = getOpenSeasonIdsFromDOM();
  await loadRatingsData();
  applySeriesAuthVisibility();
  applySeriesReviewAvailability();
  fillCurrentUserSeriesReview();
  renderSeriesAverage();
  renderSeriesCompactRankings();
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
  if (!session) return { saved: false };

  const episode = state.episodes.find((item) => item.id === episodeId);
  if (!isReleasedOnOrBeforeToday(episode?.air_date || null)) {
    setMessage("#page-message", "Impossible de noter un episode non diffuse ou sans date de diffusion.", true);
    return { saved: false };
  }

  const scoreInput = document.querySelector(`[data-field="episode-score"][data-episode-id="${episodeId}"]`);
  const scoreRaw = scoreInput?.value.trim() || "";
  if (!scoreRaw) {
    setMessage("#page-message", "Le score est obligatoire.", true);
    return { saved: false };
  }

  const score = Number(scoreRaw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#page-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
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

  if (!Number.isFinite(base) || !metrics.userHasAllEpisodeRatings) {
    setMessage("#page-message", "Il faut noter tous les episodes pour utiliser l'ajusteur.", true);
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
      let shouldRefresh = false;
      let shouldShowSuccess = false;

      if (action === "toggle-series-reviews-more") {
        state.socialExpanded.reviews = !state.socialExpanded.reviews;
        shouldRefresh = true;
      } else if (action === "toggle-series-activity-more") {
        state.socialExpanded.activity = !state.socialExpanded.activity;
        shouldRefresh = true;
      } else if (action === "toggle-series-review-preview") {
        const entryId = button.dataset.entryId || "";
        if (!entryId) return;
        if (state.socialExpandedEntries.has(entryId)) {
          state.socialExpandedEntries.delete(entryId);
        } else {
          state.socialExpandedEntries.add(entryId);
        }
        shouldRefresh = true;
      } else if (action === "show-episode-review-editor" && episodeId) {
        state.episodeReviewEditorEpisodeIds.add(episodeId);
        state.episodeReviewPromptEpisodeId = null;
        const openSeasonIds = getOpenSeasonIdsFromDOM();
        renderSeasons(openSeasonIds);
        focusEpisodeReviewInput(episodeId);
        return;
      } else if (action === "dismiss-episode-review-prompt" && episodeId) {
        if (state.episodeReviewPromptEpisodeId === episodeId) {
          state.episodeReviewPromptEpisodeId = null;
        }
        const openSeasonIds = getOpenSeasonIdsFromDOM();
        renderSeasons(openSeasonIds);
        return;
      } else if (action === "save-episode-rating" && episodeId) {
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
      } else if (action === "save-season-manual" && seasonId) {
        await saveSeasonManualScore(seasonId);
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "delete-season-manual" && seasonId) {
        await deleteSeasonManualScore(seasonId);
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "adjust-season-up" && seasonId) {
        await adjustSeason(seasonId, 0.25);
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "adjust-season-down" && seasonId) {
        await adjustSeason(seasonId, -0.25);
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else if (action === "reset-season-adjustment" && seasonId) {
        await resetSeasonAdjustment(seasonId);
        shouldRefresh = true;
        shouldShowSuccess = true;
      } else {
        return;
      }

      if (shouldShowSuccess) {
        setMessage("#page-message", "Sauvegarde reussie.");
      }
      if (shouldRefresh) {
        await refreshRatingsOnly();
      }
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
    const pageTitleEl = document.querySelector("#series-page-title");

    const seriesId = getSeriesIdFromURL();
    if (!seriesId) {
      if (pageTitleEl) pageTitleEl.style.display = "";
      const subtitleEl = document.querySelector("#series-subtitle");
      const subtitleNoteEl = document.querySelector("#series-subtitle-note");
      if (subtitleEl) subtitleEl.textContent = "Choisis une s\u00E9rie pour afficher ses saisons et \u00E9pisodes.";
      if (subtitleNoteEl) subtitleNoteEl.textContent = "";

      const [seriesList, seasons, episodes, episodeRatings, seasonUserRatings] = await Promise.all([
        fetchAllRows("series", "id, title, poster_url, start_date, end_date, franchise, type", "start_date", false),
        fetchAllRows("series_seasons", "id, series_id, phase"),
        fetchAllRows("series_episodes", "id, season_id"),
        fetchAllRows("episode_ratings", "episode_id, user_id, score"),
        fetchAllRows("season_user_ratings", "season_id, user_id, manual_score, adjustment")
      ]);

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
          const serieSeasons = (seasons || []).filter((season) => season.series_id === serie.id);
          const mcuPhases = Array.from(
            new Set(
              serieSeasons
                .map((season) => String(season.phase || "").trim())
                .filter(Boolean)
            )
          );
          return {
            ...serie,
            average: averageData.average,
            rating_count: averageData.count,
            mcuPhases
          };
        });

      state.listSeriesRows = rows;
      setupSeriesListFilters();
      renderSeriesListWithFilters();
      return;
    }

    document.querySelector("#series-list-section").style.display = "none";
    document.querySelector("#series-detail-section").style.display = "block";
    if (pageTitleEl) pageTitleEl.style.display = "none";
    const subtitleEl = document.querySelector("#series-subtitle");
    const subtitleNoteEl = document.querySelector("#series-subtitle-note");
    if (subtitleEl) {
      subtitleEl.textContent = "Pour les s\u00E9ries, la note effective vient de ta note manuelle, ou de la moyenne de tes \u00E9pisodes (plus ajusteur) uniquement quand tous les \u00E9pisodes de la saison sont not\u00E9s.";
    }
    if (subtitleNoteEl) {
      subtitleNoteEl.textContent = "Tant qu'une saison n'est pas compl\u00E8te, la moyenne partielle reste visible dans \"Moyenne de tes \u00E9pisodes\" mais n'est pas comptabilis\u00E9e comme note effective.";
    }

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

