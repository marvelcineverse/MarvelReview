import { supabase } from "../supabaseClient.js";
import { requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

let profileData = null;

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

async function loadMembership(userId) {
  const statusEl = document.querySelector("#media-membership-status");

  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, status, media_id, media_outlets(name)")
    .eq("profile_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    statusEl.textContent = "Aucune demande de rattachement.";
    return;
  }

  const mediaName = data.media_outlets?.name || "Media";
  statusEl.textContent = `Demande: ${mediaName} (${data.status})`;

  if (data.status === "pending") {
    document.querySelector("#media_outlet_id").value = data.media_id;
  }
}

async function loadProfile() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const user = session.user;

  try {
    await loadMediaOutlets();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, media, avatar_url, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    profileData = data;

    if (data) {
      document.querySelector("#username").value = data.username || "";
      document.querySelector("#avatar_url").value = data.avatar_url || "";
      renderAvatarPreview(data.avatar_url);
      document.querySelector("#current-media").textContent = data.media || "Independant";
      document.querySelector("#admin-badge").textContent = data.is_admin ? "Oui" : "Non";
    }

    await loadMembership(user.id);

    document.querySelector("#profile-email").textContent = user.email || "";
  } catch (error) {
    setMessage("#form-message", error.message || "Erreur de chargement profil.", true);
  }
}

function renderAvatarPreview(url) {
  const preview = document.querySelector("#avatar-preview");
  if (!url) {
    preview.innerHTML = "<p>Pas d'avatar.</p>";
    return;
  }

  preview.innerHTML = `<img src="${escapeHTML(url)}" alt="Avatar" class="avatar" />`;
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
      media: profileData?.media || "Independant",
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
        { onConflict: "profile_id" }
      );

      if (membershipError) throw membershipError;
    }

    setMessage("#form-message", "Profil enregistre. Demande media mise a jour si selectionnee.");
    await loadMembership(session.user.id);
  } catch (error) {
    setMessage("#form-message", error.message || "Sauvegarde impossible.", true);
  }
});

loadProfile();
