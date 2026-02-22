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
const SUPABASE_PAGE_SIZE = 1000;
const IN_FILTER_CHUNK_SIZE = 200;

const filmsFilterEl = document.querySelector("#filter-films");
const seriesFilterEl = document.querySelector("#filter-series");
const franchiseFilterEl = document.querySelector("#ranking-franchise-filter");
const phaseFilterEl = document.querySelector("#ranking-phase-filter");
const phaseFilterWrapEl = document.querySelector("#ranking-phase-filter-wrap");

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function chunkArray(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function fetchPagedRows(buildQuery) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;

    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function fetchAllRows(table, columns, orderBy = "id", ascending = true) {
  return fetchPagedRows((from, to) =>
    supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending })
      .range(from, to)
  );
}

async function fetchAllRowsByIn(table, columns, field, values, orderBy = "id", ascending = true) {
  if (!values.length) return [];

  const rows = [];
  for (const chunk of chunkArray(values, IN_FILTER_CHUNK_SIZE)) {
    const paged = await fetchPagedRows((from, to) =>
      supabase
        .from(table)
        .select(columns)
        .in(field, chunk)
        .order(orderBy, { ascending })
        .range(from, to)
    );
    rows.push(...paged);
  }

  return rows;
}

function buildSeasonScoresByUser(season, episodesBySeasonId, episodeRatingsByEpisodeId, seasonRowsBySeasonId) {
  const seasonEpisodes = episodesBySeasonId.get(season.id) || [];
  const episodeByUser = new Map();

  for (const episode of seasonEpisodes) {
    const ratings = episodeRatingsByEpisodeId.get(episode.id) || [];
    for (const rating of ratings) {
      const current = episodeByUser.get(rating.user_id) || { total: 0, count: 0 };
      current.total += Number(rating.score || 0);
      current.count += 1;
      episodeByUser.set(rating.user_id, current);
    }
  }

  const seasonRows = seasonRowsBySeasonId.get(season.id) || [];
  const manualByUser = new Map(seasonRows.map((row) => [row.user_id, row]));
  const allUserIds = new Set([...episodeByUser.keys(), ...manualByUser.keys()]);

  const scoresByUser = new Map();
  for (const userId of allUserIds) {
    const manualRow = manualByUser.get(userId);
    const manual = manualRow?.manual_score === null || manualRow?.manual_score === undefined
      ? null
      : Number(manualRow.manual_score);
    const adjustment = Number(manualRow?.adjustment || 0);
    const episodeValues = episodeByUser.get(userId);
    const episodeAverage = episodeValues ? episodeValues.total / episodeValues.count : null;

    let effective = null;
    if (Number.isFinite(manual)) {
      effective = clamp(manual, 0, 10);
    } else if (Number.isFinite(episodeAverage)) {
      effective = clamp(episodeAverage + adjustment, 0, 10);
    }

    if (Number.isFinite(effective)) {
      scoresByUser.set(userId, effective);
    }
  }

  return scoresByUser;
}

function getSeasonLabel(season) {
  const explicitName = String(season?.name || "").trim();
  if (explicitName) return explicitName;

  const seasonNumber = Number(season?.season_number);
  if (Number.isFinite(seasonNumber)) {
    return `Saison ${seasonNumber}`;
  }

  return "Saison";
}

function buildSeriesRowsFromPhases(seriesList, seasons, episodes, episodeRatings, seasonUserRatings) {
  const seriesById = new Map((seriesList || []).map((serie) => [serie.id, serie]));

  const seasonsBySeriesId = new Map();
  for (const season of seasons || []) {
    const rows = seasonsBySeriesId.get(season.series_id) || [];
    rows.push(season);
    seasonsBySeriesId.set(season.series_id, rows);
  }

  const episodesBySeasonId = new Map();
  for (const episode of episodes || []) {
    const rows = episodesBySeasonId.get(episode.season_id) || [];
    rows.push(episode);
    episodesBySeasonId.set(episode.season_id, rows);
  }

  const episodeRatingsByEpisodeId = new Map();
  for (const rating of episodeRatings || []) {
    const rows = episodeRatingsByEpisodeId.get(rating.episode_id) || [];
    rows.push(rating);
    episodeRatingsByEpisodeId.set(rating.episode_id, rows);
  }

  const seasonRowsBySeasonId = new Map();
  for (const row of seasonUserRatings || []) {
    const rows = seasonRowsBySeasonId.get(row.season_id) || [];
    rows.push(row);
    seasonRowsBySeasonId.set(row.season_id, rows);
  }

  const seasonScoresBySeasonId = new Map();
  for (const season of seasons || []) {
    seasonScoresBySeasonId.set(
      season.id,
      buildSeasonScoresByUser(season, episodesBySeasonId, episodeRatingsByEpisodeId, seasonRowsBySeasonId)
    );
  }

  const rows = [];
  for (const [seriesId, serieSeasons] of seasonsBySeriesId.entries()) {
    const serie = seriesById.get(seriesId);
    if (!serie) continue;

    const seasonsByPhase = new Map();
    for (const season of serieSeasons) {
      const phase = String(season.phase || "").trim();
      if (!phase) continue;
      const phaseRows = seasonsByPhase.get(phase) || [];
      phaseRows.push(season);
      seasonsByPhase.set(phase, phaseRows);
    }

    for (const [phase, phaseSeasons] of seasonsByPhase.entries()) {
      const scoresByUser = new Map();
      const seasonRows = [];

      for (const season of phaseSeasons) {
        const seasonScores = seasonScoresBySeasonId.get(season.id) || new Map();
        const seasonValues = [...seasonScores.values()];
        if (seasonValues.length) {
          const seasonAverage = seasonValues.reduce((sum, value) => sum + value, 0) / seasonValues.length;
          seasonRows.push({
            id: `season-${season.id}-${phase}`,
            title: `${serie.title} - ${getSeasonLabel(season)}`,
            type: "season",
            href: `/season.html?id=${season.id}`,
            release_date: season.start_date || null,
            average: seasonAverage,
            count: seasonValues.length,
            franchise: String(serie.franchise || "").trim(),
            phase
          });
        }

        for (const [userId, score] of seasonScores.entries()) {
          const current = scoresByUser.get(userId) || [];
          current.push(score);
          scoresByUser.set(userId, current);
        }
      }

      const userAverages = [...scoresByUser.values()]
        .filter((values) => values.length > 0)
        .map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);

      if (!userAverages.length) continue;

      const average = userAverages.reduce((sum, value) => sum + value, 0) / userAverages.length;
      const firstDate = phaseSeasons
        .map((season) => season.start_date)
        .filter(Boolean)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;

      rows.push({
        id: `series-${seriesId}-${phase}`,
        title: serie.title,
        type: "series",
        href: `/series.html?id=${seriesId}`,
        release_date: firstDate,
        average,
        count: userAverages.length,
        franchise: String(serie.franchise || "").trim(),
        phase
      });
      rows.push(...seasonRows);
    }
  }

  return rows;
}

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
    const isFilmRow = row.type === "film";
    const isSeasonRow = row.type === "season";

    if (isFilmRow && !rankingState.filters.films) return false;
    if (!isFilmRow && !rankingState.filters.series) return false;

    if (rankingState.filters.franchise && row.franchise !== rankingState.filters.franchise) return false;

    if (!isFilmRow && !phaseSelected) return false;
    if (!phaseSelected) return true;
    if (!isFilmRow && !isSeasonRow) return false;
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
  const rankLabels = buildDenseRankLabels(ranked, (row) => row.average, 2);

  bodyEl.innerHTML = ranked
    .map(
      (row, index) => `
        <tr>
          <td>${rankLabels[index]}</td>
          <td>
            <a href="${row.href}" class="film-link">${escapeHTML(row.title)}</a>
            <small>(${row.type === "film" ? "Film" : row.type === "season" ? "Saison" : "Série"}${row.release_date ? ` - ${formatDate(row.release_date)}` : ""}${row.type === "film" ? "" : ` - ${escapeHTML(row.phase)}`})</small>
          </td>
          <td><span class="score-badge ${getScoreClass(row.average)}">${formatScore(row.average, 2, 2)} / 10</span></td>
          <td>${row.count}</td>
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
  const data = await fetchAllRows("media_outlets", "id, name");
  data.sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"));

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

  const memberships = await fetchPagedRows((from, to) =>
    supabase
      .from("profile_media_memberships")
      .select("profile_id")
      .eq("media_id", mediaId)
      .eq("status", "approved")
      .order("id", { ascending: true })
      .range(from, to)
  );

  const profileIds = [...new Set((memberships || []).map((row) => row.profile_id))];
  if (!profileIds.length) {
    usersEl.innerHTML = "<li>Aucun utilisateur rattaché.</li>";
    return;
  }

  const profiles = await fetchAllRowsByIn("profiles", "id, username", "id", profileIds);

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

  const memberships = await fetchPagedRows((from, to) =>
    supabase
      .from("profile_media_memberships")
      .select("profile_id")
      .eq("media_id", mediaId)
      .eq("status", "approved")
      .order("id", { ascending: true })
      .range(from, to)
  );

  const profileIds = (memberships || []).map((row) => row.profile_id);

  if (!profileIds.length) {
    bodyEl.innerHTML = `<tr><td colspan="4">Aucun membre approuvé pour ce média.</td></tr>`;
    return;
  }

  const [films, ratings, seriesList, seasons, episodes, episodeRatings, seasonUserRatings] = await Promise.all([
    fetchAllRows("films", "id, title, release_date, franchise, phase"),
    fetchAllRowsByIn("ratings", "film_id, user_id, score", "user_id", profileIds),
    fetchAllRows("series", "id, title, franchise"),
    fetchAllRows("series_seasons", "id, series_id, name, season_number, phase, start_date"),
    fetchAllRows("series_episodes", "id, season_id"),
    fetchAllRowsByIn("episode_ratings", "episode_id, user_id, score", "user_id", profileIds),
    fetchAllRowsByIn("season_user_ratings", "season_id, user_id, manual_score, adjustment", "user_id", profileIds)
  ]);

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

  const filmRows = Array.from(byFilmId.values())
    .filter((film) => film.count > 0)
    .map((film) => ({
      ...film,
      type: "film",
      href: `/film.html?id=${film.id}`,
      average: film.average / film.count,
      franchise: String(film.franchise || "").trim(),
      phase: String(film.phase || "").trim()
    }));

  const seriesRows = buildSeriesRowsFromPhases(
    seriesList || [],
    seasons || [],
    episodes || [],
    episodeRatings || [],
    seasonUserRatings || []
  );

  const rows = [...filmRows, ...seriesRows];

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
