import { supabase } from "../supabaseClient.js";
import { escapeHTML, setMessage } from "./utils.js";

async function loadRanking() {
  const listEl = document.querySelector("#ranking-list");

  try {
    const { data: films, error: filmsError } = await supabase
      .from("films")
      .select("id, title, release_year")
      .order("title", { ascending: true });
    if (filmsError) throw filmsError;

    const { data: ratings, error: ratingsError } = await supabase
      .from("ratings")
      .select("film_id, score");
    if (ratingsError) throw ratingsError;

    const byFilmId = new Map();
    for (const film of films || []) {
      byFilmId.set(film.id, { ...film, average: 0, count: 0 });
    }

    for (const rating of ratings || []) {
      const item = byFilmId.get(rating.film_id);
      if (!item) continue;
      item.average += Number(rating.score || 0);
      item.count += 1;
    }

    const ranked = Array.from(byFilmId.values())
      .map((film) => ({ ...film, average: film.count ? film.average / film.count : 0 }))
      .sort((a, b) => (b.average !== a.average ? b.average - a.average : b.count - a.count));

    if (!ranked.length) {
      listEl.innerHTML = "<p>Classement indisponible (aucun film).</p>";
      return;
    }

    listEl.innerHTML = ranked
      .map(
        (film, index) => `
          <article class="card ranking-item">
            <div>
              <strong>#${index + 1} ${escapeHTML(film.title)}</strong>
              <p>${film.release_year || "-"}</p>
            </div>
            <div>
              <strong>${film.count ? film.average.toFixed(1) : "-"}/10</strong>
              <p>${film.count} note(s)</p>
              <a class="button" href="/film.html?id=${film.id}">Voir</a>
            </div>
          </article>
        `
      )
      .join("");
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du classement.", true);
  }
}

loadRanking();
