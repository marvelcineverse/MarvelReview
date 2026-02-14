import { supabase } from "../supabaseClient.js";
import { getCurrentProfile, requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

let currentProfile = null;

async function ensureAdmin() {
  const session = await requireAuth("/login.html");
  if (!session) return null;

  currentProfile = await getCurrentProfile();
  if (!currentProfile?.is_admin) {
    setMessage("#page-message", "Acces reserve aux administrateurs.", true);
    document.querySelector("#admin-root").style.display = "none";
    return null;
  }

  return session;
}

async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .order("username", { ascending: true });

  if (error) throw error;

  const mediaAdminSelectEl = document.querySelector("#media-admin-profile-id");
  mediaAdminSelectEl.innerHTML = [
    `<option value="">Aucun admin pour le moment</option>`,
    ...(data || []).map((user) => `<option value="${user.id}">${escapeHTML(user.username)}</option>`)
  ].join("");
}

function bindCreateUser() {
  document.querySelector("#create-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.querySelector("#new-user-email").value.trim();
    const password = document.querySelector("#new-user-password").value;
    const username = document.querySelector("#new-user-username").value.trim();

    try {
      const { data, error } = await supabase.rpc("admin_create_user_account", {
        p_email: email,
        p_password: password,
        p_username: username
      });

      if (error) throw error;

      document.querySelector("#create-user-message").textContent = `Compte cree: ${data}`;
      document.querySelector("#create-user-form").reset();
      await loadUsers();
    } catch (error) {
      setMessage("#create-user-message", error.message || "Creation impossible.", true);
    }
  });
}

function bindCreateMedia() {
  document.querySelector("#create-media-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      name: document.querySelector("#media-name").value.trim(),
      admin_profile_id: document.querySelector("#media-admin-profile-id").value || null,
      twitter_url: document.querySelector("#media-twitter-url").value.trim() || null,
      instagram_url: document.querySelector("#media-instagram-url").value.trim() || null,
      youtube_url: document.querySelector("#media-youtube-url").value.trim() || null,
      website_url: document.querySelector("#media-website-url").value.trim() || null,
      description: document.querySelector("#media-description").value.trim() || null
    };

    if (!payload.name) {
      setMessage("#create-media-message", "Le nom du media est obligatoire.", true);
      return;
    }

    try {
      const { error } = await supabase.from("media_outlets").insert(payload);
      if (error) throw error;

      setMessage("#create-media-message", "Media cree.");
      document.querySelector("#create-media-form").reset();
    } catch (error) {
      setMessage("#create-media-message", error.message || "Creation media impossible.", true);
    }
  });
}

async function loadMediaRequests() {
  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, status, profile_id, media_id")
    .eq("status", "pending");

  if (error) throw error;

  const mediaIds = [...new Set((data || []).map((row) => row.media_id))];
  const profileIds = [...new Set((data || []).map((row) => row.profile_id))];

  const { data: medias, error: mediaError } = await supabase
    .from("media_outlets")
    .select("id, name, admin_profile_id")
    .in("id", mediaIds);
  if (mediaError) throw mediaError;

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", profileIds);
  if (profilesError) throw profilesError;

  const mediaById = new Map((medias || []).map((item) => [item.id, item]));
  const profileById = new Map((profiles || []).map((item) => [item.id, item]));

  const requests = (data || [])
    .map((row) => ({
      ...row,
      media: mediaById.get(row.media_id),
      profile: profileById.get(row.profile_id)
    }))
    .filter((row) => row.media?.admin_profile_id === currentProfile.id);

  const container = document.querySelector("#media-requests");
  if (!requests.length) {
    container.innerHTML = "<p>Aucune demande en attente.</p>";
    return;
  }

  container.innerHTML = requests
    .map(
      (row) => `
        <article class="card">
          <p><strong>${escapeHTML(row.profile?.username || row.profile_id)}</strong> -> ${escapeHTML(row.media?.name || "Media")}</p>
          <div class="inline-actions">
            <button type="button" data-action="approve" data-id="${row.id}">Approuver</button>
            <button type="button" data-action="reject" data-id="${row.id}" class="ghost-button">Refuser</button>
          </div>
        </article>
      `
    )
    .join("");

  container.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const approved = button.dataset.action === "approve";
      const membershipId = button.dataset.id;

      const { error: rpcError } = await supabase.rpc("admin_decide_media_membership", {
        p_membership_id: membershipId,
        p_approved: approved
      });

      if (rpcError) {
        setMessage("#page-message", rpcError.message, true);
        return;
      }

      await loadMediaRequests();
    });
  });
}

async function initAdminPage() {
  const session = await ensureAdmin();
  if (!session) return;

  await loadUsers();

  bindCreateUser();
  bindCreateMedia();
  await loadMediaRequests();
}

initAdminPage();
