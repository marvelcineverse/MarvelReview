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
  seasonUserRatings: []
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function canRateSeason() {
  return isReleasedOnOrBeforeToday(state.season?.start_date || null);
}

function applySeasonAvailability() {
  const canRate = canRateSeason();
  const messageEl = document.querySelector("#season-rating-unavailable-message");
  const form = document.querySelector("#season-rating-form");
  const message = "Cette saison n'est pas encore sortie (ou n'a pas de date de debut). La notation est desactivee.";

  if (messageEl) {
    messageEl.textContent = canRate ? "" : message;
    messageEl.style.display = canRate ? "none" : "block";
  }

  if (!form) return;
  const controls = form.querySelectorAll("input, textarea, button");
  for (const control of controls) {
    control.disabled = !canRate;
  }
}

function renderSeasonDetails() {
  const detailsEl = document.querySelector("#season-details");
  const seasonName = state.season?.name || `Saison ${state.season?.season_number || "-"}`;
  detailsEl.innerHTML = `
    <article class="card">
      <h1>${escapeHTML(seasonName)}</h1>
      <p>
        Serie: <a href="/series.html?id=${state.series?.id || ""}" class="film-link">${escapeHTML(state.series?.title || "-")}</a>
      </p>
      <p>Phase: ${escapeHTML(state.season?.phase || "-")} | Debut: ${formatDate(state.season?.start_date)} | Fin: ${formatDate(state.season?.end_date)}</p>
    </article>
  `;
}

function computeSeasonAverages() {
  const episodeIds = new Set((state.episodes || []).map((episode) => episode.id));
  const perUserEpisode = new Map();

  for (const rating of state.episodeRatings || []) {
    if (!episodeIds.has(rating.episode_id)) continue;
    const current = perUserEpisode.get(rating.user_id) || { total: 0, count: 0 };
    current.total += Number(rating.score || 0);
    current.count += 1;
    perUserEpisode.set(rating.user_id, current);
  }

  const perUser = new Map();
  for (const [userId, values] of perUserEpisode.entries()) {
    perUser.set(userId, {
      episodeAverage: values.count ? values.total / values.count : null,
      manualScore: null,
      adjustment: 0
    });
  }

  for (const row of state.seasonUserRatings || []) {
    const existing = perUser.get(row.user_id) || { episodeAverage: null, manualScore: null, adjustment: 0 };
    existing.manualScore = row.manual_score === null ? null : Number(row.manual_score);
    existing.adjustment = Number(row.adjustment || 0);
    perUser.set(row.user_id, existing);
  }

  const effectiveScores = [];
  for (const values of perUser.values()) {
    const effective = values.manualScore !== null
      ? clamp(values.manualScore, 0, 10)
      : (Number.isFinite(values.episodeAverage) ? clamp(values.episodeAverage + values.adjustment, 0, 10) : null);
    if (Number.isFinite(effective)) effectiveScores.push(effective);
  }

  const globalAverage = effectiveScores.length
    ? effectiveScores.reduce((sum, score) => sum + score, 0) / effectiveScores.length
    : null;

  const currentUserValues = perUser.get(state.currentUserId) || { episodeAverage: null, manualScore: null, adjustment: 0 };
  const myEffective = currentUserValues.manualScore !== null
    ? clamp(currentUserValues.manualScore, 0, 10)
    : (Number.isFinite(currentUserValues.episodeAverage) ? clamp(currentUserValues.episodeAverage + currentUserValues.adjustment, 0, 10) : null);

  return {
    globalAverage,
    globalCount: effectiveScores.length,
    myEffective
  };
}

function renderSeasonAverage() {
  const averageEl = document.querySelector("#season-average");
  const { globalAverage, globalCount, myEffective } = computeSeasonAverages();

  const globalHtml = globalAverage === null
    ? `<span class="score-badge stade-neutre">Pas encore de note</span>`
    : `<span class="score-badge ${getScoreClass(globalAverage)}">${formatScore(globalAverage, 2, 2)} / 10</span>`;

  const myHtml = myEffective === null
    ? `<span class="score-badge stade-neutre">-</span>`
    : `<span class="score-badge ${getScoreClass(myEffective)}">${formatScore(myEffective, 2, 2)} / 10</span>`;

  averageEl.innerHTML = `
    ${globalHtml}
    <span>${globalCount} note(s)</span>
    <span>Ta note effective: ${myHtml}</span>
  `;
}

function renderEpisodes() {
  const body = document.querySelector("#season-episodes-body");
  if (!state.episodes.length) {
    body.innerHTML = `<tr><td colspan="3">Aucun episode pour cette saison.</td></tr>`;
    return;
  }

  body.innerHTML = state.episodes
    .sort((a, b) => a.episode_number - b.episode_number)
    .map((episode) => `
      <tr>
        <td>${episode.episode_number}</td>
        <td><a href="/episode.html?id=${episode.id}" class="film-link">${escapeHTML(episode.title)}</a></td>
        <td>${formatDate(episode.air_date)}</td>
      </tr>
    `)
    .join("");
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

function renderSeasonReviews(mediaByUserId = new Map()) {
  const listEl = document.querySelector("#season-reviews-list");
  const rows = (state.seasonUserRatings || []).filter((row) => row.review && row.review.trim());

  if (!rows.length) {
    listEl.innerHTML = "<p>Aucune critique pour cette saison.</p>";
    return;
  }

  listEl.innerHTML = rows
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((row) => {
      const profile = row.profiles || {};
      const mediaNames = mediaByUserId.get(row.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";
      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(profile.username || "Utilisateur")}</strong>
            <span>${escapeHTML(mediaLabel)}</span>
          </div>
          <p>${escapeHTML(row.review || "(Pas de commentaire)")}</p>
          <small>${formatDate(row.created_at)}</small>
        </article>
      `;
    })
    .join("");
}

function fillCurrentUserSeasonRating() {
  const scoreInput = document.querySelector("#season-score");
  const reviewInput = document.querySelector("#season-review");
  const deleteButton = document.querySelector("#delete-season-rating-button");
  const row = (state.seasonUserRatings || []).find((item) => item.user_id === state.currentUserId);

  scoreInput.value = row?.manual_score === null || row?.manual_score === undefined ? "" : String(row.manual_score);
  reviewInput.value = row?.review || "";
  deleteButton.style.display = row?.manual_score !== null || (row?.review && row.review.trim()) ? "inline-flex" : "none";
}

async function loadSeasonPage() {
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

  const [
    { data: series, error: seriesError },
    { data: episodes, error: episodesError },
    { data: episodeRatings, error: episodeRatingsError },
    { data: seasonRows, error: seasonRowsError }
  ] = await Promise.all([
    supabase
      .from("series")
      .select("id, title")
      .eq("id", season.series_id)
      .single(),
    supabase
      .from("series_episodes")
      .select("id, season_id, episode_number, title, air_date")
      .eq("season_id", seasonId),
    supabase
      .from("episode_ratings")
      .select("episode_id, user_id, score"),
    supabase
      .from("season_user_ratings")
      .select("id, season_id, user_id, manual_score, adjustment, review, created_at, profiles(username)")
      .eq("season_id", seasonId)
  ]);

  if (seriesError) throw seriesError;
  if (episodesError) throw episodesError;
  if (episodeRatingsError) throw episodeRatingsError;
  if (seasonRowsError) throw seasonRowsError;

  const episodeIds = new Set((episodes || []).map((episode) => episode.id));

  state.season = season;
  state.series = series;
  state.episodes = episodes || [];
  state.episodeRatings = (episodeRatings || []).filter((row) => episodeIds.has(row.episode_id));
  state.seasonUserRatings = seasonRows || [];

  renderSeasonDetails();
  applySeasonAvailability();
  renderSeasonAverage();
  fillCurrentUserSeasonRating();
  renderEpisodes();

  const userIds = [...new Set(state.seasonUserRatings.map((row) => row.user_id))];
  const mediaByUserId = await loadMembershipMapForUsers(userIds);
  renderSeasonReviews(mediaByUserId);
}

async function saveSeasonRatingAndReview(event) {
  event.preventDefault();
  const session = await requireAuth("/login.html");
  if (!session) return;

  if (!canRateSeason()) {
    setMessage("#season-form-message", "Impossible de noter/commenter une saison non sortie ou sans date de debut.", true);
    return;
  }

  const scoreRaw = document.querySelector("#season-score").value.trim();
  const reviewValue = document.querySelector("#season-review").value.trim();
  const manualScore = scoreRaw ? Number(scoreRaw.replace(",", ".")) : null;

  if (manualScore !== null && (!Number.isFinite(manualScore) || manualScore < 0 || manualScore > 10 || !isQuarterStep(manualScore))) {
    setMessage("#season-form-message", "La note doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const existing = state.seasonUserRatings.find((row) => row.user_id === session.user.id);
  const adjustment = manualScore === null ? Number(existing?.adjustment || 0) : 0;

  if (manualScore === null && !reviewValue && adjustment === 0) {
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
          manual_score: manualScore,
          adjustment,
          review: reviewValue || null
        },
        { onConflict: "user_id,season_id" }
      );
    if (error) throw error;
  }

  setMessage("#season-form-message", "Note/critique enregistree.");
  await loadSeasonPage();
}

async function deleteSeasonRatingAndReview() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const existing = state.seasonUserRatings.find((row) => row.user_id === session.user.id);
  if (!existing) return;

  if (Number(existing.adjustment || 0) === 0) {
    const { error } = await supabase
      .from("season_user_ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("season_user_ratings")
      .update({ manual_score: null, review: null })
      .eq("user_id", session.user.id)
      .eq("season_id", state.season.id);
    if (error) throw error;
  }

  setMessage("#season-form-message", "Note/critique supprimee.");
  await loadSeasonPage();
}

document.querySelector("#season-rating-form")?.addEventListener("submit", async (event) => {
  try {
    await saveSeasonRatingAndReview(event);
  } catch (error) {
    setMessage("#season-form-message", error.message || "Enregistrement impossible.", true);
  }
});

document.querySelector("#delete-season-rating-button")?.addEventListener("click", async () => {
  try {
    await deleteSeasonRatingAndReview();
  } catch (error) {
    setMessage("#season-form-message", error.message || "Suppression impossible.", true);
  }
});

loadSeasonPage().catch((error) => {
  setMessage("#page-message", error.message || "Erreur de chargement de la saison.", true);
});
