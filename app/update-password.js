import { supabase } from "../supabaseClient.js";
import { setMessage } from "./utils.js";

async function hasRecoverySession() {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();
  if (error) throw error;
  return Boolean(session);
}

document.querySelector("#update-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = document.querySelector("#password").value;
  const confirm = document.querySelector("#password-confirm").value;

  if (password !== confirm) {
    setMessage("#form-message", "Les mots de passe ne correspondent pas.", true);
    return;
  }

  if (password.length < 6) {
    setMessage("#form-message", "Le mot de passe doit contenir au moins 6 caracteres.", true);
    return;
  }

  try {
    const ready = await hasRecoverySession();
    if (!ready) {
      setMessage(
        "#form-message",
        "Lien invalide ou expire. Redemande un email de reinitialisation.",
        true
      );
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;

    setMessage("#form-message", "Mot de passe mis a jour. Redirection vers la connexion...");
    window.setTimeout(() => {
      window.location.href = "/login.html?reset=success";
    }, 1000);
  } catch (error) {
    setMessage("#form-message", error.message || "Mise a jour impossible.", true);
  }
});
