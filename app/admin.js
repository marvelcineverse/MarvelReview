import { supabase } from "../supabaseClient.js";
import { getCurrentProfile, requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";


async function ensureAdmin() {
  const session = await requireAuth("/login.html");
  if (!session) return null;

  const currentProfile = await getCurrentProfile();
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

async function initAdminPage() {
  const session = await ensureAdmin();
  if (!session) return;

  await loadUsers();
  bindCreateMedia();
}

initAdminPage();


