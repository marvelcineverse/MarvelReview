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
import { requireAuth, getSession } from "./auth.js";

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

function renderRatings(ratings) {
  const listEl = document.querySelector("#ratings-list");

  if (!ratings.length) {
    listEl.innerHTML = "<p>Aucune critique pour ce film.</p>";
    return;
  }

  listEl.innerHTML = ratings
    .map((rating) => {
      const profile = rating.profiles || {};
      return `
        <article class="card review-card">
          <div class="review-head">
            <strong>${escapeHTML(profile.username || "Utilisateur")}</strong>
            <span>${escapeHTML(profile.media || "Media inconnu")}</span>
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
      .select("id, title, release_date, poster_url, synopsis")
      .eq("id", filmId)
      .single();
    if (filmError) throw filmError;

    renderFilmDetails(film);

    const { data: ratings, error: ratingsError } = await supabase
      .from("ratings")
      .select("id, user_id, score, review, created_at, profiles(username, media)")
      .eq("film_id", filmId)
      .order("created_at", { ascending: false });
    if (ratingsError) throw ratingsError;

    renderAverage(ratings || []);
    renderRatings(ratings || []);

    const session = await getSession();
    if (session) await fillExistingUserRating(filmId, session.user.id);
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

  const filmId = getFilmIdFromURL();
  const scoreValue = Number(document.querySelector("#score").value);
  const reviewValue = document.querySelector("#review").value.trim();

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

document.querySelector("#rating-form")?.addEventListener("submit", handleRatingSubmit);
loadFilmPage();
