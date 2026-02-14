import { supabase } from "../supabaseClient.js";
import { getCurrentProfile, requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

function renderUsers(rows) {
  const body = document.querySelector("#users-table-body");
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
              data-email="${escapeHTML(row.email || "")}"
            >
              Envoyer reset
            </button>
          </td>
        </tr>
      `
    )
    .join("");
}

async function loadUsers() {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  renderUsers(data || []);
}

function bindResetActions() {
  document.querySelector("#users-table-body")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-email]");
    if (!button) return;

    const email = button.dataset.email?.trim();
    if (!email) {
      setMessage("#page-message", "Email manquant pour cet utilisateur.", true);
      return;
    }

    try {
      const redirectTo = `${window.location.origin}/update-password.html`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      setMessage("#page-message", `Email de reinitialisation envoye a ${email}.`);
    } catch (error) {
      setMessage(
        "#page-message",
        error.message || "Impossible d'envoyer l'email de reinitialisation.",
        true
      );
    }
  });
}

async function initUsersPage() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const profile = await getCurrentProfile();
  if (!profile?.is_admin) {
    setMessage("#page-message", "Acces reserve aux administrateurs.", true);
    document.querySelector("#users-root").style.display = "none";
    return;
  }

  await loadUsers();
  bindResetActions();
}

initUsersPage().catch((error) => {
  setMessage("#page-message", error.message || "Impossible de charger les utilisateurs.", true);
});
