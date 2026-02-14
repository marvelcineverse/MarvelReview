import { supabase } from "../supabaseClient.js";
import { redirectIfLoggedIn } from "./auth.js";
import { setMessage } from "./utils.js";

redirectIfLoggedIn();

function showAuthQueryMessage() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("confirmed") === "1") {
    setMessage("#form-message", "Email confirme. Tu peux te connecter.");
    return;
  }

  if (params.get("reset") === "success") {
    setMessage("#form-message", "Mot de passe mis a jour. Connecte-toi avec ton nouveau mot de passe.");
  }
}

document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    window.location.href = "/index.html";
  } catch (error) {
    setMessage("#form-message", error.message || "Connexion impossible.", true);
  }
});

showAuthQueryMessage();
