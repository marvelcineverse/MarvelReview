import { supabase } from "../supabaseClient.js";
import { escapeHTML, formatScore, getScoreClass, setMessage } from "./utils.js";

async function loadRanking() {
  const bodyEl = document.querySelector("#ranking-body");

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
      .map((film) => ({ ...film, average: film.count ? film.average / film.count : null }))
      .sort((a, b) => {
        const aAverage = a.average ?? -1;
        const bAverage = b.average ?? -1;
        if (bAverage !== aAverage) return bAverage - aAverage;
        return b.count - a.count;
      });

    if (!ranked.length) {
      bodyEl.innerHTML = `<tr><td colspan="4">Classement indisponible (aucun film).</td></tr>`;
      return;
    }

    bodyEl.innerHTML = ranked
      .map((film, index) => {
        const averageCell = film.count
          ? `<span class="score-badge ${getScoreClass(film.average)}">${formatScore(film.average, 2, 2)} / 10</span>`
          : `<span class="score-badge stade-neutre">Pas de note</span>`;

        return `
          <tr>
            <td>${index + 1}</td>
            <td>
              <a href="/film.html?id=${film.id}" class="film-link">${escapeHTML(film.title)}</a>
              <small>(${film.release_year || "-"})</small>
            </td>
            <td>${averageCell}</td>
            <td>${film.count}</td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du classement.", true);
  }
}

loadRanking();
