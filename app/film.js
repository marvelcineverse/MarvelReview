import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  formatDate,
  formatScore,
  getFilmIdFromURL,
  getScoreClass,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";
import { getCurrentProfile, requireAuth, getSession } from "./auth.js";

let currentProfile = null;
let currentFilm = null;

function canRateCurrentFilm() {
  return isReleasedOnOrBeforeToday(currentFilm?.release_date || null);
}

function applyRatingAvailability() {
  const canRate = canRateCurrentFilm();
  const messageEl = document.querySelector("#rating-unavailable-message");
  const ratingForm = document.querySelector("#rating-form");
  const adminForm = document.querySelector("#admin-rating-form");

  const message = "Ce film n'est pas encore sorti (ou n'a pas de date de sortie). La notation est desactivee.";
  if (messageEl) {
    messageEl.textContent = canRate ? "" : message;
    messageEl.style.display = canRate ? "none" : "block";
  }

  for (const form of [ratingForm, adminForm]) {
    if (!form) continue;
    const controls = form.querySelectorAll("input, textarea, select, button");
    for (const control of controls) {
      control.disabled = !canRate;
    }
  }
}

function renderFilmDetails(film) {
  const container = document.querySelector("#film-details");
  container.innerHTML = `
    <article class="card film-hero">
      <div class="film-hero-content">
        <h1>${escapeHTML(film.title)}</h1>
        <p>Date de sortie: ${formatDate(film.release_date)}</p>
        <p>${escapeHTML(film.synopsis || "Aucun synopsis.")}</p>
      </div>
      <img class="film-hero-poster" src="${escapeHTML(film.poster_url || "https://via.placeholder.com/260x390?text=Marvel")}" alt="Affiche de ${escapeHTML(film.title)}" />
    </article>
  `;
}

function renderAverage(ratings) {
  const avgEl = document.querySelector("#average-rating");
  if (!ratings.length) {
    avgEl.innerHTML = `<span class="score-badge stade-neutre">Pas encore de note</span>`;
    return;
  }

  const total = ratings.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const average = total / ratings.length;

  avgEl.innerHTML = `
    <span class="score-badge ${getScoreClass(average)}">${formatScore(average, 2, 2)} / 10</span>
    <span>${ratings.length} note(s)</span>
  `;
}

function renderRatings(ratings, mediaByUserId) {
  const listEl = document.querySelector("#ratings-list");

  if (!ratings.length) {
    listEl.innerHTML = "<p>Aucune critique pour ce film.</p>";
    return;
  }

  listEl.innerHTML = ratings
    .map((rating) => {
      const profile = rating.profiles || {};
      const mediaNames = mediaByUserId.get(rating.user_id) || [];
      const mediaLabel = mediaNames.length ? mediaNames.join(", ") : "Independant";

      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(profile.username || "Utilisateur")}</strong>
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

async function fillExistingUserRating(filmId, userId, scoreInputId, reviewInputId) {
  const { data, error } = await supabase
    .from("ratings")
    .select("score, review")
    .eq("film_id", filmId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  const scoreInput = document.querySelector(`#${scoreInputId}`);
  const reviewInput = document.querySelector(`#${reviewInputId}`);
  const deleteButton = scoreInputId === "score"
    ? document.querySelector("#delete-rating-button")
    : null;

  if (!data) {
    scoreInput.value = "";
    reviewInput.value = "";
    if (deleteButton) deleteButton.style.display = "none";
    return;
  }

  scoreInput.value = String(data.score);
  reviewInput.value = data.review || "";
  if (deleteButton) deleteButton.style.display = "inline-block";
}

async function loadAdminUsersForFilm(filmId) {
  const selectEl = document.querySelector("#admin-target-user");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .order("username", { ascending: true });

  if (error) throw error;

  selectEl.innerHTML = (data || [])
    .map((user) => `<option value="${user.id}">${escapeHTML(user.username)}</option>`)
    .join("");

  selectEl.addEventListener("change", async () => {
    await fillExistingUserRating(filmId, selectEl.value, "admin-score", "admin-review");
  });

  if (selectEl.value) {
    await fillExistingUserRating(filmId, selectEl.value, "admin-score", "admin-review");
  }
}

async function loadFilmPage() {
  const filmId = getFilmIdFromURL();
  if (!filmId) {
    setMessage("#page-message", "Film introuvable: parametre id manquant.", true);
    return;
  }

  try {
    const { data: film, error: filmError } = await supabase
      .from("films")
      .select("id, title, slug, release_date, franchise, phase, type, poster_url, synopsis")
      .eq("id", filmId)
      .single();
    if (filmError) throw filmError;

    currentFilm = film;
    renderFilmDetails(film);
    applyRatingAvailability();

    const { data: ratings, error: ratingsError } = await supabase
      .from("ratings")
      .select("id, user_id, score, review, created_at, profiles(username)")
      .eq("film_id", filmId)
      .order("created_at", { ascending: false });
    if (ratingsError) throw ratingsError;

    const userIds = [...new Set((ratings || []).map((row) => row.user_id))];
    const mediaByUserId = await loadMembershipMapForUsers(userIds);

    renderAverage(ratings || []);
    renderRatings(ratings || [], mediaByUserId);

    const session = await getSession();
    if (session) {
      currentProfile = await getCurrentProfile();
      await fillExistingUserRating(filmId, session.user.id, "score", "review");

      if (currentProfile?.is_admin) {
        document.querySelector("#admin-film-editor").style.display = "block";
        document.querySelector("#admin-rating-editor").style.display = "block";
        renderAdminFilmEditor();
        await loadAdminUsersForFilm(filmId);
      }
    }
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du film.", true);
  }
}

function renderAdminFilmEditor() {
  if (!currentFilm) return;

  document.querySelector("#film-title").value = currentFilm.title || "";
  document.querySelector("#film-slug").value = currentFilm.slug || "";
  document.querySelector("#film-release-date").value = currentFilm.release_date || "";
  document.querySelector("#film-franchise").value = currentFilm.franchise || "";
  document.querySelector("#film-phase").value = currentFilm.phase || "";
  document.querySelector("#film-type").value = currentFilm.type || "";
  document.querySelector("#film-poster-url").value = currentFilm.poster_url || "";
  document.querySelector("#film-synopsis").value = currentFilm.synopsis || "";
}

async function handleRatingSubmit(event) {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const filmId = getFilmIdFromURL();
  const scoreValue = Number(document.querySelector("#score").value);
  const reviewValue = document.querySelector("#review").value.trim();

  if (!canRateCurrentFilm()) {
    setMessage("#form-message", "Impossible de noter un film non sorti ou sans date de sortie.", true);
    return;
  }

  if (!isQuarterStep(scoreValue) || scoreValue < 0 || scoreValue > 10) {
    setMessage("#form-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  try {
    const payload = {
      user_id: session.user.id,
      film_id: filmId,
      score: scoreValue,
      review: reviewValue || null
    };

    const { error } = await supabase
      .from("ratings")
      .upsert(payload, { onConflict: "user_id,film_id" });
    if (error) throw error;

    setMessage("#form-message", "Note enregistree.");
    await loadFilmPage();
  } catch (error) {
    setMessage("#form-message", error.message || "Impossible d'enregistrer la note.", true);
  }
}

async function handleAdminRatingSubmit(event) {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;
  if (!currentProfile?.is_admin) return;

  const filmId = getFilmIdFromURL();
  const targetUserId = document.querySelector("#admin-target-user").value;
  const scoreValue = Number(document.querySelector("#admin-score").value);
  const reviewValue = document.querySelector("#admin-review").value.trim();

  if (!canRateCurrentFilm()) {
    setMessage("#admin-rating-message", "Impossible de noter un film non sorti ou sans date de sortie.", true);
    return;
  }

  if (!targetUserId) {
    setMessage("#admin-rating-message", "Selectionne un utilisateur cible.", true);
    return;
  }

  if (!isQuarterStep(scoreValue) || scoreValue < 0 || scoreValue > 10) {
    setMessage("#admin-rating-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  try {
    const { error } = await supabase.rpc("admin_upsert_rating_for_user", {
      p_user_id: targetUserId,
      p_film_id: filmId,
      p_score: scoreValue,
      p_review: reviewValue || null
    });

    if (error) throw error;

    setMessage("#admin-rating-message", "Note attribuee / modifiee.");
    await loadFilmPage();
  } catch (error) {
    setMessage("#admin-rating-message", error.message || "Attribution impossible.", true);
  }
}

async function handleAdminFilmSave(event) {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;
  if (!currentProfile?.is_admin) return;

  const payload = {
    id: currentFilm?.id,
    title: document.querySelector("#film-title").value.trim(),
    slug: document.querySelector("#film-slug").value.trim() || null,
    release_date: document.querySelector("#film-release-date").value || null,
    franchise: document.querySelector("#film-franchise").value.trim() || "MCU",
    phase: document.querySelector("#film-phase").value.trim() || null,
    type: document.querySelector("#film-type").value.trim() || "Film",
    poster_url: document.querySelector("#film-poster-url").value.trim() || null,
    synopsis: document.querySelector("#film-synopsis").value.trim() || null
  };

  try {
    const { error } = await supabase.from("films").upsert(payload);
    if (error) throw error;

    setMessage("#admin-film-message", "Film mis a jour.");
    await loadFilmPage();
  } catch (error) {
    setMessage("#admin-film-message", error.message || "Mise a jour film impossible.", true);
  }
}

async function handleDeleteRating() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const filmId = getFilmIdFromURL();
  if (!filmId) return;

  try {
    const { error } = await supabase
      .from("ratings")
      .delete()
      .eq("user_id", session.user.id)
      .eq("film_id", filmId);

    if (error) throw error;

    setMessage("#form-message", "Note supprimee.");
    await loadFilmPage();
  } catch (error) {
    setMessage("#form-message", error.message || "Suppression impossible.", true);
  }
}

document.querySelector("#rating-form")?.addEventListener("submit", handleRatingSubmit);
document.querySelector("#delete-rating-button")?.addEventListener("click", handleDeleteRating);
document.querySelector("#admin-rating-form")?.addEventListener("submit", handleAdminRatingSubmit);
document.querySelector("#admin-film-form")?.addEventListener("submit", handleAdminFilmSave);
loadFilmPage();
