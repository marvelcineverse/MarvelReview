import { supabase } from "../supabaseClient.js";
import { setMessage } from "./utils.js";

document.querySelector("#forgot-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const redirectTo = `${window.location.origin}/update-password.html`;

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;

    setMessage(
      "#form-message",
      "Si cet email existe, un lien de reinitialisation vient d'etre envoye."
    );
  } catch (error) {
    setMessage("#form-message", error.message || "Envoi impossible.", true);
  }
});
