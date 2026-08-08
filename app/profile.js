import { supabase } from "../supabaseClient.js";
import { requireAuth } from "./auth.js";
import { createRankingFilterController } from "./personal-ranking.js";
import { buildActivityBadgeMarkup, fetchLastActivityAt, getActivityStatus } from "./activity-status.js";
import {
  buildDenseRankLabels,
  compressImageFile,
  escapeHTML,
  formatScore,
  getScoreClass,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  renderAvatarInto,
  setMessage
} from "./utils.js";

let currentUserId = null;
let currentUsername = "";
let currentAvatarUrl = null;
let currentBio = "";
const rankingController = createRankingFilterController({ onChange: () => renderPersonalRatings() });

async function loadMediaOutlets() {
  const selectEl = document.querySelector("#media_outlet_id");

  const { data, error } = await supabase
    .from("media_outlets")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;

  selectEl.innerHTML = [
    `<option value="">Aucun média</option>`,
    ...(data || []).map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`)
  ].join("");
}

function renderMediaMemberships(rows) {
  const approvedListEl = document.querySelector("#profile-media-approved-list");
  const pendingListEl = document.querySelector("#profile-media-pending-list");
  if (!approvedListEl || !pendingListEl) return;

  const approved = rows.filter((row) => row.status === "approved");
  const pending = rows.filter((row) => row.status !== "approved");

  approvedListEl.innerHTML = approved.length
    ? approved
        .map(
          (row) =>
            `<li><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHTML(row.media_outlets?.name || "Média")}</li>`
        )
        .join("")
    : `<li class="film-meta">Ind&eacute;pendant (aucun m&eacute;dia rattach&eacute;)</li>`;

  pendingListEl.innerHTML = pending
    .map(
      (row) =>
        `<li><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> ${escapeHTML(row.media_outlets?.name || "Média")} <span class="film-meta">(en attente de validation)</span></li>`
    )
    .join("");
}

async function loadMemberships(userId) {
  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, status, media_id, media_outlets(name)")
    .eq("profile_id", userId)
    .order("requested_at", { ascending: false });

  if (error) throw error;

  renderMediaMemberships(data || []);
}

function renderPersonalRatings() {
  const body = document.querySelector("#personal-ratings-body");
  const filteredRows = rankingController.getFilteredRows();

  if (!filteredRows.length) {
    body.innerHTML = `<tr><td colspan="4">Aucun élément pour ce filtre.</td></tr>`;
    return;
  }

  const sortedRows = [...filteredRows].sort((a, b) => {
    const aRated = a.score !== null;
    const bRated = b.score !== null;

    if (aRated && bRated) {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title, "fr");
    }
    if (aRated) return -1;
    if (bRated) return 1;

    const aTs = a.sort_date ? new Date(a.sort_date).getTime() : Number.POSITIVE_INFINITY;
    const bTs = b.sort_date ? new Date(b.sort_date).getTime() : Number.POSITIVE_INFINITY;
    if (aTs !== bTs) return aTs - bTs;
    return a.title.localeCompare(b.title, "fr");
  });

  const rankLabels = buildDenseRankLabels(sortedRows, (row) => row.score, 2);

  body.innerHTML = sortedRows
    .map((row, index) => {
      const rank = row.score === null ? "-" : rankLabels[index];
      const scoreText = row.score === null ? "" : String(row.score);
      const badge = row.score === null
        ? `<span class="score-badge stade-neutre">Pas noté</span>`
        : `<span class="score-with-suffix"><span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score)}</span> <span class="score-suffix">/ 10</span></span>`;
      const typeLabel = row.type === "film" ? "Film" : "Série";
      const href = row.type === "film"
        ? `/film.html?id=${row.film_id}`
        : row.type === "season_phase"
          ? `/season.html?id=${row.season_id}`
          : `/series.html?id=${row.series_id}`;
      const modifierCell = row.type === "film"
        ? `
          <div class="inline-actions inline-edit">
            <input data-field="score" data-film-id="${row.film_id}" type="number" min="0" max="10" step="0.25" value="${scoreText}" placeholder="0 à 10" />
            <button type="button" class="icon-circle-btn save" data-action="save-rating" data-film-id="${row.film_id}" aria-label="Valider la note">
              <i class="fa-solid fa-check" aria-hidden="true"></i>
            </button>
            ${row.score === null ? "" : `
              <button type="button" class="icon-circle-btn delete" data-action="delete-rating" data-film-id="${row.film_id}" aria-label="Supprimer la note">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            `}
          </div>
        `
        : `<span class="film-meta">${row.type === "season_phase" ? "Notable sur la page saison" : "Notable sur la page série"}</span>`;

      return `
        <tr>
          <td>${rank}</td>
          <td>
            <a href="${href}" class="film-link">${escapeHTML(row.title)}</a>
            <small>(${escapeHTML(row.type === "season_phase" ? "Saison" : typeLabel)}${row.phase ? ` - ${escapeHTML(row.phase)}` : ""})</small>
          </td>
          <td>${badge}</td>
          <td>${modifierCell}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadPersonalRatings(userId) {
  await rankingController.load(userId);
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
    setMessage("#ratings-quick-message", "Le score doit être entre 0 et 10, par pas de 0,25.", true);
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

  setMessage("#ratings-quick-message", "Note sauvegardée.");
  await loadPersonalRatings(currentUserId);
}

async function deleteQuickRating(filmId) {
  if (!currentUserId) return;

  const { error } = await supabase
    .from("ratings")
    .delete()
    .eq("user_id", currentUserId)
    .eq("film_id", filmId);

  if (error) throw error;

  setMessage("#ratings-quick-message", "Note supprimée.");
  await loadPersonalRatings(currentUserId);
}

function renderProfileAvatarDisplay(url) {
  renderAvatarInto("#profile-avatar-display", url, "avatar profile-avatar-large");
}

function renderProfileBioDisplay(bio) {
  const el = document.querySelector("#profile-bio-display");
  if (!el) return;
  el.textContent = bio ? bio : "Aucune description pour l'instant.";
}

async function renderActivityBadge(userId) {
  const el = document.querySelector("#profile-activity-badge");
  if (!el) return;

  const lastActivityAt = await fetchLastActivityAt(userId);
  el.innerHTML = buildActivityBadgeMarkup(getActivityStatus(lastActivityAt));
}

function renderProfileAvatarModalPreview(url) {
  renderAvatarInto("#profile-avatar-modal-preview", url, "avatar media-avatar");
}

async function uploadProfileAvatar(file) {
  const compressedFile = await compressImageFile(file);
  const objectPath = `${currentUserId}/${Date.now()}-avatar.jpg`;

  const { error: uploadError } = await supabase.storage.from("profile-avatars").upload(objectPath, compressedFile, {
    upsert: true,
    cacheControl: "3600",
    contentType: compressedFile.type
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("profile-avatars").getPublicUrl(objectPath);
  return data?.publicUrl || null;
}

document.querySelector("#profile-avatar-file")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    renderProfileAvatarModalPreview(currentAvatarUrl);
    return;
  }

  const objectURL = URL.createObjectURL(file);
  renderProfileAvatarModalPreview(objectURL);
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 3000);
});

function openModal(id) {
  document.querySelector(`#${id}`)?.removeAttribute("hidden");
}

function closeModal(id) {
  document.querySelector(`#${id}`)?.setAttribute("hidden", "");
}

document.addEventListener("click", (event) => {
  const closeTrigger = event.target.closest("[data-modal-close]");
  if (closeTrigger) closeModal(closeTrigger.dataset.modalClose);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".season-adjust-modal:not([hidden])").forEach((modal) => {
    modal.hidden = true;
  });
});

document.querySelector("#edit-username-button")?.addEventListener("click", () => {
  setMessage("#username-modal-message", "");
  document.querySelector("#username-input").value = currentUsername;
  openModal("edit-username-modal");
});

document.querySelector("#edit-bio-button")?.addEventListener("click", () => {
  setMessage("#bio-modal-message", "");
  document.querySelector("#bio-input").value = currentBio;
  openModal("edit-bio-modal");
});

document.querySelector("#request-media-button")?.addEventListener("click", () => {
  setMessage("#media-request-message", "");
  document.querySelector("#media_outlet_id").value = "";
  openModal("media-request-modal");
});

document.querySelector("#edit-avatar-button")?.addEventListener("click", () => {
  setMessage("#avatar-modal-message", "");
  document.querySelector("#profile-avatar-file").value = "";
  renderProfileAvatarModalPreview(currentAvatarUrl);
  openModal("edit-avatar-modal");
});

document.querySelector("#edit-password-button")?.addEventListener("click", () => {
  setMessage("#password-message", "");
  document.querySelector("#profile-current-password").value = "";
  document.querySelector("#profile-new-password").value = "";
  document.querySelector("#profile-new-password-confirm").value = "";
  openModal("change-password-modal");
});

async function loadProfile() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const user = session.user;
  currentUserId = user.id;

  try {
    await loadMediaOutlets();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, is_admin, avatar_url, bio")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      currentUsername = data.username || "";
      document.querySelector("#profile-username-display").textContent = currentUsername;
      document.querySelector("#admin-badge").textContent = data.is_admin ? "Oui" : "Non";
      currentAvatarUrl = data.avatar_url || null;
      renderProfileAvatarDisplay(currentAvatarUrl);
      currentBio = data.bio || "";
      renderProfileBioDisplay(currentBio);
    }

    await Promise.all([loadMemberships(user.id), loadPersonalRatings(user.id), renderActivityBadge(user.id)]);
    document.querySelector("#profile-email").textContent = user.email || "";
  } catch (error) {
    setMessage("#form-message", error.message || "Erreur de chargement profil.", true);
  }
}

document.querySelector("#edit-username-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const username = document.querySelector("#username-input").value.trim();
  if (!username) {
    setMessage("#username-modal-message", "Le nom d'utilisateur est obligatoire.", true);
    return;
  }

  try {
    const { error } = await supabase.from("profiles").update({ username }).eq("id", session.user.id);
    if (error) throw error;

    currentUsername = username;
    document.querySelector("#profile-username-display").textContent = currentUsername;
    closeModal("edit-username-modal");
  } catch (error) {
    setMessage("#username-modal-message", error.message || "Sauvegarde impossible.", true);
  }
});

document.querySelector("#edit-bio-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const bio = document.querySelector("#bio-input").value.trim();

  try {
    const { error } = await supabase.from("profiles").update({ bio: bio || null }).eq("id", session.user.id);
    if (error) throw error;

    currentBio = bio;
    renderProfileBioDisplay(currentBio);
    closeModal("edit-bio-modal");
  } catch (error) {
    setMessage("#bio-modal-message", error.message || "Sauvegarde impossible.", true);
  }
});

document.querySelector("#media-request-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const mediaOutletId = document.querySelector("#media_outlet_id").value || null;
  if (!mediaOutletId) {
    setMessage("#media-request-message", "Sélectionne un média.", true);
    return;
  }

  try {
    const { error } = await supabase.from("profile_media_memberships").upsert(
      {
        profile_id: session.user.id,
        media_id: mediaOutletId,
        status: "pending",
        decided_at: null,
        decided_by: null
      },
      { onConflict: "profile_id,media_id" }
    );
    if (error) throw error;

    await loadMemberships(session.user.id);
    closeModal("media-request-modal");
  } catch (error) {
    setMessage("#media-request-message", error.message || "Demande impossible.", true);
  }
});

document.querySelector("#edit-avatar-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const avatarFile = document.querySelector("#profile-avatar-file")?.files?.[0] || null;
  if (!avatarFile) {
    setMessage("#avatar-modal-message", "Choisis une image.", true);
    return;
  }

  try {
    const avatarUrl = await uploadProfileAvatar(avatarFile);
    const { error } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("id", session.user.id);
    if (error) throw error;

    currentAvatarUrl = avatarUrl;
    renderProfileAvatarDisplay(currentAvatarUrl);
    closeModal("edit-avatar-modal");
  } catch (error) {
    setMessage("#avatar-modal-message", error.message || "Sauvegarde impossible.", true);
  }
});

document.querySelector("#change-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const currentPassword = document.querySelector("#profile-current-password").value;
  const password = document.querySelector("#profile-new-password").value;
  const confirm = document.querySelector("#profile-new-password-confirm").value;

  if (!currentPassword) {
    setMessage("#password-message", "Saisis ton mot de passe actuel.", true);
    return;
  }

  if (password !== confirm) {
    setMessage("#password-message", "Les mots de passe ne correspondent pas.", true);
    return;
  }

  if (password.length < 6) {
    setMessage("#password-message", "Le mot de passe doit contenir au moins 6 caractères.", true);
    return;
  }

  try {
    const email = session.user?.email || "";
    if (!email) {
      setMessage("#password-message", "Adresse email introuvable pour vérifier le mot de passe actuel.", true);
      return;
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword
    });
    if (verifyError) {
      setMessage("#password-message", "Mot de passe actuel incorrect.", true);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;

    document.querySelector("#profile-current-password").value = "";
    document.querySelector("#profile-new-password").value = "";
    document.querySelector("#profile-new-password-confirm").value = "";
    closeModal("change-password-modal");
  } catch (error) {
    setMessage("#password-message", error.message || "Mise à jour impossible.", true);
  }
});

document.querySelector("#personal-ratings-body")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const filmId = button.dataset.filmId;
  if (!filmId) return;

  try {
    if (button.dataset.action === "save-rating") {
      await saveQuickRating(filmId);
      return;
    }

    if (button.dataset.action === "delete-rating") {
      await deleteQuickRating(filmId);
    }
  } catch (error) {
    setMessage("#ratings-quick-message", error.message || "Opération impossible.", true);
  }
});

loadProfile();
