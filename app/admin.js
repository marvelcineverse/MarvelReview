import { supabase } from "../supabaseClient.js";
import { getCurrentProfile, requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

const state = {
  films: [],
  series: [],
  seasons: [],
  episodes: [],
  profiles: [],
  mediaOutlets: []
};

const accessState = {
  session: null,
  userId: null,
  isAdmin: false,
  managedMediaIds: new Set()
};

function bindCreationTabs() {
  const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
  const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
  if (!tabButtons.length || !panels.length) return;

  const activate = (target) => {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === target;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.tabPanel === target);
    });
  };

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activate(button.dataset.tabTarget || "film");
    });
  });

  const defaultTab = tabButtons.find((button) => button.classList.contains("is-active"))?.dataset.tabTarget || "film";
  activate(defaultTab);
}

function setAdminSectionsVisibility(isAdmin) {
  document.querySelectorAll("[data-admin-section='true']").forEach((section) => {
    section.style.display = isAdmin ? "" : "none";
  });
}

function getEditableMediaRows() {
  if (accessState.isAdmin) return state.mediaOutlets;
  return state.mediaOutlets.filter((media) => accessState.managedMediaIds.has(media.id));
}

function canEditMedia(mediaId) {
  if (!mediaId) return false;
  if (accessState.isAdmin) return true;
  return accessState.managedMediaIds.has(mediaId);
}

function renderMediaAvatarPreview(url) {
  const previewEl = document.querySelector("#media-avatar-preview");
  if (!previewEl) return;

  const safeURL = String(url || "").trim();
  if (!safeURL) {
    previewEl.innerHTML = "Pas d'image.";
    return;
  }

  previewEl.innerHTML = `<img src="${escapeHTML(safeURL)}" alt="Image du media" class="avatar media-avatar" />`;
}

function sanitizeFilename(value) {
  return String(value || "media-image")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uploadMediaAvatar(file) {
  const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
  const baseName = sanitizeFilename(file.name.replace(/\.[^.]+$/, "")) || "media-image";
  const objectPath = `${accessState.userId}/${Date.now()}-${baseName}.${extension}`;

  const { error: uploadError } = await supabase.storage.from("media-avatars").upload(objectPath, file, {
    upsert: true,
    cacheControl: "3600",
    contentType: file.type || undefined
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("media-avatars").getPublicUrl(objectPath);
  return data?.publicUrl || null;
}

function updateMediaSubmitButton(mediaId) {
  const submitButton = document.querySelector("#media-submit-button");
  if (!submitButton) return;
  submitButton.textContent = mediaId ? "Mettre a jour le media" : "Creer le media";
}

function fillMediaForm(mediaId) {
  const media = state.mediaOutlets.find((item) => item.id === mediaId);

  if (!media) {
    document.querySelector("#media-name").value = "";
    document.querySelector("#media-twitter-url").value = "";
    document.querySelector("#media-instagram-url").value = "";
    document.querySelector("#media-youtube-url").value = "";
    document.querySelector("#media-tiktok-url").value = "";
    document.querySelector("#media-website-url").value = "";
    document.querySelector("#media-avatar-url").value = "";
    document.querySelector("#media-description").value = "";
    document.querySelector("#media-avatar-file").value = "";
    if (accessState.isAdmin) {
      document.querySelector("#media-admin-profile-id").value = "";
    }
    renderMediaAvatarPreview("");
    updateMediaSubmitButton("");
    return;
  }

  document.querySelector("#media-name").value = media.name || "";
  document.querySelector("#media-twitter-url").value = media.twitter_url || "";
  document.querySelector("#media-instagram-url").value = media.instagram_url || "";
  document.querySelector("#media-youtube-url").value = media.youtube_url || "";
  document.querySelector("#media-tiktok-url").value = media.tiktok_url || "";
  document.querySelector("#media-website-url").value = media.website_url || "";
  document.querySelector("#media-avatar-url").value = media.avatar_url || "";
  document.querySelector("#media-description").value = media.description || "";
  document.querySelector("#media-avatar-file").value = "";
  if (accessState.isAdmin) {
    document.querySelector("#media-admin-profile-id").value = media.admin_profile_id || "";
  }
  renderMediaAvatarPreview(media.avatar_url || "");
  updateMediaSubmitButton(media.id);
}

function renderMediaEditorOptions(preferredMediaId = "") {
  const mediaSelectEl = document.querySelector("#media-id");
  const editableRows = getEditableMediaRows();

  if (!editableRows.length && !accessState.isAdmin) {
    mediaSelectEl.innerHTML = `<option value="">Aucun media gere</option>`;
    fillMediaForm("");
    return;
  }

  const options = [];
  if (accessState.isAdmin) {
    options.push(`<option value="">Nouveau media</option>`);
  }

  editableRows.forEach((media) => {
    options.push(`<option value="${media.id}">${escapeHTML(media.name)}</option>`);
  });

  mediaSelectEl.innerHTML = options.join("");

  const hasPreferred = preferredMediaId && editableRows.some((media) => media.id === preferredMediaId);
  const selectedId = hasPreferred
    ? preferredMediaId
    : accessState.isAdmin
      ? ""
      : (editableRows[0]?.id || "");
  mediaSelectEl.value = selectedId;
  fillMediaForm(selectedId);
}

function renderMembershipMediaOptions() {
  const mediaSelectEl = document.querySelector("#membership-media-id");
  if (!mediaSelectEl) return;

  const previousValue = mediaSelectEl.value || "";
  const scopedMediaRows = accessState.isAdmin ? state.mediaOutlets : getEditableMediaRows();
  if (!scopedMediaRows.length) {
    mediaSelectEl.innerHTML = `<option value="">Aucun media</option>`;
    return;
  }

  mediaSelectEl.innerHTML = scopedMediaRows
    .map((media) => `<option value="${media.id}">${escapeHTML(media.name)}</option>`)
    .join("");

  const nextValue = scopedMediaRows.some((media) => media.id === previousValue)
    ? previousValue
    : scopedMediaRows[0].id;
  mediaSelectEl.value = nextValue;
}

function renderProfileOptions() {
  const adminSelectEl = document.querySelector("#media-admin-profile-id");
  if (adminSelectEl) {
    adminSelectEl.innerHTML = [
      `<option value="">Aucun gestionnaire pour le moment</option>`,
      ...state.profiles.map((user) => `<option value="${user.id}">${escapeHTML(user.username)}</option>`)
    ].join("");
  }

  const membershipProfileEl = document.querySelector("#membership-profile-id");
  if (membershipProfileEl) {
    membershipProfileEl.innerHTML = state.profiles
      .map((user) => `<option value="${user.id}">${escapeHTML(user.username)}</option>`)
      .join("");
  }
}

function renderManagedRequests(rows) {
  const body = document.querySelector("#managed-media-requests-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4">Aucune demande en attente.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHTML(row.mediaName)}</td>
          <td>${escapeHTML(row.profileName)}</td>
          <td>${escapeHTML(row.status)}</td>
          <td>
            <div class="inline-actions">
              <button type="button" data-action="approve-media-membership" data-id="${row.id}">Approuver</button>
              <button type="button" class="ghost-button" data-action="reject-media-membership" data-id="${row.id}">Refuser</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderManagedMembers(rows) {
  const body = document.querySelector("#managed-media-members-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="2">Aucun membre rattaché.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHTML(row.profileName)}</td>
          <td class="actions-cell">
            <button
              type="button"
              class="icon-circle-btn delete small"
              data-action="remove-media-member"
              data-membership-id="${row.membershipId}"
              data-media-id="${row.mediaId}"
              data-profile-name="${escapeHTML(row.profileName)}"
              title="Supprimer ${escapeHTML(row.profileName)}"
              aria-label="Supprimer ${escapeHTML(row.profileName)}"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </td>
        </tr>
      `
    )
    .join("");
}

async function loadManagedMediaMembers() {
  const mediaId = document.querySelector("#membership-media-id")?.value || "";
  if (!mediaId) {
    renderManagedMembers([]);
    return;
  }

  if (!canEditMedia(mediaId)) {
    renderManagedMembers([]);
    return;
  }

  const profileById = new Map(state.profiles.map((profile) => [profile.id, profile.username]));
  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, profile_id, media_id")
    .eq("media_id", mediaId)
    .eq("status", "approved")
    .order("decided_at", { ascending: false, nullsFirst: false });

  if (error) throw error;

  const rows = (data || [])
    .map((row) => ({
      membershipId: row.id,
      mediaId: row.media_id,
      profileName: profileById.get(row.profile_id) || row.profile_id
    }))
    .sort((a, b) => a.profileName.localeCompare(b.profileName, "fr"));

  renderManagedMembers(rows);
}

async function loadManagedMediaRequests() {
  const managerSectionEl = document.querySelector("#media-manager-section");
  if (!managerSectionEl) return;

  const scopedMediaRows = accessState.isAdmin ? state.mediaOutlets : getEditableMediaRows();
  if (!accessState.isAdmin && !scopedMediaRows.length) {
    managerSectionEl.style.display = "none";
    return;
  }
  managerSectionEl.style.display = "";

  const mediaById = new Map(state.mediaOutlets.map((media) => [media.id, media.name]));
  const profileById = new Map(state.profiles.map((profile) => [profile.id, profile.username]));

  let query = supabase
    .from("profile_media_memberships")
    .select("id, profile_id, media_id, status, requested_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: false });

  if (!accessState.isAdmin) {
    const mediaIds = scopedMediaRows.map((media) => media.id);
    if (!mediaIds.length) {
      renderManagedRequests([]);
      return;
    }
    query = query.in("media_id", mediaIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map((row) => ({
    id: row.id,
    mediaName: mediaById.get(row.media_id) || "Media",
    profileName: profileById.get(row.profile_id) || row.profile_id,
    status: row.status
  }));

  renderManagedRequests(rows);
}

async function ensureAdminOrManager() {
  const session = await requireAuth("/login.html");
  if (!session) return null;

  const currentProfile = await getCurrentProfile();
  const { data: managedMedias, error: managedError } = await supabase
    .from("media_outlets")
    .select("id")
    .eq("admin_profile_id", session.user.id);

  if (managedError) throw managedError;

  const isAdmin = Boolean(currentProfile?.is_admin);
  const managedMediaIds = new Set((managedMedias || []).map((media) => media.id));
  if (!isAdmin && managedMediaIds.size === 0) {
    setMessage("#page-message", "Acces reserve aux administrateurs et gestionnaires de media.", true);
    document.querySelector("#admin-root").style.display = "none";
    return null;
  }

  accessState.session = session;
  accessState.userId = session.user.id;
  accessState.isAdmin = isAdmin;
  accessState.managedMediaIds = managedMediaIds;

  setAdminSectionsVisibility(isAdmin);

  const mediaRoleHintEl = document.querySelector("#media-role-hint");
  if (mediaRoleHintEl) {
    mediaRoleHintEl.textContent = isAdmin
      ? "Mode admin: creation et edition de tous les medias."
      : "Mode gestionnaire: edition uniquement de tes medias.";
  }

  const managerScopeEl = document.querySelector("#media-manager-scope");
  if (managerScopeEl) {
    managerScopeEl.textContent = isAdmin
      ? "Tu vois toutes les demandes de rattachement."
      : "Tu vois uniquement les demandes liees a tes medias.";
  }

  const membershipMediaLabel = document.querySelector("#membership-media-id")?.closest("label");
  if (membershipMediaLabel) {
    membershipMediaLabel.classList.toggle("form-span-2", !isAdmin);
  }

  return session;
}

async function loadProfilesForMediaAdmin() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .order("username", { ascending: true });

  if (error) throw error;
  state.profiles = data || [];
  renderProfileOptions();
}

function renderAdminUsers(rows) {
  const body = document.querySelector("#admin-users-table-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="3">Aucun utilisateur.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHTML(row.email || "-")}</td>
          <td>${escapeHTML(row.username || "-")}</td>
          <td>
            <button
              type="button"
              class="ghost-button"
              data-admin-reset-email="${escapeHTML(row.email || "")}"
            >
              Envoyer reset
            </button>
          </td>
        </tr>
      `
    )
    .join("");
}

async function loadAdminUsers() {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  renderAdminUsers(data || []);
}

function bindAdminResetActions() {
  document.querySelector("#admin-users-table-body")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-admin-reset-email]");
    if (!button) return;

    const email = button.dataset.adminResetEmail?.trim();
    if (!email) {
      setMessage("#admin-users-message", "Email manquant pour cet utilisateur.", true);
      return;
    }

    try {
      const redirectTo = `${window.location.origin}/update-password.html`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      setMessage("#admin-users-message", `Email de reinitialisation envoye a ${email}.`);
    } catch (error) {
      setMessage(
        "#admin-users-message",
        error.message || "Impossible d'envoyer l'email de reinitialisation.",
        true
      );
    }
  });
}

function bindCreateMedia() {
  document.querySelector("#media-id")?.addEventListener("change", (event) => {
    fillMediaForm(event.target.value || "");
  });

  document.querySelector("#media-avatar-url")?.addEventListener("input", (event) => {
    renderMediaAvatarPreview(event.target.value.trim());
  });

  document.querySelector("#media-avatar-file")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      renderMediaAvatarPreview(document.querySelector("#media-avatar-url").value.trim());
      return;
    }

    const objectURL = URL.createObjectURL(file);
    renderMediaAvatarPreview(objectURL);
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 3000);
  });

  document.querySelector("#create-media-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const selectedMediaId = document.querySelector("#media-id").value || "";
    const currentMedia = state.mediaOutlets.find((item) => item.id === selectedMediaId) || null;
    const avatarFile = document.querySelector("#media-avatar-file")?.files?.[0] || null;
    let avatarURL = document.querySelector("#media-avatar-url").value.trim() || null;

    if (!accessState.isAdmin && !selectedMediaId) {
      setMessage("#create-media-message", "Tu peux uniquement modifier un media dont tu es gestionnaire.", true);
      return;
    }

    if (selectedMediaId && !canEditMedia(selectedMediaId)) {
      setMessage("#create-media-message", "Tu ne peux modifier que ton media.", true);
      return;
    }

    const payload = {
      name: document.querySelector("#media-name").value.trim(),
      twitter_url: document.querySelector("#media-twitter-url").value.trim() || null,
      instagram_url: document.querySelector("#media-instagram-url").value.trim() || null,
      youtube_url: document.querySelector("#media-youtube-url").value.trim() || null,
      tiktok_url: document.querySelector("#media-tiktok-url").value.trim() || null,
      website_url: document.querySelector("#media-website-url").value.trim() || null,
      avatar_url: avatarURL,
      description: document.querySelector("#media-description").value.trim() || null
    };

    if (!payload.name) {
      setMessage("#create-media-message", "Le nom du media est obligatoire.", true);
      return;
    }

    try {
      if (avatarFile) {
        avatarURL = await uploadMediaAvatar(avatarFile);
        payload.avatar_url = avatarURL;
      } else if (!avatarURL && currentMedia?.avatar_url) {
        payload.avatar_url = currentMedia.avatar_url;
      }

      if (selectedMediaId) {
        if (accessState.isAdmin) {
          payload.admin_profile_id = document.querySelector("#media-admin-profile-id").value || null;
        }

        const { error } = await supabase.from("media_outlets").update(payload).eq("id", selectedMediaId);
        if (error) throw error;
        setMessage("#create-media-message", "Media mis a jour.");
        await loadMediaOutlets(selectedMediaId);
      } else {
        payload.admin_profile_id = document.querySelector("#media-admin-profile-id").value || null;
        const { data: inserted, error } = await supabase
          .from("media_outlets")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        setMessage("#create-media-message", "Media cree.");
        await loadMediaOutlets(inserted?.id || "");
      }

      await loadManagedMediaRequests();
    } catch (error) {
      setMessage("#create-media-message", error.message || "Enregistrement media impossible.", true);
    }
  });
}

function bindManagedRequestsActions() {
  document.querySelector("#managed-media-requests-body")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const membershipId = button.dataset.id;
    if (!membershipId) return;

    const approved = button.dataset.action === "approve-media-membership";
    if (!approved && button.dataset.action !== "reject-media-membership") return;

    try {
      const { error } = await supabase.rpc("admin_decide_media_membership", {
        p_membership_id: membershipId,
        p_approved: approved
      });

      if (error) throw error;

      setMessage("#media-manager-message", "Decision enregistree.");
      await loadManagedMediaRequests();
      await loadManagedMediaMembers();
    } catch (error) {
      setMessage("#media-manager-message", error.message || "Impossible de traiter la demande.", true);
    }
  });
}

function bindManualMembershipActions() {
  document.querySelector("#membership-media-id")?.addEventListener("change", async () => {
    try {
      await loadManagedMediaMembers();
    } catch (error) {
      setMessage("#media-manager-message", error.message || "Impossible de charger les membres du media.", true);
    }
  });

  const readSelections = () => ({
    mediaId: document.querySelector("#membership-media-id")?.value || "",
    profileId: document.querySelector("#membership-profile-id")?.value || ""
  });

  document.querySelector("#membership-attach-button")?.addEventListener("click", async () => {
    const { mediaId, profileId } = readSelections();
    if (!mediaId || !profileId) {
      setMessage("#media-manager-message", "Selectionne un media et un profil.", true);
      return;
    }

    if (!canEditMedia(mediaId)) {
      setMessage("#media-manager-message", "Tu ne peux gerer que ton media.", true);
      return;
    }

    try {
      const { error } = await supabase.from("profile_media_memberships").upsert(
        {
          profile_id: profileId,
          media_id: mediaId,
          status: "approved",
          decided_at: new Date().toISOString(),
          decided_by: accessState.userId
        },
        { onConflict: "profile_id,media_id" }
      );
      if (error) throw error;

      setMessage("#media-manager-message", "Profil rattache.");
      await loadManagedMediaRequests();
      await loadManagedMediaMembers();
    } catch (error) {
      setMessage("#media-manager-message", error.message || "Rattachement impossible.", true);
    }
  });

  document.querySelector("#membership-detach-button")?.addEventListener("click", async () => {
    const { mediaId, profileId } = readSelections();
    if (!mediaId || !profileId) {
      setMessage("#media-manager-message", "Selectionne un media et un profil.", true);
      return;
    }

    if (!canEditMedia(mediaId)) {
      setMessage("#media-manager-message", "Tu ne peux gerer que ton media.", true);
      return;
    }

    try {
      const { error } = await supabase
        .from("profile_media_memberships")
        .delete()
        .eq("media_id", mediaId)
        .eq("profile_id", profileId);
      if (error) throw error;

      setMessage("#media-manager-message", "Rattachement supprime.");
      await loadManagedMediaRequests();
      await loadManagedMediaMembers();
    } catch (error) {
      setMessage("#media-manager-message", error.message || "Suppression impossible.", true);
    }
  });
}

function bindManagedMembersActions() {
  document.querySelector("#managed-media-members-body")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='remove-media-member']");
    if (!button) return;

    const membershipId = button.dataset.membershipId;
    const mediaId = button.dataset.mediaId;
    const profileName = button.dataset.profileName || "ce profil";
    if (!membershipId || !mediaId) return;

    if (!canEditMedia(mediaId)) {
      setMessage("#media-manager-message", "Tu ne peux gerer que ton media.", true);
      return;
    }

    const confirmed = window.confirm(`Confirmer la suppression du rattachement de ${profileName} ?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase.from("profile_media_memberships").delete().eq("id", membershipId);
      if (error) throw error;

      setMessage("#media-manager-message", `Rattachement supprime pour ${profileName}.`);
      await loadManagedMediaMembers();
      await loadManagedMediaRequests();
    } catch (error) {
      setMessage("#media-manager-message", error.message || "Suppression impossible.", true);
    }
  });
}

async function loadMediaOutlets(preferredMediaId = "") {
  const { data, error } = await supabase
    .from("media_outlets")
    .select(
      "id, name, admin_profile_id, twitter_url, instagram_url, youtube_url, tiktok_url, website_url, avatar_url, description"
    )
    .order("name", { ascending: true });

  if (error) throw error;

  state.mediaOutlets = data || [];
  renderMediaEditorOptions(preferredMediaId);
  renderMembershipMediaOptions();
  await loadManagedMediaMembers();
}

function renderFilmOptions() {
  document.querySelector("#film-id").innerHTML = [
    `<option value="">Nouveau film</option>`,
    ...state.films.map((film) => `<option value="${film.id}">${escapeHTML(film.title)}</option>`)
  ].join("");
}

function fillFilmForm(filmId) {
  const row = state.films.find((item) => item.id === filmId);

  document.querySelector("#film-title").value = row?.title || "";
  document.querySelector("#film-slug").value = row?.slug || "";
  document.querySelector("#film-release-date").value = row?.release_date || "";
  document.querySelector("#film-franchise").value = row?.franchise || "MCU";
  document.querySelector("#film-phase").value = row?.phase || "";
  document.querySelector("#film-type").value = row?.type || "Film";
  document.querySelector("#film-poster-url").value = row?.poster_url || "";
  document.querySelector("#film-synopsis").value = row?.synopsis || "";
}

function renderSeriesOptions() {
  const seriesOptions = [
    `<option value="">Nouvelle serie</option>`,
    ...state.series.map((serie) => `<option value="${serie.id}">${escapeHTML(serie.title)}</option>`)
  ].join("");

  const seasonSeriesOptions = [
    `<option value="">Selectionne une serie</option>`,
    ...state.series.map((serie) => `<option value="${serie.id}">${escapeHTML(serie.title)}</option>`)
  ].join("");

  document.querySelector("#series-id").innerHTML = seriesOptions;
  document.querySelector("#season-series-id").innerHTML = seasonSeriesOptions;
}

function renderSeasonOptions(seriesId = "") {
  const filtered = seriesId ? state.seasons.filter((season) => season.series_id === seriesId) : [];

  document.querySelector("#season-id").innerHTML = [
    `<option value="">Nouvelle saison</option>`,
    ...filtered.map((season) => `<option value="${season.id}">S${season.season_number} - ${escapeHTML(season.name)}</option>`)
  ].join("");

  const episodeSeasonOptions = [
    `<option value="">Selectionne une saison</option>`,
    ...state.seasons.map((season) => {
      const serie = state.series.find((item) => item.id === season.series_id);
      const serieName = serie?.title || "Serie";
      return `<option value="${season.id}">${escapeHTML(serieName)} - S${season.season_number} - ${escapeHTML(season.name)}</option>`;
    })
  ].join("");

  const episodeSeasonEl = document.querySelector("#episode-season-id");
  if (episodeSeasonEl) episodeSeasonEl.innerHTML = episodeSeasonOptions;

  const bulkSeasonEl = document.querySelector("#episode-bulk-season-id");
  if (bulkSeasonEl) bulkSeasonEl.innerHTML = episodeSeasonOptions;
}

function renderEpisodeOptions(seasonId = "") {
  const filtered = seasonId ? state.episodes.filter((episode) => episode.season_id === seasonId) : [];

  const episodeSelectEl = document.querySelector("#episode-id");
  if (!episodeSelectEl) return;

  episodeSelectEl.innerHTML = [
    `<option value="">Nouvel episode</option>`,
    ...filtered
      .sort((a, b) => a.episode_number - b.episode_number)
      .map((episode) => `<option value="${episode.id}">Ep ${episode.episode_number} - ${escapeHTML(episode.title)}</option>`)
  ].join("");

  updateEpisodeDeleteButtonState();
}

function updateEpisodeDeleteButtonState() {
  const deleteButtonEl = document.querySelector("#episode-delete-button");
  if (!deleteButtonEl) return;

  const selectedEpisodeId = document.querySelector("#episode-id")?.value || "";
  deleteButtonEl.disabled = !selectedEpisodeId;
}

function fillSeriesForm(seriesId) {
  const row = state.series.find((item) => item.id === seriesId);

  document.querySelector("#series-title").value = row?.title || "";
  document.querySelector("#series-slug").value = row?.slug || "";
  document.querySelector("#series-synopsis").value = row?.synopsis || "";
  document.querySelector("#series-poster-url").value = row?.poster_url || "";
  document.querySelector("#series-start-date").value = row?.start_date || "";
  document.querySelector("#series-end-date").value = row?.end_date || "";
  document.querySelector("#series-franchise").value = row?.franchise || "MCU";
  document.querySelector("#series-type").value = row?.type || "Serie";
}

function fillSeasonForm(seasonId) {
  const row = state.seasons.find((item) => item.id === seasonId);

  if (row) {
    document.querySelector("#season-series-id").value = row.series_id;
  }

  document.querySelector("#season-name").value = row?.name || "";
  document.querySelector("#season-number").value = row?.season_number || "";
  document.querySelector("#season-slug").value = row?.slug || "";
  document.querySelector("#season-poster-url").value = row?.poster_url || "";
  document.querySelector("#season-start-date").value = row?.start_date || "";
  document.querySelector("#season-end-date").value = row?.end_date || "";
  document.querySelector("#season-phase").value = row?.phase || "";

  renderSeasonOptions(document.querySelector("#season-series-id").value || "");
  document.querySelector("#season-id").value = seasonId || "";
}

function fillEpisodeForm(episodeId) {
  const row = state.episodes.find((item) => item.id === episodeId);

  if (row) {
    document.querySelector("#episode-season-id").value = row.season_id;
  }

  document.querySelector("#episode-number").value = row?.episode_number || "";
  document.querySelector("#episode-title").value = row?.title || "";
  document.querySelector("#episode-air-date").value = row?.air_date || "";

  renderEpisodeOptions(document.querySelector("#episode-season-id").value || "");
  document.querySelector("#episode-id").value = episodeId || "";
  updateEpisodeDeleteButtonState();
}

async function refreshSeriesData() {
  const [
    { data: films, error: filmsError },
    { data: series, error: seriesError },
    { data: seasons, error: seasonsError },
    { data: episodes, error: episodesError }
  ] = await Promise.all([
    supabase
      .from("films")
      .select("id, title, slug, release_date, franchise, phase, type, poster_url, synopsis")
      .order("release_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("series")
      .select("id, title, slug, synopsis, poster_url, start_date, end_date, franchise, type")
      .order("title", { ascending: true }),
    supabase
      .from("series_seasons")
      .select("id, series_id, name, season_number, slug, poster_url, start_date, end_date, phase")
      .order("season_number", { ascending: true }),
    supabase
      .from("series_episodes")
      .select("id, season_id, episode_number, title, air_date")
      .order("episode_number", { ascending: true })
  ]);

  if (filmsError) throw filmsError;
  if (seriesError) throw seriesError;
  if (seasonsError) throw seasonsError;
  if (episodesError) throw episodesError;

  state.films = films || [];
  state.series = series || [];
  state.seasons = seasons || [];
  state.episodes = episodes || [];

  const selectedFilmId = document.querySelector("#film-id")?.value || "";
  const selectedSeriesId = document.querySelector("#series-id")?.value || "";
  const selectedSeasonSeriesId = document.querySelector("#season-series-id")?.value || "";
  const selectedSeasonId = document.querySelector("#season-id")?.value || "";
  const selectedEpisodeSeasonId = document.querySelector("#episode-season-id")?.value || "";
  const selectedEpisodeId = document.querySelector("#episode-id")?.value || "";
  const selectedBulkEpisodeSeasonId = document.querySelector("#episode-bulk-season-id")?.value || "";

  renderFilmOptions();
  document.querySelector("#film-id").value = state.films.some((f) => f.id === selectedFilmId) ? selectedFilmId : "";
  fillFilmForm(document.querySelector("#film-id").value || "");

  renderSeriesOptions();
  document.querySelector("#series-id").value = state.series.some((s) => s.id === selectedSeriesId) ? selectedSeriesId : "";
  fillSeriesForm(document.querySelector("#series-id").value || "");

  renderSeasonOptions(selectedSeasonSeriesId);
  document.querySelector("#season-series-id").value = state.series.some((s) => s.id === selectedSeasonSeriesId) ? selectedSeasonSeriesId : "";
  renderSeasonOptions(document.querySelector("#season-series-id").value || "");
  document.querySelector("#season-id").value = state.seasons.some((s) => s.id === selectedSeasonId) ? selectedSeasonId : "";
  if (document.querySelector("#season-id").value) fillSeasonForm(document.querySelector("#season-id").value);

  document.querySelector("#episode-season-id").value = state.seasons.some((s) => s.id === selectedEpisodeSeasonId) ? selectedEpisodeSeasonId : "";
  renderEpisodeOptions(document.querySelector("#episode-season-id").value || "");
  document.querySelector("#episode-id").value = state.episodes.some((e) => e.id === selectedEpisodeId) ? selectedEpisodeId : "";
  if (document.querySelector("#episode-id").value) fillEpisodeForm(document.querySelector("#episode-id").value);
  updateEpisodeDeleteButtonState();

  const bulkSeasonEl = document.querySelector("#episode-bulk-season-id");
  if (bulkSeasonEl) {
    bulkSeasonEl.value = state.seasons.some((s) => s.id === selectedBulkEpisodeSeasonId) ? selectedBulkEpisodeSeasonId : "";
  }
}

function normalizeBulkDate(rawDate) {
  const raw = (rawDate || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const frMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    const [, day, month, year] = frMatch;
    return `${year}-${month}-${day}`;
  }

  return undefined;
}

function getBulkRowsValues() {
  return Array.from(document.querySelectorAll("[data-bulk-row]")).map((row, index) => ({
    index: index + 1,
    episode_number: row.querySelector("[data-field='episode-number']")?.value?.trim() || "",
    title: row.querySelector("[data-field='episode-title']")?.value?.trim() || "",
    air_date: row.querySelector("[data-field='episode-air-date']")?.value?.trim() || ""
  }));
}

function renderBulkEpisodeRows(count, previousRows = []) {
  const container = document.querySelector("#episode-bulk-rows");
  if (!container) return;

  const safeCount = Math.min(Math.max(Number(count) || 1, 1), 50);
  container.innerHTML = Array.from({ length: safeCount }, (_, idx) => {
    const row = previousRows[idx] || {};
    const episodeNumber = row.episode_number || String(idx + 1);
    const title = escapeHTML(row.title || "");
    const airDate = escapeHTML(row.air_date || "");
    return `
      <tr class="bulk-episode-row" data-bulk-row>
        <td class="bulk-episode-index">${idx + 1}</td>
        <td><input data-field="episode-number" type="number" min="1" step="1" value="${escapeHTML(episodeNumber)}" placeholder="Numero" /></td>
        <td><input data-field="episode-title" type="text" value="${title}" placeholder="Titre episode" /></td>
        <td><input data-field="episode-air-date" type="text" value="${airDate}" placeholder="Date (YYYY-MM-DD ou DD/MM/YYYY)" /></td>
      </tr>
    `;
  }).join("");

  const countInput = document.querySelector("#episode-bulk-count");
  if (countInput) countInput.value = String(safeCount);
}

function parseBulkEpisodesRows() {
  const rows = getBulkRowsValues();
  if (!rows.length) {
    throw new Error("Aucune ligne a importer.");
  }

  const parsed = [];
  const seenEpisodeNumbers = new Set();
  for (const row of rows) {
    const episodeNumber = Number(row.episode_number.replace(/^ep\.?\s*/i, ""));
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) {
      throw new Error(`Ligne ${row.index}: numero d'episode invalide.`);
    }
    if (seenEpisodeNumbers.has(episodeNumber)) {
      throw new Error(`Ligne ${row.index}: numero d'episode duplique.`);
    }
    seenEpisodeNumbers.add(episodeNumber);

    if (!row.title) {
      throw new Error(`Ligne ${row.index}: titre obligatoire.`);
    }

    const airDate = normalizeBulkDate(row.air_date);
    if (airDate === undefined) {
      throw new Error(`Ligne ${row.index}: date invalide (utilise YYYY-MM-DD ou DD/MM/YYYY).`);
    }

    parsed.push({
      episode_number: episodeNumber,
      title: row.title,
      air_date: airDate || null
    });
  }

  return parsed.sort((a, b) => a.episode_number - b.episode_number);
}

function fillBulkTableFromPaste(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (!input.dataset.field) return;

  const raw = event.clipboardData?.getData("text/plain") || "";
  if (!raw.includes("\n") && !raw.includes("\t")) return;

  const matrix = raw
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
  if (!matrix.length) return;

  const fields = ["episode-number", "episode-title", "episode-air-date"];
  const startFieldIndex = fields.indexOf(input.dataset.field);
  if (startFieldIndex === -1) return;

  const previousRows = getBulkRowsValues();
  let rowEls = Array.from(document.querySelectorAll("[data-bulk-row]"));
  const startRowEl = input.closest("[data-bulk-row]");
  const startRowIndex = rowEls.indexOf(startRowEl);
  if (startRowIndex < 0) return;

  const neededRows = startRowIndex + matrix.length;
  if (neededRows > previousRows.length) {
    renderBulkEpisodeRows(neededRows, previousRows);
    rowEls = Array.from(document.querySelectorAll("[data-bulk-row]"));
  }

  event.preventDefault();

  matrix.forEach((columns, rowOffset) => {
    const rowEl = rowEls[startRowIndex + rowOffset];
    if (!rowEl) return;

    columns.forEach((value, columnOffset) => {
      const field = fields[startFieldIndex + columnOffset];
      if (!field) return;
      const cellInput = rowEl.querySelector(`[data-field='${field}']`);
      if (cellInput) cellInput.value = value.trim();
    });
  });
}

function bindSeriesForms() {
  document.querySelector("#film-id")?.addEventListener("change", () => {
    fillFilmForm(document.querySelector("#film-id").value || "");
  });

  document.querySelector("#film-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#film-id").value || null;
    const payload = {
      id: id || undefined,
      title: document.querySelector("#film-title").value.trim(),
      slug: document.querySelector("#film-slug").value.trim() || null,
      release_date: document.querySelector("#film-release-date").value || null,
      franchise: document.querySelector("#film-franchise").value.trim() || "MCU",
      phase: document.querySelector("#film-phase").value.trim() || null,
      type: document.querySelector("#film-type").value.trim() || "Film",
      poster_url: document.querySelector("#film-poster-url").value.trim() || null,
      synopsis: document.querySelector("#film-synopsis").value.trim() || null
    };

    if (!payload.title) {
      setMessage("#film-message", "Le titre est obligatoire.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("films").upsert(payload);
      if (error) throw error;
      setMessage("#film-message", "Film enregistre.");
      await refreshSeriesData();
    } catch (error) {
      setMessage("#film-message", error.message || "Enregistrement film impossible.", true);
    }
  });

  document.querySelector("#series-id")?.addEventListener("change", () => {
    fillSeriesForm(document.querySelector("#series-id").value || "");
  });

  document.querySelector("#series-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#series-id").value || null;
    const payload = {
      id: id || undefined,
      title: document.querySelector("#series-title").value.trim(),
      slug: document.querySelector("#series-slug").value.trim() || null,
      synopsis: document.querySelector("#series-synopsis").value.trim() || null,
      poster_url: document.querySelector("#series-poster-url").value.trim() || null,
      start_date: document.querySelector("#series-start-date").value || null,
      end_date: document.querySelector("#series-end-date").value || null,
      franchise: document.querySelector("#series-franchise").value.trim() || "MCU",
      type: document.querySelector("#series-type").value.trim() || "Serie"
    };

    if (!payload.title) {
      setMessage("#series-message", "Le titre est obligatoire.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("series").upsert(payload);
      if (error) throw error;
      setMessage("#series-message", "Serie enregistree.");
      await refreshSeriesData();
    } catch (error) {
      setMessage("#series-message", error.message || "Enregistrement serie impossible.", true);
    }
  });

  document.querySelector("#season-series-id")?.addEventListener("change", () => {
    renderSeasonOptions(document.querySelector("#season-series-id").value || "");
    fillSeasonForm("");
  });

  document.querySelector("#season-id")?.addEventListener("change", () => {
    fillSeasonForm(document.querySelector("#season-id").value || "");
  });

  document.querySelector("#season-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#season-id").value || null;
    const seriesId = document.querySelector("#season-series-id").value || null;

    const payload = {
      id: id || undefined,
      series_id: seriesId,
      name: document.querySelector("#season-name").value.trim(),
      season_number: Number(document.querySelector("#season-number").value),
      slug: document.querySelector("#season-slug").value.trim() || null,
      poster_url: document.querySelector("#season-poster-url").value.trim() || null,
      start_date: document.querySelector("#season-start-date").value || null,
      end_date: document.querySelector("#season-end-date").value || null,
      phase: document.querySelector("#season-phase").value.trim() || null
    };

    if (!payload.series_id || !payload.name || !Number.isInteger(payload.season_number) || payload.season_number < 1) {
      setMessage("#season-message", "Serie, nom et numero de saison sont obligatoires.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("series_seasons").upsert(payload);
      if (error) throw error;
      setMessage("#season-message", "Saison enregistree.");
      await refreshSeriesData();
      renderSeasonOptions(seriesId);
    } catch (error) {
      setMessage("#season-message", error.message || "Enregistrement saison impossible.", true);
    }
  });

  document.querySelector("#episode-season-id")?.addEventListener("change", () => {
    renderEpisodeOptions(document.querySelector("#episode-season-id").value || "");
    fillEpisodeForm("");
  });

  document.querySelector("#episode-id")?.addEventListener("change", () => {
    fillEpisodeForm(document.querySelector("#episode-id").value || "");
  });

  document.querySelector("#episode-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#episode-id").value || null;
    const seasonId = document.querySelector("#episode-season-id").value || null;

    const payload = {
      id: id || undefined,
      season_id: seasonId,
      episode_number: Number(document.querySelector("#episode-number").value),
      title: document.querySelector("#episode-title").value.trim(),
      air_date: document.querySelector("#episode-air-date").value || null
    };

    if (!payload.season_id || !payload.title || !Number.isInteger(payload.episode_number) || payload.episode_number < 1) {
      setMessage("#episode-message", "Saison, numero et titre sont obligatoires.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("series_episodes").upsert(payload);
      if (error) throw error;
      setMessage("#episode-message", "Episode enregistre.");
      await refreshSeriesData();
      renderEpisodeOptions(seasonId);
    } catch (error) {
      setMessage("#episode-message", error.message || "Enregistrement episode impossible.", true);
    }
  });

  document.querySelector("#episode-delete-button")?.addEventListener("click", async () => {
    const episodeId = document.querySelector("#episode-id").value || null;
    const seasonId = document.querySelector("#episode-season-id").value || "";

    if (!episodeId) {
      setMessage("#episode-message", "Selectionne un episode existant a supprimer.", true);
      return;
    }

    const episodeRow = state.episodes.find((item) => item.id === episodeId);
    const episodeLabel = episodeRow
      ? `Ep ${episodeRow.episode_number} - ${episodeRow.title}`
      : "cet episode";
    const confirmed = window.confirm(`Confirmer la suppression de ${episodeLabel} ?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase.from("series_episodes").delete().eq("id", episodeId);
      if (error) throw error;

      setMessage("#episode-message", "Episode supprime.");
      await refreshSeriesData();

      const episodeSeasonEl = document.querySelector("#episode-season-id");
      if (episodeSeasonEl && seasonId && state.seasons.some((season) => season.id === seasonId)) {
        episodeSeasonEl.value = seasonId;
      }
      renderEpisodeOptions(seasonId);
      fillEpisodeForm("");
    } catch (error) {
      setMessage("#episode-message", error.message || "Suppression episode impossible.", true);
    }
  });

  document.querySelector("#episode-bulk-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const seasonId = document.querySelector("#episode-bulk-season-id").value || null;

    if (!seasonId) {
      setMessage("#episode-bulk-message", "Selectionne une saison.", true);
      return;
    }

    let episodes;
    try {
      episodes = parseBulkEpisodesRows();
    } catch (error) {
      setMessage("#episode-bulk-message", error.message || "Format bulk invalide.", true);
      return;
    }

    const payload = episodes.map((episode) => ({
      season_id: seasonId,
      episode_number: episode.episode_number,
      title: episode.title,
      air_date: episode.air_date
    }));

    try {
      const { error } = await supabase
        .from("series_episodes")
        .upsert(payload, { onConflict: "season_id,episode_number" });
      if (error) throw error;

      setMessage("#episode-bulk-message", `${episodes.length} episode(s) importe(s).`);
      await refreshSeriesData();
      renderEpisodeOptions(seasonId);
    } catch (error) {
      setMessage("#episode-bulk-message", error.message || "Import bulk impossible.", true);
    }
  });

  document.querySelector("#episode-bulk-generate")?.addEventListener("click", () => {
    const count = Number(document.querySelector("#episode-bulk-count")?.value || 1);
    const previousRows = getBulkRowsValues();
    renderBulkEpisodeRows(count, previousRows);
  });

  document.querySelector("#episode-bulk-count")?.addEventListener("change", () => {
    const count = Number(document.querySelector("#episode-bulk-count")?.value || 1);
    const previousRows = getBulkRowsValues();
    renderBulkEpisodeRows(count, previousRows);
  });

  document.querySelector("#episode-bulk-rows")?.addEventListener("paste", (event) => {
    fillBulkTableFromPaste(event);
  });

  renderBulkEpisodeRows(Number(document.querySelector("#episode-bulk-count")?.value || 6));
}

async function initAdminPage() {
  const session = await ensureAdminOrManager();
  if (!session) return;

  await loadProfilesForMediaAdmin();
  await loadMediaOutlets();
  bindCreateMedia();
  bindManagedRequestsActions();
  bindManualMembershipActions();
  bindManagedMembersActions();
  await loadManagedMediaRequests();

  if (accessState.isAdmin) {
    bindCreationTabs();
    await loadAdminUsers();
    bindAdminResetActions();
    bindSeriesForms();
    await refreshSeriesData();
  }
}

initAdminPage();
