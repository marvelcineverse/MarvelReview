import { supabase } from "../supabaseClient.js";
import { getCurrentProfile, requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

let currentProfile = null;

function setControlMessage() {
  const controlledUserId = localStorage.getItem("admin_controlled_user_id");
  const msg = controlledUserId
    ? `Controle actif sur: ${controlledUserId}`
    : "Aucun controle actif.";
  document.querySelector("#control-message").textContent = msg;
}

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

async function loadUsersForControl() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .order("username", { ascending: true });

  if (error) throw error;

  const selectEl = document.querySelector("#controlled-user-id");
  selectEl.innerHTML = (data || [])
    .map((user) => `<option value="${user.id}">${escapeHTML(user.username)}</option>`)
    .join("");
}

function bindControlActions() {
  document.querySelector("#set-control").addEventListener("click", () => {
    const selected = document.querySelector("#controlled-user-id").value;
    if (!selected) return;
    localStorage.setItem("admin_controlled_user_id", selected);
    setControlMessage();
  });

  document.querySelector("#clear-control").addEventListener("click", () => {
    localStorage.removeItem("admin_controlled_user_id");
    setControlMessage();
  });
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
        p_username: username,
        p_media: "Independant"
      });

      if (error) throw error;

      document.querySelector("#create-user-message").textContent = `Compte cree: ${data}`;
      document.querySelector("#create-user-form").reset();
      await loadUsersForControl();
    } catch (error) {
      setMessage("#create-user-message", error.message || "Creation impossible.", true);
    }
  });
}

async function loadFilms() {
  const { data, error } = await supabase
    .from("films")
    .select("id, title, release_date, franchise, phase, type")
    .order("release_date", { ascending: true });

  if (error) throw error;

  const listEl = document.querySelector("#films-admin-list");
  listEl.innerHTML = (data || [])
    .map(
      (film) => `
        <article class="card">
          <strong>${escapeHTML(film.title)}</strong>
          <p>${film.release_date || "-"} | ${escapeHTML(film.franchise || "-")} | ${escapeHTML(film.type || "-")}</p>
          <button type="button" data-film-id="${film.id}">Editer</button>
        </article>
      `
    )
    .join("");

  listEl.querySelectorAll("button[data-film-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const { data: film, error: filmError } = await supabase
        .from("films")
        .select("id, title, slug, release_date, franchise, phase, type, poster_url, synopsis")
        .eq("id", button.dataset.filmId)
        .single();

      if (filmError) {
        setMessage("#film-message", filmError.message, true);
        return;
      }

      document.querySelector("#film-id").value = film.id;
      document.querySelector("#film-title").value = film.title || "";
      document.querySelector("#film-slug").value = film.slug || "";
      document.querySelector("#film-release-date").value = film.release_date || "";
      document.querySelector("#film-franchise").value = film.franchise || "";
      document.querySelector("#film-phase").value = film.phase || "";
      document.querySelector("#film-type").value = film.type || "";
      document.querySelector("#film-poster-url").value = film.poster_url || "";
      document.querySelector("#film-synopsis").value = film.synopsis || "";
    });
  });
}

function bindFilmForm() {
  document.querySelector("#film-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      id: document.querySelector("#film-id").value || undefined,
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

      setMessage("#film-message", "Film enregistre.");
      document.querySelector("#film-form").reset();
      document.querySelector("#film-id").value = "";
      await loadFilms();
    } catch (error) {
      setMessage("#film-message", error.message || "Sauvegarde film impossible.", true);
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

  await loadUsersForControl();
  bindControlActions();
  setControlMessage();

  bindCreateUser();
  bindFilmForm();
  await loadFilms();
  await loadMediaRequests();
}

initAdminPage();
