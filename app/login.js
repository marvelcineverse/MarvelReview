import { supabase } from "../supabaseClient.js";
import { redirectIfLoggedIn } from "./auth.js";
import { setMessage } from "./utils.js";

redirectIfLoggedIn();

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
