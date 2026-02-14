import { supabase } from "../supabaseClient.js";
import {
  escapeHTML,
  formatDate,
  formatScore,
  getFilmIdFromURL,
  getScoreClass,
  isQuarterStep,
  setMessage
} from "./utils.js";
import { getCurrentProfile, requireAuth, getSession } from "./auth.js";

let currentProfile = null;
let currentFilm = null;

function getActingUserId(session) {
  if (!currentProfile?.is_admin) return session.user.id;

  const controlledUserId = localStorage.getItem("admin_controlled_user_id");
  return controlledUserId || session.user.id;
}

function renderControlStatus(session) {
  const controlStatusEl = document.querySelector("#control-status");
  if (!controlStatusEl) return;

  if (!currentProfile?.is_admin) {
    controlStatusEl.style.display = "none";
    return;
  }

  const controlledUserId = localStorage.getItem("admin_controlled_user_id");
  if (controlledUserId && controlledUserId !== session.user.id) {
    controlStatusEl.style.display = "block";
    controlStatusEl.textContent = `Mode admin: controle du compte ${controlledUserId}`;
  } else {
    controlStatusEl.style.display = "block";
    controlStatusEl.textContent = "Mode admin: vous notez avec votre propre compte.";
  }
}

function renderAdminFilmEditor() {
  const sectionEl = document.querySelector("#admin-film-editor");
  if (!sectionEl) return;

  if (!currentProfile?.is_admin || !currentFilm) {
    sectionEl.style.display = "none";
    return;
  }

  sectionEl.style.display = "block";

  document.querySelector("#film-title").value = currentFilm.title || "";
  document.querySelector("#film-slug").value = currentFilm.slug || "";
  document.querySelector("#film-release-date").value = currentFilm.release_date || "";
  document.querySelector("#film-franchise").value = currentFilm.franchise || "";
  document.querySelector("#film-phase").value = currentFilm.phase || "";
  document.querySelector("#film-type").value = currentFilm.type || "";
  document.querySelector("#film-poster-url").value = currentFilm.poster_url || "";
  document.querySelector("#film-synopsis").value = currentFilm.synopsis || "";
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

function getMediaDisplayName(rating) {
  const memberships = rating.profiles?.profile_media_memberships || [];
  const approved = memberships.find((item) => item.status === "approved");
  return approved?.media_outlets?.name || "Independant";
}

function renderRatings(ratings) {
  const listEl = document.querySelector("#ratings-list");

  if (!ratings.length) {
    listEl.innerHTML = "<p>Aucune critique pour ce film.</p>";
    return;
  }

  listEl.innerHTML = ratings
    .map((rating) => {
      const profile = rating.profiles || {};
      const mediaName = getMediaDisplayName(rating);
      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(profile.username || "Utilisateur")}</strong>
            <span>${escapeHTML(mediaName)}</span>
            <span class="score-badge ${getScoreClass(rating.score)}">${formatScore(rating.score)} / 10</span>
          </div>
          <p>${escapeHTML(rating.review || "(Pas de commentaire)")}</p>
          <small>${formatDate(rating.created_at)}</small>
        </article>
      `;
    })
    .join("");
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

    const { data: ratings, error: ratingsError } = await supabase
      .from("ratings")
      .select("id, user_id, score, review, created_at, profiles(username, profile_media_memberships(status, media_outlets(name)))")
      .eq("film_id", filmId)
      .order("created_at", { ascending: false });
    if (ratingsError) throw ratingsError;

    renderAverage(ratings || []);
    renderRatings(ratings || []);

    const session = await getSession();
    if (session) {
      currentProfile = await getCurrentProfile();
      renderControlStatus(session);
      renderAdminFilmEditor();
      await fillExistingUserRating(filmId, getActingUserId(session));
    }
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du film.", true);
  }
}

async function fillExistingUserRating(filmId, userId) {
  const { data, error } = await supabase
    .from("ratings")
    .select("score, review")
    .eq("film_id", filmId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return;

  document.querySelector("#score").value = String(data.score);
  document.querySelector("#review").value = data.review || "";
}

async function handleRatingSubmit(event) {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  if (!currentProfile) currentProfile = await getCurrentProfile();

  const filmId = getFilmIdFromURL();
  const scoreValue = Number(document.querySelector("#score").value);
  const reviewValue = document.querySelector("#review").value.trim();

  if (!isQuarterStep(scoreValue) || scoreValue < 0 || scoreValue > 10) {
    setMessage("#form-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  try {
    const targetUserId = getActingUserId(session);

    if (currentProfile?.is_admin && targetUserId !== session.user.id) {
      const { error } = await supabase.rpc("admin_upsert_rating_for_user", {
        p_user_id: targetUserId,
        p_film_id: filmId,
        p_score: scoreValue,
        p_review: reviewValue || null
      });
      if (error) throw error;
    } else {
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
    }

    setMessage("#form-message", "Note enregistree.");
    await loadFilmPage();
  } catch (error) {
    setMessage("#form-message", error.message || "Impossible d'enregistrer la note.", true);
  }
}

async function handleAdminFilmSave(event) {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  if (!currentProfile) currentProfile = await getCurrentProfile();
  if (!currentProfile?.is_admin) {
    setMessage("#admin-film-message", "Acces reserve admin.", true);
    return;
  }

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

document.querySelector("#rating-form")?.addEventListener("submit", handleRatingSubmit);
document.querySelector("#admin-film-form")?.addEventListener("submit", handleAdminFilmSave);
loadFilmPage();
