import { HCAPTCHA_SITE_KEY } from "../config.js";
import { setMessage } from "./utils.js";

const HCAPTCHA_SCRIPT_SRC = "https://js.hcaptcha.com/1/api.js?render=explicit";

let scriptLoadPromise = null;

function hasValidSiteKey() {
  if (!HCAPTCHA_SITE_KEY) return false;
  return !HCAPTCHA_SITE_KEY.includes("YOUR_HCAPTCHA_SITE_KEY");
}

function loadHCaptchaScript() {
  if (window.hcaptcha) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${HCAPTCHA_SCRIPT_SRC}"]`);
    const script = existingScript || document.createElement("script");

    function resolveWhenReady() {
      if (window.hcaptcha) {
        resolve();
        return;
      }

      window.setTimeout(() => {
        if (window.hcaptcha) {
          resolve();
          return;
        }

        reject(new Error("Le script hCaptcha est charge mais indisponible."));
      }, 150);
    }

    script.addEventListener("load", resolveWhenReady, { once: true });
    script.addEventListener("error", () => reject(new Error("Impossible de charger hCaptcha.")), {
      once: true
    });

    if (!existingScript) {
      script.src = HCAPTCHA_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
      return;
    }

    resolveWhenReady();
  });

  return scriptLoadPromise;
}

function createUnavailableController(messageSelector, message) {
  setMessage(messageSelector, message, true);

  return {
    ensureToken() {
      setMessage(messageSelector, message, true);
      return false;
    },
    getToken() {
      return null;
    },
    reset() {}
  };
}

export async function createCaptchaController({ containerSelector, messageSelector }) {
  const container = document.querySelector(containerSelector);
  if (!container) {
    return createUnavailableController(
      messageSelector,
      "Zone CAPTCHA introuvable. Recharge la page."
    );
  }

  if (!hasValidSiteKey()) {
    return createUnavailableController(
      messageSelector,
      "Captcha non configure. Ajoute HCAPTCHA_SITE_KEY dans config.js."
    );
  }

  try {
    await loadHCaptchaScript();
  } catch (error) {
    return createUnavailableController(messageSelector, error.message || "Captcha indisponible.");
  }

  let token = null;

  const widgetId = window.hcaptcha.render(container, {
    sitekey: HCAPTCHA_SITE_KEY,
    callback(nextToken) {
      token = nextToken;
    },
    "expired-callback"() {
      token = null;
    },
    "error-callback"() {
      token = null;
    }
  });

  return {
    ensureToken() {
      if (token) return true;
      setMessage(messageSelector, "Valide le CAPTCHA avant de continuer.", true);
      return false;
    },
    getToken() {
      return token;
    },
    reset() {
      token = null;
      if (window.hcaptcha && widgetId !== null && widgetId !== undefined) {
        window.hcaptcha.reset(widgetId);
      }
    }
  };
}
