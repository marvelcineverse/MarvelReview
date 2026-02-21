import { supabase } from "../supabaseClient.js";
import { redirectIfLoggedIn } from "./auth.js";
import { createCaptchaController } from "./captcha.js";
import { setMessage } from "./utils.js";

redirectIfLoggedIn();
const captchaControllerPromise = createCaptchaController({
  containerSelector: "#signup-captcha",
  messageSelector: "#form-message"
});

document.querySelector("#signup-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const username = document.querySelector("#username").value.trim();
  const captchaController = await captchaControllerPromise;

  if (!username) {
    setMessage("#form-message", "Nom d'utilisateur / pseudonyme obligatoire.", true);
    return;
  }

  if (!captchaController.ensureToken()) return;

  try {
    const emailRedirectTo = `${window.location.origin}/login.html?confirmed=1`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken: captchaController.getToken(),
        emailRedirectTo,
        data: {
          username
        }
      }
    });

    if (error) throw error;

    setMessage(
      "#form-message",
      "Compte cree. Verifie ton email si la confirmation est activee, puis connecte-toi."
    );
  } catch (error) {
    setMessage("#form-message", error.message || "Inscription impossible.", true);
  } finally {
    captchaController.reset();
  }
});
