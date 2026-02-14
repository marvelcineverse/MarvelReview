import { supabase } from "../supabaseClient.js";
import { redirectIfLoggedIn } from "./auth.js";
import { setMessage } from "./utils.js";

redirectIfLoggedIn();

document.querySelector("#signup-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const username = document.querySelector("#username").value.trim();
  const media = document.querySelector("#media").value.trim();

  if (!username || !media) {
    setMessage("#form-message", "Username et media sont obligatoires.", true);
    return;
  }

  try {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          media
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
  }
});
