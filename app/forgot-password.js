import { supabase } from "../supabaseClient.js";
import { createCaptchaController } from "./captcha.js";
import { setMessage } from "./utils.js";

const captchaControllerPromise = createCaptchaController({
  containerSelector: "#forgot-password-captcha",
  messageSelector: "#form-message"
});

document.querySelector("#forgot-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const redirectTo = `${window.location.origin}/update-password.html`;
  const captchaController = await captchaControllerPromise;

  if (!captchaController.ensureToken()) return;

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
      captchaToken: captchaController.getToken()
    });

    if (error) throw error;

    setMessage(
      "#form-message",
      "Si cet email existe, un lien de reinitialisation vient d'etre envoye."
    );
  } catch (error) {
    setMessage("#form-message", error.message || "Envoi impossible.", true);
  } finally {
    captchaController.reset();
  }
});
