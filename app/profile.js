import { supabase } from "../supabaseClient.js";
import { requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

async function loadProfile() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const user = session.user;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, media, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      document.querySelector("#username").value = data.username || "";
      document.querySelector("#media").value = data.media || "";
      document.querySelector("#avatar_url").value = data.avatar_url || "";
      renderAvatarPreview(data.avatar_url);
    }

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
  const media = document.querySelector("#media").value.trim();
  const avatarURL = document.querySelector("#avatar_url").value.trim();

  if (!username || !media) {
    setMessage("#form-message", "Username et media sont obligatoires.", true);
    return;
  }

  try {
    const payload = {
      id: session.user.id,
      username,
      media,
      avatar_url: avatarURL || null
    };

    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) throw error;

    setMessage("#form-message", "Profil enregistre.");
  } catch (error) {
    setMessage("#form-message", error.message || "Sauvegarde impossible.", true);
  }
});

loadProfile();
