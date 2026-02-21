import { supabase } from "../supabaseClient.js";
import { createCaptchaController } from "./captcha.js";
import { setMessage } from "./utils.js";

const captchaControllerPromise = createCaptchaController({
  containerSelector: "#forgot-password-captcha",
  messageSelector: "#form-message"
});
const deliveryWarningEl = document.querySelector("#forgot-delivery-warning");

function toggleDeliveryWarning(show) {
  if (!deliveryWarningEl) return;
  deliveryWarningEl.hidden = !show;
}

document.querySelector("#forgot-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  toggleDeliveryWarning(false);

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
      "Si cet email existe, un lien de r\u00e9initialisation vient d'\u00eatre envoy\u00e9."
    );
    toggleDeliveryWarning(true);
  } catch (error) {
    setMessage("#form-message", error.message || "Envoi impossible.", true);
    toggleDeliveryWarning(false);
  } finally {
    captchaController.reset();
  }
});
