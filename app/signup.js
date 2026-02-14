import { supabase } from "../supabaseClient.js";
import { redirectIfLoggedIn } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

redirectIfLoggedIn();

const mediaSelectEl = document.querySelector("#media_outlet_id");

async function loadMediaOutlets() {
  try {
    const { data, error } = await supabase
      .from("media_outlets")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) throw error;

    mediaSelectEl.innerHTML = [
      `<option value="">Aucun media</option>`,
      ...(data || []).map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`)
    ].join("");
  } catch (error) {
    setMessage("#form-message", error.message || "Impossible de charger les medias.", true);
  }
}

document.querySelector("#signup-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const username = document.querySelector("#username").value.trim();
  const mediaOutletId = mediaSelectEl.value || null;

  if (!username) {
    setMessage("#form-message", "Username obligatoire.", true);
    return;
  }

  try {
    const emailRedirectTo = `${window.location.origin}/login.html?confirmed=1`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: {
          username,
          media_outlet_id: mediaOutletId
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

loadMediaOutlets();
