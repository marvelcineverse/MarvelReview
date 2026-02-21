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
const rankingState = {
  allRows: [],
  filters: {
    films: true,
    series: true,
    franchise: "",
    phase: ""
  }
};

const filmsFilterEl = document.querySelector("#filter-films");
const seriesFilterEl = document.querySelector("#filter-series");
const franchiseFilterEl = document.querySelector("#ranking-franchise-filter");
const phaseFilterEl = document.querySelector("#ranking-phase-filter");
const phaseFilterWrapEl = document.querySelector("#ranking-phase-filter-wrap");

function fillSelect(selectEl, values, allLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

function updatePhaseVisibility() {
  const showPhase = rankingState.filters.franchise === "MCU";
  if (phaseFilterWrapEl) {
    phaseFilterWrapEl.style.display = showPhase ? "grid" : "none";
  }

  if (!showPhase) {
    rankingState.filters.phase = "";
    if (phaseFilterEl) phaseFilterEl.value = "";
  }
}

function setupRankingFilterOptions() {
  const franchises = Array.from(
    new Set(
      rankingState.allRows
        .map((row) => row.franchise)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const mcuPhases = Array.from(
    new Set(
      rankingState.allRows
        .filter((row) => row.franchise === "MCU")
        .map((row) => row.phase)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  fillSelect(franchiseFilterEl, franchises, "Toutes les franchises");
  fillSelect(phaseFilterEl, mcuPhases, "Toutes les phases");

  if (franchiseFilterEl) franchiseFilterEl.value = rankingState.filters.franchise;
  if (phaseFilterEl) phaseFilterEl.value = rankingState.filters.phase;
  updatePhaseVisibility();
}

function getFilteredRows() {
  const phaseSelected = Boolean(rankingState.filters.phase);

  return rankingState.allRows.filter((row) => {
    if (row.type === "film" && !rankingState.filters.films) return false;
    if (row.type === "series" && !rankingState.filters.series) return false;

    if (rankingState.filters.franchise && row.franchise !== rankingState.filters.franchise) return false;

    if (!phaseSelected) return true;
    return row.phase === rankingState.filters.phase;
  });
}

function renderMediaRanking() {
  const bodyEl = document.querySelector("#media-ranking-body");
  const filteredRows = getFilteredRows();

  if (!filteredRows.length) {
    bodyEl.innerHTML = `<tr><td colspan="4">Aucun résultat pour ce filtre.</td></tr>`;
    return;
  }

  const ranked = [...filteredRows].sort((a, b) => b.average - a.average || b.count - a.count);
  const rankLabels = buildDenseRankLabels(ranked, (film) => film.average, 2);

  bodyEl.innerHTML = ranked
    .map(
      (film, index) => `
        <tr>
          <td>${rankLabels[index]}</td>
          <td><a href="${film.href}" class="film-link">${escapeHTML(film.title)}</a> <small>(${formatDate(film.release_date)})</small></td>
          <td><span class="score-badge ${getScoreClass(film.average)}">${formatScore(film.average, 2, 2)} / 10</span></td>
          <td>${film.count}</td>
        </tr>
      `
    )
    .join("");
}

function bindFilters() {
  filmsFilterEl?.addEventListener("change", () => {
    rankingState.filters.films = filmsFilterEl.checked;
    renderMediaRanking();
  });

  seriesFilterEl?.addEventListener("change", () => {
    rankingState.filters.series = seriesFilterEl.checked;
    renderMediaRanking();
  });

  franchiseFilterEl?.addEventListener("change", () => {
    rankingState.filters.franchise = franchiseFilterEl.value || "";
    updatePhaseVisibility();
    renderMediaRanking();
  });

  phaseFilterEl?.addEventListener("change", () => {
    rankingState.filters.phase = phaseFilterEl.value || "";
    renderMediaRanking();
  });
}

async function loadMediaList(selectedId = null) {
  const { data, error } = await supabase
    .from("media_outlets")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;

  if (!data?.length) {
    mediaButtonsEl.innerHTML = `<p>Aucun média</p>`;
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
    .select("id, name, twitter_url, instagram_url, youtube_url, tiktok_url, website_url, avatar_url, description")
    .eq("id", mediaId)
    .single();

  if (mediaError) throw mediaError;

  const { count: memberCount, error: countError } = await supabase
    .from("profile_media_memberships")
    .select("id", { count: "exact", head: true })
    .eq("media_id", mediaId)
    .eq("status", "approved");

  if (countError) throw countError;

  const socialLinks = [
    media.website_url
      ? `<a class="film-link media-social-link" href="${escapeHTML(media.website_url)}" target="_blank" rel="noreferrer"><i class="fa-solid fa-globe" aria-hidden="true"></i> Site web</a>`
      : "",
    media.twitter_url
      ? `<a class="film-link media-social-link" href="${escapeHTML(media.twitter_url)}" target="_blank" rel="noreferrer"><i class="fa-brands fa-x-twitter" aria-hidden="true"></i> Twitter / X</a>`
      : "",
    media.instagram_url
      ? `<a class="film-link media-social-link" href="${escapeHTML(media.instagram_url)}" target="_blank" rel="noreferrer"><i class="fa-brands fa-instagram" aria-hidden="true"></i> Instagram</a>`
      : "",
    media.youtube_url
      ? `<a class="film-link media-social-link" href="${escapeHTML(media.youtube_url)}" target="_blank" rel="noreferrer"><i class="fa-brands fa-youtube" aria-hidden="true"></i> YouTube</a>`
      : "",
    media.tiktok_url
      ? `<a class="film-link media-social-link" href="${escapeHTML(media.tiktok_url)}" target="_blank" rel="noreferrer"><i class="fa-brands fa-tiktok" aria-hidden="true"></i> TikTok</a>`
      : ""
  ]
    .filter(Boolean);

  detailsEl.innerHTML = `
    <h2>${escapeHTML(media.name)}</h2>
    ${media.avatar_url ? `<img src="${escapeHTML(media.avatar_url)}" alt="Profil ${escapeHTML(media.name)}" class="avatar media-avatar" />` : ""}
    <p>${escapeHTML(media.description || "Aucune description.")}</p>
    <p>Profils rattachés: <strong>${memberCount || 0}</strong></p>
    ${socialLinks.length ? `<div class="media-social-links">${socialLinks.join("")}</div>` : `<p>Aucun lien social.</p>`}
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
    usersEl.innerHTML = "<li>Aucun utilisateur rattaché.</li>";
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
    usersEl.innerHTML = "<li>Aucun utilisateur rattaché.</li>";
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
    bodyEl.innerHTML = `<tr><td colspan="4">Aucun membre approuvé pour ce média.</td></tr>`;
    return;
  }

  const { data: films, error: filmsError } = await supabase
    .from("films")
    .select("id, title, release_date, franchise, phase")
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

  const rows = Array.from(byFilmId.values())
    .filter((film) => film.count > 0)
    .map((film) => ({
      ...film,
      type: "film",
      href: `/film.html?id=${film.id}`,
      average: film.average / film.count,
      franchise: String(film.franchise || "").trim(),
      phase: String(film.phase || "").trim()
    }));

  if (!rows.length) {
    bodyEl.innerHTML = `<tr><td colspan="4">Aucune note pour ce média.</td></tr>`;
    return;
  }

  rankingState.allRows = rows;
  setupRankingFilterOptions();
  renderMediaRanking();
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
    setMessage("#page-message", error.message || "Erreur de chargement des médias.", true);
  }
}

loadPage();
bindFilters();
