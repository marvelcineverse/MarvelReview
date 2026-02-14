import { supabase } from "../supabaseClient.js";
import { escapeHTML, setMessage } from "./utils.js";

async function loadFilms() {
  const listEl = document.querySelector("#films-list");

  try {
    const { data, error } = await supabase
      .from("films")
      .select("id, title, release_year, poster_url")
      .order("release_year", { ascending: false })
      .order("title", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      listEl.innerHTML = "<p>Aucun film pour le moment.</p>";
      return;
    }

    listEl.innerHTML = data
      .map(
        (film) => `
          <article class="card film-card">
            <img src="${escapeHTML(film.poster_url || "https://via.placeholder.com/240x360?text=Marvel")}" alt="Affiche de ${escapeHTML(film.title)}" />
            <div>
              <h3>${escapeHTML(film.title)}</h3>
              <p>Sortie: ${film.release_year || "-"}</p>
              <a class="button" href="/film.html?id=${film.id}">Voir la page film</a>
            </div>
          </article>
        `
      )
      .join("");
  } catch (error) {
    setMessage("#page-message", error.message || "Impossible de charger les films.", true);
    listEl.innerHTML = "";
  }
}

loadFilms();
