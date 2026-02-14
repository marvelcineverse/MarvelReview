import { injectLayout, setMessage } from "./utils.js";
import { bindAuthVisibility, getCurrentProfile, getSession, signOut } from "./auth.js";

async function initCommonLayout() {
  injectLayout();
  const statusEl = document.querySelector("#auth-status");

  try {
    const session = await getSession();
    const isLoggedIn = Boolean(session);
    bindAuthVisibility(isLoggedIn);

    if (statusEl) {
      statusEl.textContent = isLoggedIn ? `Connecte: ${session.user.email}` : "Non connecte";
    }

    if (isLoggedIn) {
      const profile = await getCurrentProfile();
      document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
        el.style.display = profile?.is_admin ? "inline-flex" : "none";
      });
    } else {
      document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
        el.style.display = "none";
      });
    }

    const logoutButton = document.querySelector("#logout-button");
    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        try {
          await signOut();
          window.location.href = "/index.html";
        } catch (error) {
          setMessage("#page-message", error.message || "Erreur de deconnexion.", true);
        }
      });
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = "Erreur session";
    setMessage("#page-message", error.message || "Erreur de chargement session.", true);
  }
}

initCommonLayout();
