import { supabase } from "../supabaseClient.js";
import { redirectIfLoggedIn } from "./auth.js";
import { createCaptchaController } from "./captcha.js";
import { setMessage } from "./utils.js";

redirectIfLoggedIn();

const captchaControllerPromise = createCaptchaController({
  containerSelector: "#login-captcha",
  messageSelector: "#form-message"
});

function showAuthQueryMessage() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("blocked") === "suspended") {
    setMessage("#form-message", "Ce compte est actuellement suspendu. Tu ne peux pas utiliser Marvel Review pour le moment.", true);
    return;
  }

  if (params.get("blocked") === "banned") {
    setMessage("#form-message", "Ce compte a ete banni. Tu ne peux plus utiliser Marvel Review.", true);
    return;
  }

  if (params.get("confirmed") === "1") {
    setMessage("#form-message", "Email confirmé. Tu peux te connecter.");
    return;
  }

  if (params.get("reset") === "success") {
    setMessage("#form-message", "Mot de passe mis à jour. Connecte-toi avec ton nouveau mot de passe.");
  }
}

document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const captchaController = await captchaControllerPromise;

  if (!captchaController.ensureToken()) return;

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: captchaController.getToken() }
    });

    if (error) throw error;
    window.location.href = "/index.html";
  } catch (error) {
    setMessage("#form-message", error.message || "Connexion impossible.", true);
  } finally {
    captchaController.reset();
  }
});

showAuthQueryMessage();
