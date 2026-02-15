import { supabase } from "../supabaseClient.js";
import {
  buildDenseRankLabels,
  escapeHTML,
  formatDate,
  formatScore,
  getMediaIdFromURL,
  getScoreClass,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";

const mediaButtonsEl = document.querySelector("#media-buttons");
let mediaList = [];
let currentMediaId = null;

async function loadMediaList(selectedId = null) {
  const { data, error } = await supabase
    .from("media_outlets")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;

  if (!data?.length) {
    mediaButtonsEl.innerHTML = `<p>Aucun media</p>`;
    return null;
  }

  mediaList = data;
  const effectiveId = selectedId && data.some((item) => item.id === selectedId) ? selectedId : data[0].id;
  renderMediaButtons(effectiveId);
  return effectiveId;
}

function renderMediaButtons(selectedId) {
  currentMediaId = selectedId;
  mediaButtonsEl.innerHTML = mediaList
    .map((item) => {
      const selectedClass = item.id === selectedId ? "is-selected" : "";
      return `<button type="button" class="ghost-button media-pill ${selectedClass}" data-media-id="${item.id}">${escapeHTML(item.name)}</button>`;
    })
    .join("");

  mediaButtonsEl.querySelectorAll("button[data-media-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const selectedId = button.dataset.mediaId;
      if (!selectedId || selectedId === currentMediaId) return;
      renderMediaButtons(selectedId);
      const nextURL = new URL(window.location.href);
      nextURL.searchParams.set("id", selectedId);
      history.replaceState({}, "", nextURL);
      await loadMediaDetails(selectedId);
      await loadMediaUsers(selectedId);
      await loadMediaRanking(selectedId);
    });
  });
}

async function loadMediaDetails(mediaId) {
  const detailsEl = document.querySelector("#media-details");

  const { data: media, error: mediaError } = await supabase
    .from("media_outlets")
    .select("id, name, twitter_url, instagram_url, youtube_url, website_url, description")
    .eq("id", mediaId)
    .single();

  if (mediaError) throw mediaError;

  const { count: memberCount, error: countError } = await supabase
    .from("profile_media_memberships")
    .select("id", { count: "exact", head: true })
    .eq("media_id", mediaId)
    .eq("status", "approved");

  if (countError) throw countError;

  detailsEl.innerHTML = `
    <h2>${escapeHTML(media.name)}</h2>
    <p>${escapeHTML(media.description || "Aucune description.")}</p>
    <p>Profils rattaches: <strong>${memberCount || 0}</strong></p>
    <p>
      ${media.website_url ? `<a href="${escapeHTML(media.website_url)}" target="_blank" rel="noreferrer">Site web</a>` : ""}
      ${media.twitter_url ? ` | <a href="${escapeHTML(media.twitter_url)}" target="_blank" rel="noreferrer">Twitter</a>` : ""}
      ${media.instagram_url ? ` | <a href="${escapeHTML(media.instagram_url)}" target="_blank" rel="noreferrer">Instagram</a>` : ""}
      ${media.youtube_url ? ` | <a href="${escapeHTML(media.youtube_url)}" target="_blank" rel="noreferrer">Youtube</a>` : ""}
    </p>
  `;
}

async function loadMediaUsers(mediaId) {
  const usersEl = document.querySelector("#media-users-list");

  const { data: memberships, error: membershipsError } = await supabase
    .from("profile_media_memberships")
    .select("profile_id")
    .eq("media_id", mediaId)
    .eq("status", "approved");

  if (membershipsError) throw membershipsError;

  const profileIds = [...new Set((memberships || []).map((row) => row.profile_id))];
  if (!profileIds.length) {
    usersEl.innerHTML = "<li>Aucun utilisateur rattache.</li>";
    return;
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", profileIds);

  if (profilesError) throw profilesError;

  const usernames = (profiles || [])
    .map((row) => row.username || "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "fr"));

  if (!usernames.length) {
    usersEl.innerHTML = "<li>Aucun utilisateur rattache.</li>";
    return;
  }

  usersEl.innerHTML = usernames.map((name) => `<li>${escapeHTML(name)}</li>`).join("");
}

async function loadMediaRanking(mediaId) {
  const bodyEl = document.querySelector("#media-ranking-body");

  const { data: memberships, error: membershipsError } = await supabase
    .from("profile_media_memberships")
    .select("profile_id")
    .eq("media_id", mediaId)
    .eq("status", "approved");

  if (membershipsError) throw membershipsError;

  const profileIds = (memberships || []).map((row) => row.profile_id);

  if (!profileIds.length) {
    bodyEl.innerHTML = `<tr><td colspan="4">Aucun membre approuve pour ce media.</td></tr>`;
    return;
  }

  const { data: films, error: filmsError } = await supabase
    .from("films")
    .select("id, title, release_date")
    .order("title", { ascending: true });
  if (filmsError) throw filmsError;

  const { data: ratings, error: ratingsError } = await supabase
    .from("ratings")
    .select("film_id, user_id, score")
    .in("user_id", profileIds);
  if (ratingsError) throw ratingsError;

  const releasedFilms = (films || []).filter((film) => isReleasedOnOrBeforeToday(film.release_date));

  const byFilmId = new Map();
  for (const film of releasedFilms) {
    byFilmId.set(film.id, { ...film, average: 0, count: 0 });
  }

  for (const rating of ratings || []) {
    const item = byFilmId.get(rating.film_id);
    if (!item) continue;
    item.average += Number(rating.score || 0);
    item.count += 1;
  }

  const ranked = Array.from(byFilmId.values())
    .filter((film) => film.count > 0)
    .map((film) => ({ ...film, average: film.average / film.count }))
    .sort((a, b) => b.average - a.average || b.count - a.count);

  if (!ranked.length) {
    bodyEl.innerHTML = `<tr><td colspan="4">Aucune note pour ce media.</td></tr>`;
    return;
  }

  const rankLabels = buildDenseRankLabels(ranked, (film) => film.average, 2);

  bodyEl.innerHTML = ranked
    .map(
      (film, index) => `
        <tr>
          <td>${rankLabels[index]}</td>
          <td><a href="/film.html?id=${film.id}" class="film-link">${escapeHTML(film.title)}</a> <small>(${formatDate(film.release_date)})</small></td>
          <td><span class="score-badge ${getScoreClass(film.average)}">${formatScore(film.average, 2, 2)} / 10</span></td>
          <td>${film.count}</td>
        </tr>
      `
    )
    .join("");
}

async function loadPage() {
  try {
    const mediaIdFromURL = getMediaIdFromURL();
    const mediaId = await loadMediaList(mediaIdFromURL);
    if (!mediaId) return;

    await loadMediaDetails(mediaId);
    await loadMediaUsers(mediaId);
    await loadMediaRanking(mediaId);
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement des medias.", true);
  }
}

loadPage();
