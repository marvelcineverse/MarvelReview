import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  formatDate,
  formatScore,
  getScoreClass,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";
import { getSession, requireAuth } from "./auth.js";

const state = {
  currentUserId: null,
  episode: null,
  season: null,
  series: null,
  ratings: []
};
const SUPABASE_PAGE_SIZE = 1000;
const IN_FILTER_CHUNK_SIZE = 200;

function getEpisodeRefFromURL() {
  const params = new URLSearchParams(window.location.search);
  const id = (params.get("id") || "").trim();
  const slug = (params.get("slug") || "").trim();
  return {
    id: id || null,
    slug: slug || null
  };
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

function canRateEpisode() {
  return isReleasedOnOrBeforeToday(state.episode?.air_date || null);
}

function applyEpisodeAuthVisibility() {
  const ratingSection = document.querySelector("#episode-rating-section");
  if (ratingSection) {
    ratingSection.style.display = state.currentUserId ? "" : "none";
  }

  if (!state.currentUserId) {
    setMessage("#episode-form-message", "");
  }
}

function applyEpisodeAvailability() {
  const canManageRating = Boolean(state.currentUserId);
  const canRate = canRateEpisode();
  const messageEl = document.querySelector("#episode-rating-unavailable-message");
  const form = document.querySelector("#episode-rating-form");
  const message = "Cet episode n'est pas encore diffuse (ou n'a pas de date de diffusion). La notation est desactivee.";

  if (messageEl) {
    const shouldShow = canManageRating && !canRate;
    messageEl.textContent = shouldShow ? message : "";
    messageEl.style.display = shouldShow ? "block" : "none";
  }

  if (!form) return;
  const controls = form.querySelectorAll("input, textarea, button");
  for (const control of controls) {
    control.disabled = !canRate || !canManageRating;
  }
}

function renderEpisodeDetails() {
  const detailsEl = document.querySelector("#episode-details");
  if (!detailsEl) return;

  const seasonLabel = state.season?.name || `Saison ${state.season?.season_number || "?"}`;
  const slugLabel = state.episode?.slug ? escapeHTML(state.episode.slug) : "-";
  detailsEl.innerHTML = `
    <h1>Ep. ${state.episode?.episode_number || "-"} - ${escapeHTML(state.episode?.title || "Episode")}</h1>
    <p>
      S&eacute;rie: <a href="/series.html?id=${state.series?.id || ""}" class="film-link">${escapeHTML(state.series?.title || "-")}</a>
      | Saison: <a href="/season.html?id=${state.season?.id || ""}" class="film-link">${escapeHTML(seasonLabel)}</a>
    </p>
    <p>Date de diffusion: ${formatDate(state.episode?.air_date)}</p>
    <p class="film-meta">Slug: <code>${slugLabel}</code></p>
  `;
}

function renderAverage() {
  const averageEl = document.querySelector("#episode-average");
  if (!state.ratings.length) {
    averageEl.innerHTML = `<span class="score-badge stade-neutre">Pas encore de note</span>`;
    return;
  }

  const total = state.ratings.reduce((sum, rating) => sum + Number(rating.score || 0), 0);
  const average = total / state.ratings.length;
  averageEl.innerHTML = `
    <span class="score-badge ${getScoreClass(average)}">${formatScore(average, 2, 2)} / 10</span>
    <span>${state.ratings.length} note(s)</span>
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

function renderRatings(mediaByUserId = new Map()) {
  const listEl = document.querySelector("#episode-reviews-list");
  if (!state.ratings.length) {
    listEl.innerHTML = "<p>Aucune critique pour cet episode.</p>";
    return;
  }

  listEl.innerHTML = state.ratings
    .map((rating) => {
      const mediaNames = mediaByUserId.get(rating.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";
      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(rating.profiles?.username || "Utilisateur")}</strong>
            <span>${escapeHTML(mediaLabel)}</span>
            <span class="score-badge ${getScoreClass(rating.score)}">${formatScore(rating.score)} / 10</span>
          </div>
          <p>${escapeHTML(rating.review || "(Pas de commentaire)")}</p>
          <small>${formatDate(rating.created_at)}</small>
        </article>
      `;
    })
    .join("");
}

function fillCurrentUserRating() {
  const scoreInput = document.querySelector("#episode-score");
  const reviewInput = document.querySelector("#episode-review");
  const deleteBtn = document.querySelector("#delete-episode-rating-button");
  if (!scoreInput || !reviewInput || !deleteBtn) return;

  const row = state.ratings.find((rating) => rating.user_id === state.currentUserId);

  scoreInput.value = row ? String(row.score) : "";
  reviewInput.value = row?.review || "";
  deleteBtn.style.display = row ? "inline-flex" : "none";
}

async function loadEpisodePage() {
  const { id: episodeId, slug: episodeSlug } = getEpisodeRefFromURL();
  if (!episodeId && !episodeSlug) {
    setMessage("#page-message", "Episode introuvable: parametre id ou slug manquant.", true);
    return;
  }

  const session = await getSession();
  state.currentUserId = session?.user?.id || null;

  let episodeQuery = supabase
    .from("series_episodes")
    .select("id, season_id, episode_number, title, air_date, slug");

  episodeQuery = episodeId ? episodeQuery.eq("id", episodeId) : episodeQuery.eq("slug", episodeSlug);

  const { data: episode, error: episodeError } = await episodeQuery.single();
  if (episodeError) throw episodeError;

  const [
    { data: season, error: seasonError },
    ratingsRaw
  ] = await Promise.all([
    supabase
      .from("series_seasons")
      .select("id, series_id, name, season_number")
      .eq("id", episode.season_id)
      .single(),
    fetchPagedRows((from, to) =>
      supabase
        .from("episode_ratings")
        .select("id, episode_id, user_id, score, review, created_at, profiles(username)")
        .eq("episode_id", episode.id)
        .order("created_at", { ascending: false })
        .range(from, to)
    )
  ]);

  if (seasonError) throw seasonError;

  const { data: series, error: seriesError } = await supabase
    .from("series")
    .select("id, title")
    .eq("id", season.series_id)
    .single();
  if (seriesError) throw seriesError;

  state.episode = episode;
  state.season = season;
  state.series = series;
  state.ratings = ratingsRaw || [];

  applyEpisodeAuthVisibility();
  renderEpisodeDetails();
  applyEpisodeAvailability();
  renderAverage();
  fillCurrentUserRating();

  const userIds = [...new Set(state.ratings.map((row) => row.user_id))];
  const mediaByUserId = await loadMembershipMapForUsers(userIds);
  renderRatings(mediaByUserId);
}

async function saveEpisodeRatingAndReview(event) {
  event.preventDefault();
  const session = await requireAuth("/login.html");
  if (!session) return;

  if (!canRateEpisode()) {
    setMessage("#episode-form-message", "Impossible de noter/commenter un episode non diffuse ou sans date.", true);
    return;
  }

  const scoreRaw = document.querySelector("#episode-score").value.trim();
  const reviewValue = document.querySelector("#episode-review").value.trim();
  const scoreValue = Number(scoreRaw.replace(",", "."));

  if (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 10 || !isQuarterStep(scoreValue)) {
    setMessage("#episode-form-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const { error } = await supabase
    .from("episode_ratings")
    .upsert(
      {
        user_id: session.user.id,
        episode_id: state.episode.id,
        score: scoreValue,
        review: reviewValue || null
      },
      { onConflict: "user_id,episode_id" }
    );
  if (error) throw error;

  setMessage("#episode-form-message", "Note/critique enregistree.");
  await loadEpisodePage();
}

async function deleteEpisodeRatingAndReview() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const { error } = await supabase
    .from("episode_ratings")
    .delete()
    .eq("user_id", session.user.id)
    .eq("episode_id", state.episode.id);
  if (error) throw error;

  setMessage("#episode-form-message", "Note/critique supprimee.");
  await loadEpisodePage();
}

document.querySelector("#episode-rating-form")?.addEventListener("submit", async (event) => {
  try {
    await saveEpisodeRatingAndReview(event);
  } catch (error) {
    setMessage("#episode-form-message", error.message || "Enregistrement impossible.", true);
  }
});

document.querySelector("#delete-episode-rating-button")?.addEventListener("click", async () => {
  try {
    await deleteEpisodeRatingAndReview();
  } catch (error) {
    setMessage("#episode-form-message", error.message || "Suppression impossible.", true);
  }
});

loadEpisodePage().catch((error) => {
  setMessage("#page-message", error.message || "Erreur de chargement de l'episode.", true);
});
