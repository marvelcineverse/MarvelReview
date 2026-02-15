import { supabase } from "../supabaseClient.js";
import { requireAuth } from "./auth.js";
import {
  escapeHTML,
  formatScore,
  getScoreClass,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";

let currentUserId = null;

async function loadMediaOutlets() {
  const selectEl = document.querySelector("#media_outlet_id");

  const { data, error } = await supabase
    .from("media_outlets")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;

  selectEl.innerHTML = [
    `<option value="">Aucun media</option>`,
    ...(data || []).map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`)
  ].join("");
}

async function loadMemberships(userId) {
  const statusEl = document.querySelector("#media-membership-status");
  const currentMediaEl = document.querySelector("#current-media");

  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, status, media_id, media_outlets(name)")
    .eq("profile_id", userId)
    .order("requested_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];

  if (!rows.length) {
    statusEl.textContent = "Aucune demande de rattachement.";
    currentMediaEl.textContent = "Independant";
    return;
  }

  const approved = rows
    .filter((row) => row.status === "approved")
    .map((row) => row.media_outlets?.name || "Media");

  currentMediaEl.textContent = approved.length ? approved.join(", ") : "Independant";

  statusEl.innerHTML = rows
    .map((row) => `- ${escapeHTML(row.media_outlets?.name || "Media")}: ${row.status}`)
    .join("<br>");
}

function renderAvatarPreview(url) {
  const preview = document.querySelector("#avatar-preview");
  if (!url) {
    preview.innerHTML = "<p>Pas d'avatar.</p>";
    return;
  }

  preview.innerHTML = `<img src="${escapeHTML(url)}" alt="Avatar" class="avatar" />`;
}

function renderPersonalRatings(rows) {
  const body = document.querySelector("#personal-ratings-body");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4">Aucun film trouvable a noter pour le moment.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((row, index) => {
      const rank = row.score === null ? "-" : String(index + 1);
      const scoreText = row.score === null ? "" : String(row.score);
      const badge = row.score === null
        ? `<span class="score-badge stade-neutre">Pas note</span>`
        : `<span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score)} / 10</span>`;

      return `
        <tr>
          <td>${rank}</td>
          <td><a href="/film.html?id=${row.film_id}" class="film-link">${escapeHTML(row.title)}</a></td>
          <td>${badge}</td>
          <td>
            <div class="inline-actions inline-edit">
              <input data-field="score" data-film-id="${row.film_id}" type="number" min="0" max="10" step="0.25" value="${scoreText}" placeholder="0 a 10" />
              <button type="button" class="ghost-button" data-action="save-rating" data-film-id="${row.film_id}">Valider</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadPersonalRatings(userId) {
  const [{ data: films, error: filmsError }, { data: ratings, error: ratingsError }] = await Promise.all([
    supabase
      .from("films")
      .select("id, title, release_date")
      .order("release_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("ratings")
      .select("film_id, score, review")
      .eq("user_id", userId)
  ]);

  if (filmsError) throw filmsError;
  if (ratingsError) throw ratingsError;

  const ratingByFilmId = new Map((ratings || []).map((row) => [row.film_id, row]));

  const merged = (films || [])
    .map((film) => {
      const rating = ratingByFilmId.get(film.id);
      return {
        film_id: film.id,
        title: film.title,
        release_date: film.release_date,
        score: rating ? Number(rating.score) : null,
        review: rating?.review || ""
      };
    })
    .filter((film) => isReleasedOnOrBeforeToday(film.release_date));

  merged.sort((a, b) => {
    const aRated = a.score !== null;
    const bRated = b.score !== null;
    if (aRated && bRated) return b.score - a.score || a.title.localeCompare(b.title, "fr");
    if (aRated) return -1;
    if (bRated) return 1;

    const aTs = a.release_date ? new Date(a.release_date).getTime() : Number.POSITIVE_INFINITY;
    const bTs = b.release_date ? new Date(b.release_date).getTime() : Number.POSITIVE_INFINITY;
    if (aTs !== bTs) return aTs - bTs;
    return a.title.localeCompare(b.title, "fr");
  });

  renderPersonalRatings(merged);
}

async function saveQuickRating(filmId) {
  if (!currentUserId) return;

  const { data: film, error: filmError } = await supabase
    .from("films")
    .select("release_date")
    .eq("id", filmId)
    .maybeSingle();

  if (filmError) throw filmError;
  if (!isReleasedOnOrBeforeToday(film?.release_date || null)) {
    setMessage("#ratings-quick-message", "Impossible de noter un film non sorti ou sans date de sortie.", true);
    return;
  }

  const scoreInput = document.querySelector(`[data-field="score"][data-film-id="${filmId}"]`);
  const scoreRaw = scoreInput?.value.trim() || "";

  if (!scoreRaw) {
    setMessage("#ratings-quick-message", "Le score est obligatoire pour sauvegarder.", true);
    return;
  }

  const score = Number(scoreRaw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#ratings-quick-message", "Le score doit etre entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const { error } = await supabase.from("ratings").upsert(
    {
      user_id: currentUserId,
      film_id: filmId,
      score
    },
    { onConflict: "user_id,film_id" }
  );

  if (error) throw error;

  setMessage("#ratings-quick-message", "Note sauvegardee.");
  await loadPersonalRatings(currentUserId);
}

async function loadProfile() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const user = session.user;
  currentUserId = user.id;

  try {
    await loadMediaOutlets();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      document.querySelector("#username").value = data.username || "";
      document.querySelector("#avatar_url").value = data.avatar_url || "";
      renderAvatarPreview(data.avatar_url);
      document.querySelector("#admin-badge").textContent = data.is_admin ? "Oui" : "Non";
    }

    await Promise.all([loadMemberships(user.id), loadPersonalRatings(user.id)]);
    document.querySelector("#profile-email").textContent = user.email || "";
  } catch (error) {
    setMessage("#form-message", error.message || "Erreur de chargement profil.", true);
  }
}

document.querySelector("#avatar_url")?.addEventListener("input", (event) => {
  renderAvatarPreview(event.target.value.trim());
});

document.querySelector("#profile-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const username = document.querySelector("#username").value.trim();
  const avatarURL = document.querySelector("#avatar_url").value.trim();
  const mediaOutletId = document.querySelector("#media_outlet_id").value || null;

  if (!username) {
    setMessage("#form-message", "Username obligatoire.", true);
    return;
  }

  try {
    const payload = {
      id: session.user.id,
      username,
      avatar_url: avatarURL || null
    };

    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) throw error;

    if (mediaOutletId) {
      const { error: membershipError } = await supabase.from("profile_media_memberships").upsert(
        {
          profile_id: session.user.id,
          media_id: mediaOutletId,
          status: "pending",
          decided_at: null,
          decided_by: null
        },
        { onConflict: "profile_id,media_id" }
      );

      if (membershipError) throw membershipError;
    }

    setMessage("#form-message", "Profil enregistre. Demande media ajoutee/mise a jour.");
    await loadMemberships(session.user.id);
  } catch (error) {
    setMessage("#form-message", error.message || "Sauvegarde impossible.", true);
  }
});

document.querySelector("#personal-ratings-body")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='save-rating']");
  if (!button) return;

  const filmId = button.dataset.filmId;
  if (!filmId) return;

  try {
    await saveQuickRating(filmId);
  } catch (error) {
    setMessage("#ratings-quick-message", error.message || "Sauvegarde impossible.", true);
  }
});

loadProfile();
