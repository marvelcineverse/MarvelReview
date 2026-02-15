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
  seasonUserRatings: []
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getOpenSeasonIdsFromDOM() {
  return new Set(
    Array.from(document.querySelectorAll("details[data-season-id][open]"))
      .map((el) => el.dataset.seasonId)
      .filter(Boolean)
  );
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
    const baseScore = value.manualScore !== null ? value.manualScore : value.episodeAverage;
    if (!Number.isFinite(baseScore)) continue;
    const effective = clamp(baseScore + value.adjustment, 0, 10);
    effectiveScores.push(effective);
  }

  const siteAverage = effectiveScores.length
    ? effectiveScores.reduce((sum, score) => sum + score, 0) / effectiveScores.length
    : null;

  const user = perUser.get(state.currentUserId) || { episodeAverage: null, manualScore: null, adjustment: 0 };
  const userBase = user.manualScore !== null ? user.manualScore : user.episodeAverage;
  const userEffective = Number.isFinite(userBase) ? clamp(userBase + user.adjustment, 0, 10) : null;

  return {
    episodeCount: seasonEpisodes.length,
    userManualScore: user.manualScore,
    userAdjustment: user.adjustment,
    userEffective,
    siteAverage
  };
}

function computeSeriesWeightedAverage() {
  const totalSeasons = state.seasons.length;
  if (!totalSeasons) return { average: null, contributorCount: 0 };

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

      const base = manual !== null ? manual : episodeAverage;
      if (!Number.isFinite(base)) continue;
      const effective = clamp(base + adjustment, 0, 10);

      const current = userSeasonScores.get(userId) || [];
      current.push(effective);
      userSeasonScores.set(userId, current);
    }
  }

  const weightedScores = [];
  for (const seasonScores of userSeasonScores.values()) {
    if (!seasonScores.length) continue;
    const avg = seasonScores.reduce((sum, value) => sum + value, 0) / seasonScores.length;
    const coverage = seasonScores.length / totalSeasons;
    weightedScores.push(avg * coverage);
  }

  if (!weightedScores.length) return { average: null, contributorCount: 0 };

  return {
    average: weightedScores.reduce((sum, value) => sum + value, 0) / weightedScores.length,
    contributorCount: weightedScores.length
  };
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

function renderSeriesAverage() {
  const averageEl = document.querySelector("#series-average");
  const metrics = computeSeriesWeightedAverage();

  if (metrics.average === null) {
    averageEl.innerHTML = `<span class="score-badge stade-neutre">Pas encore de note</span>`;
    return;
  }

  averageEl.innerHTML = `
    <span class="score-badge ${getScoreClass(metrics.average)}">${formatScore(metrics.average, 2, 2)} / 10</span>
    <span>${metrics.contributorCount} profil(s) contributeur(s)</span>
  `;
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

      const seasonAverage = metrics.siteAverage === null
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
          <h3>${escapeHTML(season.name || `Saison ${season.season_number}`)}</h3>
          <p>Phase: ${escapeHTML(season.phase || "-")} | Debut: ${formatDate(season.start_date)} | Fin: ${formatDate(season.end_date)}</p>
          <p>Moyenne de la saison (site): ${seasonAverage}</p>

          <div class="inline-actions season-adjuster">
            <span>Ajusteur de moyenne</span>
            <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-down" data-season-id="${season.id}" aria-label="Diminuer l'ajusteur de saison">
              <i class="fa-solid fa-minus" aria-hidden="true"></i>
            </button>
            <strong data-field="season-adjustment-value">${adjustmentValue}</strong>
            <button type="button" class="icon-circle-btn neutral small" data-action="adjust-season-up" data-season-id="${season.id}" aria-label="Augmenter l'ajusteur de saison">
              <i class="fa-solid fa-plus" aria-hidden="true"></i>
            </button>
          </div>

          <p>Ta note effective de saison: ${userAverage}</p>
          <p class="film-meta">Base perso: ${metrics.userManualScore === null ? "Moyenne de tes episodes" : "Note de saison manuelle"} | Episodes: ${metrics.episodeCount}</p>

          <div class="season-controls">
            <p class="film-meta season-manual-help">Renseigner une note generale pour toute la saison (optionnel).</p>
            <div class="inline-actions inline-edit">
              <input data-field="season-manual-score" data-season-id="${season.id}" type="number" min="0" max="10" step="0.25" value="${manualValue}" placeholder="Note saison (optionnelle)" />
              <button type="button" class="icon-circle-btn save" data-action="save-season-manual" data-season-id="${season.id}" aria-label="Valider la note de saison">
                <i class="fa-solid fa-check" aria-hidden="true"></i>
              </button>
              ${metrics.userManualScore === null ? "" : `
                <button type="button" class="icon-circle-btn delete" data-action="delete-season-manual" data-season-id="${season.id}" aria-label="Supprimer la note manuelle de saison">
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

                    return `
                      <tr>
                        <td>${episode.episode_number}</td>
                        <td>${escapeHTML(episode.title)}</td>
                        <td>${formatDate(episode.air_date)}</td>
                        <td>${scoreBadge}</td>
                        <td>
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

  const [{ data: episodeRatings, error: episodeRatingsError }, { data: seasonUserRatings, error: seasonUserRatingsError }] = await Promise.all([
    episodeIds.length
      ? supabase
        .from("episode_ratings")
        .select("id, episode_id, user_id, score, review")
        .in("episode_id", episodeIds)
      : Promise.resolve({ data: [], error: null }),
    seasonIds.length
      ? supabase
        .from("season_user_ratings")
        .select("id, season_id, user_id, manual_score, adjustment")
        .in("season_id", seasonIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (episodeRatingsError) throw episodeRatingsError;
  if (seasonUserRatingsError) throw seasonUserRatingsError;

  state.episodeRatings = episodeRatings || [];
  state.seasonUserRatings = seasonUserRatings || [];
}

async function reloadSeriesDetails(seriesId) {
  await loadSeriesStructure(seriesId);
  await loadRatingsData();
  renderSeriesHeader();
  renderSeriesAverage();
  renderSeasons();
}

async function refreshRatingsOnly() {
  const openSeasonIds = getOpenSeasonIdsFromDOM();
  await loadRatingsData();
  renderSeriesAverage();
  renderSeasons(openSeasonIds);
}

async function saveEpisodeRating(episodeId) {
  const session = await requireAuth("/login.html");
  if (!session) return;

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

  const existing = getCurrentSeasonUserRow(seasonId);
  const adjustment = Number(existing?.adjustment || 0);

  const { error } = await supabase.from("season_user_ratings").upsert(
    {
      user_id: session.user.id,
      season_id: seasonId,
      manual_score: score,
      adjustment
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

  const existing = getCurrentSeasonUserRow(seasonId);
  const currentAdjustment = Number(existing?.adjustment || 0);
  const nextAdjustment = clamp(Math.round((currentAdjustment + delta) * 4) / 4, -2, 2);
  if (!isQuarterStep(nextAdjustment)) return;

  const payload = {
    user_id: session.user.id,
    season_id: seasonId,
    manual_score: existing?.manual_score ?? null,
    adjustment: nextAdjustment
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

function bindDetailEvents() {
  const detailRoot = document.querySelector("#series-detail-section");
  detailRoot.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const episodeId = button.dataset.episodeId;
    const seasonId = button.dataset.seasonId;

    try {
      if (action === "save-episode-rating" && episodeId) {
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
      } else {
        return;
      }

      setMessage("#page-message", "Sauvegarde reussie.");
      await refreshRatingsOnly();
    } catch (error) {
      setMessage("#page-message", error.message || "Operation impossible.", true);
    }
  });
}

async function initPage() {
  try {
    const session = await getSession();
    state.currentUserId = session?.user?.id || null;

    const seriesId = getSeriesIdFromURL();
    if (!seriesId) {
      const { data, error } = await supabase
        .from("series")
        .select("id, title, poster_url, start_date, end_date, franchise, type")
        .order("start_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      renderSeriesList(data || []);
      return;
    }

    document.querySelector("#series-list-section").style.display = "none";
    document.querySelector("#series-detail-section").style.display = "block";
    document.querySelector("#series-subtitle").textContent = "Saisons, episodes et notation.";

    await reloadSeriesDetails(seriesId);
    bindDetailEvents();
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement des series.", true);
  }
}

initPage();
