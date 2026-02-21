import { supabase } from "../supabaseClient.js";
import { requireAuth } from "./auth.js";
import {
  buildDenseRankLabels,
  escapeHTML,
  formatScore,
  getScoreClass,
  isQuarterStep,
  isReleasedOnOrBeforeToday,
  setMessage
} from "./utils.js";

let currentUserId = null;
const personalRankingState = {
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function fillSelect(selectEl, values, allLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

function updatePhaseVisibility() {
  const showPhase = personalRankingState.filters.franchise === "MCU";
  if (phaseFilterWrapEl) {
    phaseFilterWrapEl.style.display = showPhase ? "grid" : "none";
  }

  if (!showPhase) {
    personalRankingState.filters.phase = "";
    if (phaseFilterEl) phaseFilterEl.value = "";
  }
}

function setupRankingFilterOptions() {
  const franchises = Array.from(
    new Set(
      personalRankingState.allRows
        .map((row) => row.franchise)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const mcuPhases = Array.from(
    new Set(
      personalRankingState.allRows
        .filter((row) => row.franchise === "MCU")
        .map((row) => row.phase)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  fillSelect(franchiseFilterEl, franchises, "Toutes les franchises");
  fillSelect(phaseFilterEl, mcuPhases, "Toutes les phases");

  if (franchiseFilterEl) franchiseFilterEl.value = personalRankingState.filters.franchise;
  if (phaseFilterEl) phaseFilterEl.value = personalRankingState.filters.phase;
  updatePhaseVisibility();
}

function getFilteredPersonalRows() {
  const phaseSelected = Boolean(personalRankingState.filters.phase);

  return personalRankingState.allRows.filter((row) => {
    const isFilmRow = row.type === "film";
    const isSeriesRow = !isFilmRow;

    if (isFilmRow && !personalRankingState.filters.films) return false;
    if (isSeriesRow && !personalRankingState.filters.series) return false;

    if (personalRankingState.filters.franchise && row.franchise !== personalRankingState.filters.franchise) return false;

    if (!phaseSelected) {
      if (isSeriesRow && row.phase) return false;
      return true;
    }

    return row.phase === personalRankingState.filters.phase;
  });
}

async function loadMediaOutlets() {
  const selectEl = document.querySelector("#media_outlet_id");

  const { data, error } = await supabase
    .from("media_outlets")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw error;

  selectEl.innerHTML = [
    `<option value="">Aucun média</option>`,
    ...(data || []).map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`)
  ].join("");
}

async function loadMemberships(userId) {
  const statusEl = document.querySelector("#media-membership-status");
  const currentMediaEl = document.querySelector("#current-media");

  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, status, media_id, media_outlets(name)")
    .eq("profile_id", userId)
    .order("requested_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];

  if (!rows.length) {
    statusEl.textContent = "Aucune demande de rattachement.";
    currentMediaEl.textContent = "Indépendant";
    return;
  }

  const approved = rows
    .filter((row) => row.status === "approved")
    .map((row) => row.media_outlets?.name || "Média");

  currentMediaEl.textContent = approved.length ? approved.join(", ") : "Indépendant";

  statusEl.innerHTML = rows
    .map((row) => `- ${escapeHTML(row.media_outlets?.name || "Média")}: ${row.status}`)
    .join("<br>");
}

function renderAvatarPreview(url) {
  const preview = document.querySelector("#avatar-preview");
  if (!url) {
    preview.innerHTML = "<p>Pas d'avatar.</p>";
    return;
  }

  preview.innerHTML = `<img src="${escapeHTML(url)}" alt="Avatar" class="avatar" />`;
}

function renderPersonalRatings() {
  const body = document.querySelector("#personal-ratings-body");
  const filteredRows = getFilteredPersonalRows();

  if (!filteredRows.length) {
    body.innerHTML = `<tr><td colspan="4">Aucun élément pour ce filtre.</td></tr>`;
    return;
  }

  const sortedRows = [...filteredRows].sort((a, b) => {
    const aRated = a.score !== null;
    const bRated = b.score !== null;

    if (aRated && bRated) {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title, "fr");
    }
    if (aRated) return -1;
    if (bRated) return 1;

    const aTs = a.sort_date ? new Date(a.sort_date).getTime() : Number.POSITIVE_INFINITY;
    const bTs = b.sort_date ? new Date(b.sort_date).getTime() : Number.POSITIVE_INFINITY;
    if (aTs !== bTs) return aTs - bTs;
    return a.title.localeCompare(b.title, "fr");
  });

  const rankLabels = buildDenseRankLabels(sortedRows, (row) => row.score, 2);

  body.innerHTML = sortedRows
    .map((row, index) => {
      const rank = row.score === null ? "-" : rankLabels[index];
      const scoreText = row.score === null ? "" : String(row.score);
      const badge = row.score === null
        ? `<span class="score-badge stade-neutre">Pas noté</span>`
        : `<span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score)} / 10</span>`;
      const typeLabel = row.type === "film" ? "Film" : "Série";
      const href = row.type === "film" ? `/film.html?id=${row.film_id}` : `/series.html?id=${row.series_id}`;
      const modifierCell = row.type === "film"
        ? `
          <div class="inline-actions inline-edit">
            <input data-field="score" data-film-id="${row.film_id}" type="number" min="0" max="10" step="0.25" value="${scoreText}" placeholder="0 à 10" />
            <button type="button" class="icon-circle-btn save" data-action="save-rating" data-film-id="${row.film_id}" aria-label="Valider la note">
              <i class="fa-solid fa-check" aria-hidden="true"></i>
            </button>
            ${row.score === null ? "" : `
              <button type="button" class="icon-circle-btn delete" data-action="delete-rating" data-film-id="${row.film_id}" aria-label="Supprimer la note">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            `}
          </div>
        `
        : `<span class="film-meta">Notable sur la page série</span>`;

      return `
        <tr>
          <td>${rank}</td>
          <td>
            <a href="${href}" class="film-link">${escapeHTML(row.title)}</a>
            <small>(${escapeHTML(typeLabel)}${row.phase ? ` - ${escapeHTML(row.phase)}` : ""})</small>
          </td>
          <td>${badge}</td>
          <td>${modifierCell}</td>
        </tr>
      `;
    })
    .join("");
}

function bindRankingFilters() {
  filmsFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.films = filmsFilterEl.checked;
    renderPersonalRatings();
  });

  seriesFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.series = seriesFilterEl.checked;
    renderPersonalRatings();
  });

  franchiseFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.franchise = franchiseFilterEl.value || "";
    updatePhaseVisibility();
    renderPersonalRatings();
  });

  phaseFilterEl?.addEventListener("change", () => {
    personalRankingState.filters.phase = phaseFilterEl.value || "";
    renderPersonalRatings();
  });
}

function renderManagedRequests(rows) {
  const container = document.querySelector("#managed-media-requests");
  if (!rows.length) {
    container.innerHTML = "<p>Aucune demande en attente.</p>";
    return;
  }

  container.innerHTML = rows
    .map(
      (row) => `
        <article class="card">
          <p><strong>${escapeHTML(row.profileName)}</strong> → ${escapeHTML(row.mediaName)}</p>
          <div class="inline-actions">
            <button type="button" data-action="approve-media-membership" data-id="${row.id}">Approuver</button>
            <button type="button" data-action="reject-media-membership" data-id="${row.id}" class="ghost-button">Refuser</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadManagedMediaRequests(userId) {
  const managerSection = document.querySelector("#media-manager-section");
  const container = document.querySelector("#managed-media-requests");

  const { data: managedMedias, error: managedMediaError } = await supabase
    .from("media_outlets")
    .select("id, name")
    .eq("admin_profile_id", userId);

  if (managedMediaError) throw managedMediaError;

  if (!managedMedias?.length) {
    managerSection.style.display = "none";
    container.innerHTML = "";
    return;
  }

  managerSection.style.display = "block";

  const mediaIds = managedMedias.map((media) => media.id);
  const mediaById = new Map(managedMedias.map((media) => [media.id, media.name]));

  const { data: pendingRows, error: pendingError } = await supabase
    .from("profile_media_memberships")
    .select("id, profile_id, media_id, status")
    .in("media_id", mediaIds)
    .eq("status", "pending");

  if (pendingError) throw pendingError;

  const profileIds = [...new Set((pendingRows || []).map((row) => row.profile_id))];
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase
      .from("profiles")
      .select("id, username")
      .in("id", profileIds)
    : { data: [], error: null };

  if (profilesError) throw profilesError;

  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile.username]));
  const normalized = (pendingRows || []).map((row) => ({
    id: row.id,
    mediaName: mediaById.get(row.media_id) || "Média",
    profileName: profileById.get(row.profile_id) || row.profile_id
  }));

  renderManagedRequests(normalized);
}

async function loadPersonalRatings(userId) {
  const [
    { data: films, error: filmsError },
    { data: ratings, error: ratingsError },
    { data: seriesList, error: seriesError },
    { data: seasons, error: seasonsError },
    { data: episodes, error: episodesError },
    { data: episodeRatings, error: episodeRatingsError },
    { data: seasonUserRatings, error: seasonUserRatingsError }
  ] = await Promise.all([
    supabase
      .from("films")
      .select("id, title, release_date, franchise, phase")
      .order("release_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("ratings")
      .select("film_id, score, review")
      .eq("user_id", userId),
    supabase
      .from("series")
      .select("id, title, start_date, franchise")
      .order("start_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("series_seasons")
      .select("id, series_id, phase, start_date"),
    supabase
      .from("series_episodes")
      .select("id, season_id"),
    supabase
      .from("episode_ratings")
      .select("episode_id, score")
      .eq("user_id", userId),
    supabase
      .from("season_user_ratings")
      .select("season_id, manual_score, adjustment")
      .eq("user_id", userId)
  ]);

  if (filmsError) throw filmsError;
  if (ratingsError) throw ratingsError;
  if (seriesError) throw seriesError;
  if (seasonsError) throw seasonsError;
  if (episodesError) throw episodesError;
  if (episodeRatingsError) throw episodeRatingsError;
  if (seasonUserRatingsError) throw seasonUserRatingsError;

  const ratingByFilmId = new Map((ratings || []).map((row) => [row.film_id, row]));

  const filmRows = (films || [])
    .map((film) => {
      const rating = ratingByFilmId.get(film.id);
      return {
        type: "film",
        film_id: film.id,
        title: film.title,
        release_date: film.release_date,
        sort_date: film.release_date,
        franchise: String(film.franchise || "").trim(),
        phase: String(film.phase || "").trim(),
        score: rating ? Number(rating.score) : null,
        review: rating?.review || ""
      };
    })
    .filter((film) => isReleasedOnOrBeforeToday(film.release_date));

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

  const userEpisodeScoreByEpisodeId = new Map((episodeRatings || []).map((row) => [row.episode_id, Number(row.score)]));
  const seasonUserRowBySeasonId = new Map((seasonUserRatings || []).map((row) => [row.season_id, row]));

  const seriesRows = (seriesList || []).flatMap((serie) => {
    const serieSeasons = seasonsBySeriesId.get(serie.id) || [];
    const seasonScores = [];
    const seasonScoresByPhase = new Map();

    for (const season of serieSeasons) {
      const seasonEpisodes = episodesBySeasonId.get(season.id) || [];
      const episodeScores = seasonEpisodes
        .map((episode) => userEpisodeScoreByEpisodeId.get(episode.id))
        .filter((score) => Number.isFinite(score));
      const episodeAverage = episodeScores.length
        ? episodeScores.reduce((sum, score) => sum + score, 0) / episodeScores.length
        : null;

      const seasonUserRow = seasonUserRowBySeasonId.get(season.id);
      const manual = seasonUserRow?.manual_score === null || seasonUserRow?.manual_score === undefined
        ? null
        : Number(seasonUserRow.manual_score);
      const adjustment = Number(seasonUserRow?.adjustment || 0);
      const effective = manual !== null
        ? clamp(manual, 0, 10)
        : (Number.isFinite(episodeAverage) ? clamp(episodeAverage + adjustment, 0, 10) : null);

      if (Number.isFinite(effective)) {
        seasonScores.push(effective);

        const phase = String(season.phase || "").trim();
        if (phase) {
          const phaseRows = seasonScoresByPhase.get(phase) || [];
          phaseRows.push({
            score: effective,
            start_date: season.start_date || null
          });
          seasonScoresByPhase.set(phase, phaseRows);
        }
      }
    }

    const score = seasonScores.length
      ? seasonScores.reduce((sum, seasonScore) => sum + seasonScore, 0) / seasonScores.length
      : null;

    const rows = [{
      type: "series",
      series_id: serie.id,
      title: serie.title,
      sort_date: serie.start_date,
      franchise: String(serie.franchise || "").trim(),
      phase: "",
      score
    }];

    for (const [phase, phaseRows] of seasonScoresByPhase.entries()) {
      const phaseScore = phaseRows.reduce((sum, row) => sum + row.score, 0) / phaseRows.length;
      const phaseSortDate = phaseRows
        .map((row) => row.start_date)
        .filter(Boolean)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || serie.start_date;

      rows.push({
        type: "series_phase",
        series_id: serie.id,
        title: serie.title,
        sort_date: phaseSortDate,
        franchise: String(serie.franchise || "").trim(),
        phase,
        score: phaseScore
      });
    }

    return rows;
  });

  personalRankingState.allRows = [...filmRows, ...seriesRows];
  setupRankingFilterOptions();
  renderPersonalRatings();
}

async function saveQuickRating(filmId) {
  if (!currentUserId) return;

  const { data: film, error: filmError } = await supabase
    .from("films")
    .select("release_date")
    .eq("id", filmId)
    .maybeSingle();

  if (filmError) throw filmError;
  if (!isReleasedOnOrBeforeToday(film?.release_date || null)) {
    setMessage("#ratings-quick-message", "Impossible de noter un film non sorti ou sans date de sortie.", true);
    return;
  }

  const scoreInput = document.querySelector(`[data-field="score"][data-film-id="${filmId}"]`);
  const scoreRaw = scoreInput?.value.trim() || "";

  if (!scoreRaw) {
    setMessage("#ratings-quick-message", "Le score est obligatoire pour sauvegarder.", true);
    return;
  }

  const score = Number(scoreRaw.replace(",", "."));
  if (!Number.isFinite(score) || score < 0 || score > 10 || !isQuarterStep(score)) {
    setMessage("#ratings-quick-message", "Le score doit être entre 0 et 10, par pas de 0,25.", true);
    return;
  }

  const { error } = await supabase.from("ratings").upsert(
    {
      user_id: currentUserId,
      film_id: filmId,
      score
    },
    { onConflict: "user_id,film_id" }
  );

  if (error) throw error;

  setMessage("#ratings-quick-message", "Note sauvegardée.");
  await loadPersonalRatings(currentUserId);
}

async function deleteQuickRating(filmId) {
  if (!currentUserId) return;

  const { error } = await supabase
    .from("ratings")
    .delete()
    .eq("user_id", currentUserId)
    .eq("film_id", filmId);

  if (error) throw error;

  setMessage("#ratings-quick-message", "Note supprimée.");
  await loadPersonalRatings(currentUserId);
}

async function loadProfile() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  const user = session.user;
  currentUserId = user.id;

  try {
    await loadMediaOutlets();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      document.querySelector("#username").value = data.username || "";
      document.querySelector("#avatar_url").value = data.avatar_url || "";
      renderAvatarPreview(data.avatar_url);
      document.querySelector("#admin-badge").textContent = data.is_admin ? "Oui" : "Non";
    }

    await Promise.all([loadMemberships(user.id), loadPersonalRatings(user.id), loadManagedMediaRequests(user.id)]);
    document.querySelector("#profile-email").textContent = user.email || "";
  } catch (error) {
    setMessage("#form-message", error.message || "Erreur de chargement profil.", true);
  }
}

document.querySelector("#avatar_url")?.addEventListener("input", (event) => {
  renderAvatarPreview(event.target.value.trim());
});

document.querySelector("#profile-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = await requireAuth("/login.html");
  if (!session) return;

  const username = document.querySelector("#username").value.trim();
  const avatarURL = document.querySelector("#avatar_url").value.trim();
  const mediaOutletId = document.querySelector("#media_outlet_id").value || null;

  if (!username) {
    setMessage("#form-message", "Le nom d'utilisateur est obligatoire.", true);
    return;
  }

  try {
    const payload = {
      id: session.user.id,
      username,
      avatar_url: avatarURL || null
    };

    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) throw error;

    if (mediaOutletId) {
      const { error: membershipError } = await supabase.from("profile_media_memberships").upsert(
        {
          profile_id: session.user.id,
          media_id: mediaOutletId,
          status: "pending",
          decided_at: null,
          decided_by: null
        },
        { onConflict: "profile_id,media_id" }
      );

      if (membershipError) throw membershipError;
    }

    setMessage("#form-message", "Profil enregistré. Demande média ajoutée ou mise à jour.");
    await loadMemberships(session.user.id);
  } catch (error) {
    setMessage("#form-message", error.message || "Sauvegarde impossible.", true);
  }
});

document.querySelector("#personal-ratings-body")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const filmId = button.dataset.filmId;
  if (!filmId) return;

  try {
    if (button.dataset.action === "save-rating") {
      await saveQuickRating(filmId);
      return;
    }

    if (button.dataset.action === "delete-rating") {
      await deleteQuickRating(filmId);
    }
  } catch (error) {
    setMessage("#ratings-quick-message", error.message || "Opération impossible.", true);
  }
});

document.querySelector("#managed-media-requests")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const membershipId = button.dataset.id;
  if (!membershipId) return;

  const approved = button.dataset.action === "approve-media-membership";
  if (!approved && button.dataset.action !== "reject-media-membership") return;

  try {
    const { error } = await supabase.rpc("admin_decide_media_membership", {
      p_membership_id: membershipId,
      p_approved: approved
    });

    if (error) throw error;

    setMessage("#media-manager-message", "Décision enregistrée.");
    await loadManagedMediaRequests(currentUserId);
    await loadMemberships(currentUserId);
  } catch (error) {
    setMessage("#media-manager-message", error.message || "Impossible de traiter la demande.", true);
  }
});

loadProfile();
bindRankingFilters();
