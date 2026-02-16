import { supabase } from "../supabaseClient.js";
import { getCurrentProfile, requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

const state = {
  films: [],
  series: [],
  seasons: [],
  episodes: []
};

function bindCreationTabs() {
  const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
  const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
  if (!tabButtons.length || !panels.length) return;

  const activate = (target) => {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === target;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.tabPanel === target);
    });
  };

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activate(button.dataset.tabTarget || "film");
    });
  });

  const defaultTab = tabButtons.find((button) => button.classList.contains("is-active"))?.dataset.tabTarget || "film";
  activate(defaultTab);
}

async function ensureAdmin() {
  const session = await requireAuth("/login.html");
  if (!session) return null;

  const currentProfile = await getCurrentProfile();
  if (!currentProfile?.is_admin) {
    setMessage("#page-message", "Acces reserve aux administrateurs.", true);
    document.querySelector("#admin-root").style.display = "none";
    return null;
  }

  return session;
}

async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .order("username", { ascending: true });

  if (error) throw error;

  const mediaAdminSelectEl = document.querySelector("#media-admin-profile-id");
  mediaAdminSelectEl.innerHTML = [
    `<option value="">Aucun admin pour le moment</option>`,
    ...(data || []).map((user) => `<option value="${user.id}">${escapeHTML(user.username)}</option>`)
  ].join("");
}

function bindCreateMedia() {
  document.querySelector("#create-media-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      name: document.querySelector("#media-name").value.trim(),
      admin_profile_id: document.querySelector("#media-admin-profile-id").value || null,
      twitter_url: document.querySelector("#media-twitter-url").value.trim() || null,
      instagram_url: document.querySelector("#media-instagram-url").value.trim() || null,
      youtube_url: document.querySelector("#media-youtube-url").value.trim() || null,
      website_url: document.querySelector("#media-website-url").value.trim() || null,
      description: document.querySelector("#media-description").value.trim() || null
    };

    if (!payload.name) {
      setMessage("#create-media-message", "Le nom du media est obligatoire.", true);
      return;
    }

    try {
      const { error } = await supabase.from("media_outlets").insert(payload);
      if (error) throw error;

      setMessage("#create-media-message", "Media cree.");
      document.querySelector("#create-media-form").reset();
    } catch (error) {
      setMessage("#create-media-message", error.message || "Creation media impossible.", true);
    }
  });
}

function renderFilmOptions() {
  document.querySelector("#film-id").innerHTML = [
    `<option value="">Nouveau film</option>`,
    ...state.films.map((film) => `<option value="${film.id}">${escapeHTML(film.title)}</option>`)
  ].join("");
}

function fillFilmForm(filmId) {
  const row = state.films.find((item) => item.id === filmId);

  document.querySelector("#film-title").value = row?.title || "";
  document.querySelector("#film-slug").value = row?.slug || "";
  document.querySelector("#film-release-date").value = row?.release_date || "";
  document.querySelector("#film-franchise").value = row?.franchise || "MCU";
  document.querySelector("#film-phase").value = row?.phase || "";
  document.querySelector("#film-type").value = row?.type || "Film";
  document.querySelector("#film-poster-url").value = row?.poster_url || "";
  document.querySelector("#film-synopsis").value = row?.synopsis || "";
}

function renderSeriesOptions() {
  const seriesOptions = [
    `<option value="">Nouvelle serie</option>`,
    ...state.series.map((serie) => `<option value="${serie.id}">${escapeHTML(serie.title)}</option>`)
  ].join("");

  const seasonSeriesOptions = [
    `<option value="">Selectionne une serie</option>`,
    ...state.series.map((serie) => `<option value="${serie.id}">${escapeHTML(serie.title)}</option>`)
  ].join("");

  document.querySelector("#series-id").innerHTML = seriesOptions;
  document.querySelector("#season-series-id").innerHTML = seasonSeriesOptions;
}

function renderSeasonOptions(seriesId = "") {
  const filtered = seriesId ? state.seasons.filter((season) => season.series_id === seriesId) : [];

  document.querySelector("#season-id").innerHTML = [
    `<option value="">Nouvelle saison</option>`,
    ...filtered.map((season) => `<option value="${season.id}">S${season.season_number} - ${escapeHTML(season.name)}</option>`)
  ].join("");

  const episodeSeasonOptions = [
    `<option value="">Selectionne une saison</option>`,
    ...state.seasons.map((season) => {
      const serie = state.series.find((item) => item.id === season.series_id);
      const serieName = serie?.title || "Serie";
      return `<option value="${season.id}">${escapeHTML(serieName)} - S${season.season_number} - ${escapeHTML(season.name)}</option>`;
    })
  ].join("");

  const episodeSeasonEl = document.querySelector("#episode-season-id");
  if (episodeSeasonEl) episodeSeasonEl.innerHTML = episodeSeasonOptions;

  const bulkSeasonEl = document.querySelector("#episode-bulk-season-id");
  if (bulkSeasonEl) bulkSeasonEl.innerHTML = episodeSeasonOptions;
}

function renderEpisodeOptions(seasonId = "") {
  const filtered = seasonId ? state.episodes.filter((episode) => episode.season_id === seasonId) : [];

  document.querySelector("#episode-id").innerHTML = [
    `<option value="">Nouvel episode</option>`,
    ...filtered
      .sort((a, b) => a.episode_number - b.episode_number)
      .map((episode) => `<option value="${episode.id}">Ep ${episode.episode_number} - ${escapeHTML(episode.title)}</option>`)
  ].join("");
}

function fillSeriesForm(seriesId) {
  const row = state.series.find((item) => item.id === seriesId);

  document.querySelector("#series-title").value = row?.title || "";
  document.querySelector("#series-slug").value = row?.slug || "";
  document.querySelector("#series-synopsis").value = row?.synopsis || "";
  document.querySelector("#series-poster-url").value = row?.poster_url || "";
  document.querySelector("#series-start-date").value = row?.start_date || "";
  document.querySelector("#series-end-date").value = row?.end_date || "";
  document.querySelector("#series-franchise").value = row?.franchise || "MCU";
  document.querySelector("#series-type").value = row?.type || "Serie";
}

function fillSeasonForm(seasonId) {
  const row = state.seasons.find((item) => item.id === seasonId);

  if (row) {
    document.querySelector("#season-series-id").value = row.series_id;
  }

  document.querySelector("#season-name").value = row?.name || "";
  document.querySelector("#season-number").value = row?.season_number || "";
  document.querySelector("#season-slug").value = row?.slug || "";
  document.querySelector("#season-poster-url").value = row?.poster_url || "";
  document.querySelector("#season-start-date").value = row?.start_date || "";
  document.querySelector("#season-end-date").value = row?.end_date || "";
  document.querySelector("#season-phase").value = row?.phase || "";

  renderSeasonOptions(document.querySelector("#season-series-id").value || "");
  document.querySelector("#season-id").value = seasonId || "";
}

function fillEpisodeForm(episodeId) {
  const row = state.episodes.find((item) => item.id === episodeId);

  if (row) {
    document.querySelector("#episode-season-id").value = row.season_id;
  }

  document.querySelector("#episode-number").value = row?.episode_number || "";
  document.querySelector("#episode-title").value = row?.title || "";
  document.querySelector("#episode-air-date").value = row?.air_date || "";

  renderEpisodeOptions(document.querySelector("#episode-season-id").value || "");
  document.querySelector("#episode-id").value = episodeId || "";
}

async function refreshSeriesData() {
  const [
    { data: films, error: filmsError },
    { data: series, error: seriesError },
    { data: seasons, error: seasonsError },
    { data: episodes, error: episodesError }
  ] = await Promise.all([
    supabase
      .from("films")
      .select("id, title, slug, release_date, franchise, phase, type, poster_url, synopsis")
      .order("release_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("series")
      .select("id, title, slug, synopsis, poster_url, start_date, end_date, franchise, type")
      .order("title", { ascending: true }),
    supabase
      .from("series_seasons")
      .select("id, series_id, name, season_number, slug, poster_url, start_date, end_date, phase")
      .order("season_number", { ascending: true }),
    supabase
      .from("series_episodes")
      .select("id, season_id, episode_number, title, air_date")
      .order("episode_number", { ascending: true })
  ]);

  if (filmsError) throw filmsError;
  if (seriesError) throw seriesError;
  if (seasonsError) throw seasonsError;
  if (episodesError) throw episodesError;

  state.films = films || [];
  state.series = series || [];
  state.seasons = seasons || [];
  state.episodes = episodes || [];

  const selectedFilmId = document.querySelector("#film-id")?.value || "";
  const selectedSeriesId = document.querySelector("#series-id")?.value || "";
  const selectedSeasonSeriesId = document.querySelector("#season-series-id")?.value || "";
  const selectedSeasonId = document.querySelector("#season-id")?.value || "";
  const selectedEpisodeSeasonId = document.querySelector("#episode-season-id")?.value || "";
  const selectedEpisodeId = document.querySelector("#episode-id")?.value || "";
  const selectedBulkEpisodeSeasonId = document.querySelector("#episode-bulk-season-id")?.value || "";

  renderFilmOptions();
  document.querySelector("#film-id").value = state.films.some((f) => f.id === selectedFilmId) ? selectedFilmId : "";
  fillFilmForm(document.querySelector("#film-id").value || "");

  renderSeriesOptions();
  document.querySelector("#series-id").value = state.series.some((s) => s.id === selectedSeriesId) ? selectedSeriesId : "";
  fillSeriesForm(document.querySelector("#series-id").value || "");

  renderSeasonOptions(selectedSeasonSeriesId);
  document.querySelector("#season-series-id").value = state.series.some((s) => s.id === selectedSeasonSeriesId) ? selectedSeasonSeriesId : "";
  renderSeasonOptions(document.querySelector("#season-series-id").value || "");
  document.querySelector("#season-id").value = state.seasons.some((s) => s.id === selectedSeasonId) ? selectedSeasonId : "";
  if (document.querySelector("#season-id").value) fillSeasonForm(document.querySelector("#season-id").value);

  document.querySelector("#episode-season-id").value = state.seasons.some((s) => s.id === selectedEpisodeSeasonId) ? selectedEpisodeSeasonId : "";
  renderEpisodeOptions(document.querySelector("#episode-season-id").value || "");
  document.querySelector("#episode-id").value = state.episodes.some((e) => e.id === selectedEpisodeId) ? selectedEpisodeId : "";
  if (document.querySelector("#episode-id").value) fillEpisodeForm(document.querySelector("#episode-id").value);

  const bulkSeasonEl = document.querySelector("#episode-bulk-season-id");
  if (bulkSeasonEl) {
    bulkSeasonEl.value = state.seasons.some((s) => s.id === selectedBulkEpisodeSeasonId) ? selectedBulkEpisodeSeasonId : "";
  }
}

function normalizeBulkDate(rawDate) {
  const raw = (rawDate || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const frMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    const [, day, month, year] = frMatch;
    return `${year}-${month}-${day}`;
  }

  return undefined;
}

function getBulkRowsValues() {
  return Array.from(document.querySelectorAll("[data-bulk-row]")).map((row, index) => ({
    index: index + 1,
    episode_number: row.querySelector("[data-field='episode-number']")?.value?.trim() || "",
    title: row.querySelector("[data-field='episode-title']")?.value?.trim() || "",
    air_date: row.querySelector("[data-field='episode-air-date']")?.value?.trim() || ""
  }));
}

function renderBulkEpisodeRows(count, previousRows = []) {
  const container = document.querySelector("#episode-bulk-rows");
  if (!container) return;

  const safeCount = Math.min(Math.max(Number(count) || 1, 1), 50);
  container.innerHTML = Array.from({ length: safeCount }, (_, idx) => {
    const row = previousRows[idx] || {};
    const episodeNumber = row.episode_number || String(idx + 1);
    const title = escapeHTML(row.title || "");
    const airDate = escapeHTML(row.air_date || "");
    return `
      <tr class="bulk-episode-row" data-bulk-row>
        <td class="bulk-episode-index">${idx + 1}</td>
        <td><input data-field="episode-number" type="number" min="1" step="1" value="${escapeHTML(episodeNumber)}" placeholder="Numero" /></td>
        <td><input data-field="episode-title" type="text" value="${title}" placeholder="Titre episode" /></td>
        <td><input data-field="episode-air-date" type="text" value="${airDate}" placeholder="Date (YYYY-MM-DD ou DD/MM/YYYY)" /></td>
      </tr>
    `;
  }).join("");

  const countInput = document.querySelector("#episode-bulk-count");
  if (countInput) countInput.value = String(safeCount);
}

function parseBulkEpisodesRows() {
  const rows = getBulkRowsValues();
  if (!rows.length) {
    throw new Error("Aucune ligne a importer.");
  }

  const parsed = [];
  const seenEpisodeNumbers = new Set();
  for (const row of rows) {
    const episodeNumber = Number(row.episode_number.replace(/^ep\.?\s*/i, ""));
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) {
      throw new Error(`Ligne ${row.index}: numero d'episode invalide.`);
    }
    if (seenEpisodeNumbers.has(episodeNumber)) {
      throw new Error(`Ligne ${row.index}: numero d'episode duplique.`);
    }
    seenEpisodeNumbers.add(episodeNumber);

    if (!row.title) {
      throw new Error(`Ligne ${row.index}: titre obligatoire.`);
    }

    const airDate = normalizeBulkDate(row.air_date);
    if (airDate === undefined) {
      throw new Error(`Ligne ${row.index}: date invalide (utilise YYYY-MM-DD ou DD/MM/YYYY).`);
    }

    parsed.push({
      episode_number: episodeNumber,
      title: row.title,
      air_date: airDate || null
    });
  }

  return parsed.sort((a, b) => a.episode_number - b.episode_number);
}

function fillBulkTableFromPaste(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (!input.dataset.field) return;

  const raw = event.clipboardData?.getData("text/plain") || "";
  if (!raw.includes("\n") && !raw.includes("\t")) return;

  const matrix = raw
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
  if (!matrix.length) return;

  const fields = ["episode-number", "episode-title", "episode-air-date"];
  const startFieldIndex = fields.indexOf(input.dataset.field);
  if (startFieldIndex === -1) return;

  const previousRows = getBulkRowsValues();
  let rowEls = Array.from(document.querySelectorAll("[data-bulk-row]"));
  const startRowEl = input.closest("[data-bulk-row]");
  const startRowIndex = rowEls.indexOf(startRowEl);
  if (startRowIndex < 0) return;

  const neededRows = startRowIndex + matrix.length;
  if (neededRows > previousRows.length) {
    renderBulkEpisodeRows(neededRows, previousRows);
    rowEls = Array.from(document.querySelectorAll("[data-bulk-row]"));
  }

  event.preventDefault();

  matrix.forEach((columns, rowOffset) => {
    const rowEl = rowEls[startRowIndex + rowOffset];
    if (!rowEl) return;

    columns.forEach((value, columnOffset) => {
      const field = fields[startFieldIndex + columnOffset];
      if (!field) return;
      const cellInput = rowEl.querySelector(`[data-field='${field}']`);
      if (cellInput) cellInput.value = value.trim();
    });
  });
}

function bindSeriesForms() {
  document.querySelector("#film-id")?.addEventListener("change", () => {
    fillFilmForm(document.querySelector("#film-id").value || "");
  });

  document.querySelector("#film-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#film-id").value || null;
    const payload = {
      id: id || undefined,
      title: document.querySelector("#film-title").value.trim(),
      slug: document.querySelector("#film-slug").value.trim() || null,
      release_date: document.querySelector("#film-release-date").value || null,
      franchise: document.querySelector("#film-franchise").value.trim() || "MCU",
      phase: document.querySelector("#film-phase").value.trim() || null,
      type: document.querySelector("#film-type").value.trim() || "Film",
      poster_url: document.querySelector("#film-poster-url").value.trim() || null,
      synopsis: document.querySelector("#film-synopsis").value.trim() || null
    };

    if (!payload.title) {
      setMessage("#film-message", "Le titre est obligatoire.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("films").upsert(payload);
      if (error) throw error;
      setMessage("#film-message", "Film enregistre.");
      await refreshSeriesData();
    } catch (error) {
      setMessage("#film-message", error.message || "Enregistrement film impossible.", true);
    }
  });

  document.querySelector("#series-id")?.addEventListener("change", () => {
    fillSeriesForm(document.querySelector("#series-id").value || "");
  });

  document.querySelector("#series-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#series-id").value || null;
    const payload = {
      id: id || undefined,
      title: document.querySelector("#series-title").value.trim(),
      slug: document.querySelector("#series-slug").value.trim() || null,
      synopsis: document.querySelector("#series-synopsis").value.trim() || null,
      poster_url: document.querySelector("#series-poster-url").value.trim() || null,
      start_date: document.querySelector("#series-start-date").value || null,
      end_date: document.querySelector("#series-end-date").value || null,
      franchise: document.querySelector("#series-franchise").value.trim() || "MCU",
      type: document.querySelector("#series-type").value.trim() || "Serie"
    };

    if (!payload.title) {
      setMessage("#series-message", "Le titre est obligatoire.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("series").upsert(payload);
      if (error) throw error;
      setMessage("#series-message", "Serie enregistree.");
      await refreshSeriesData();
    } catch (error) {
      setMessage("#series-message", error.message || "Enregistrement serie impossible.", true);
    }
  });

  document.querySelector("#season-series-id")?.addEventListener("change", () => {
    renderSeasonOptions(document.querySelector("#season-series-id").value || "");
    fillSeasonForm("");
  });

  document.querySelector("#season-id")?.addEventListener("change", () => {
    fillSeasonForm(document.querySelector("#season-id").value || "");
  });

  document.querySelector("#season-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#season-id").value || null;
    const seriesId = document.querySelector("#season-series-id").value || null;

    const payload = {
      id: id || undefined,
      series_id: seriesId,
      name: document.querySelector("#season-name").value.trim(),
      season_number: Number(document.querySelector("#season-number").value),
      slug: document.querySelector("#season-slug").value.trim() || null,
      poster_url: document.querySelector("#season-poster-url").value.trim() || null,
      start_date: document.querySelector("#season-start-date").value || null,
      end_date: document.querySelector("#season-end-date").value || null,
      phase: document.querySelector("#season-phase").value.trim() || null
    };

    if (!payload.series_id || !payload.name || !Number.isInteger(payload.season_number) || payload.season_number < 1) {
      setMessage("#season-message", "Serie, nom et numero de saison sont obligatoires.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("series_seasons").upsert(payload);
      if (error) throw error;
      setMessage("#season-message", "Saison enregistree.");
      await refreshSeriesData();
      renderSeasonOptions(seriesId);
    } catch (error) {
      setMessage("#season-message", error.message || "Enregistrement saison impossible.", true);
    }
  });

  document.querySelector("#episode-season-id")?.addEventListener("change", () => {
    renderEpisodeOptions(document.querySelector("#episode-season-id").value || "");
    fillEpisodeForm("");
  });

  document.querySelector("#episode-id")?.addEventListener("change", () => {
    fillEpisodeForm(document.querySelector("#episode-id").value || "");
  });

  document.querySelector("#episode-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = document.querySelector("#episode-id").value || null;
    const seasonId = document.querySelector("#episode-season-id").value || null;

    const payload = {
      id: id || undefined,
      season_id: seasonId,
      episode_number: Number(document.querySelector("#episode-number").value),
      title: document.querySelector("#episode-title").value.trim(),
      air_date: document.querySelector("#episode-air-date").value || null
    };

    if (!payload.season_id || !payload.title || !Number.isInteger(payload.episode_number) || payload.episode_number < 1) {
      setMessage("#episode-message", "Saison, numero et titre sont obligatoires.", true);
      return;
    }

    if (!id) delete payload.id;

    try {
      const { error } = await supabase.from("series_episodes").upsert(payload);
      if (error) throw error;
      setMessage("#episode-message", "Episode enregistre.");
      await refreshSeriesData();
      renderEpisodeOptions(seasonId);
    } catch (error) {
      setMessage("#episode-message", error.message || "Enregistrement episode impossible.", true);
    }
  });

  document.querySelector("#episode-bulk-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const seasonId = document.querySelector("#episode-bulk-season-id").value || null;

    if (!seasonId) {
      setMessage("#episode-bulk-message", "Selectionne une saison.", true);
      return;
    }

    let episodes;
    try {
      episodes = parseBulkEpisodesRows();
    } catch (error) {
      setMessage("#episode-bulk-message", error.message || "Format bulk invalide.", true);
      return;
    }

    const payload = episodes.map((episode) => ({
      season_id: seasonId,
      episode_number: episode.episode_number,
      title: episode.title,
      air_date: episode.air_date
    }));

    try {
      const { error } = await supabase
        .from("series_episodes")
        .upsert(payload, { onConflict: "season_id,episode_number" });
      if (error) throw error;

      setMessage("#episode-bulk-message", `${episodes.length} episode(s) importe(s).`);
      await refreshSeriesData();
      renderEpisodeOptions(seasonId);
    } catch (error) {
      setMessage("#episode-bulk-message", error.message || "Import bulk impossible.", true);
    }
  });

  document.querySelector("#episode-bulk-generate")?.addEventListener("click", () => {
    const count = Number(document.querySelector("#episode-bulk-count")?.value || 1);
    const previousRows = getBulkRowsValues();
    renderBulkEpisodeRows(count, previousRows);
  });

  document.querySelector("#episode-bulk-count")?.addEventListener("change", () => {
    const count = Number(document.querySelector("#episode-bulk-count")?.value || 1);
    const previousRows = getBulkRowsValues();
    renderBulkEpisodeRows(count, previousRows);
  });

  document.querySelector("#episode-bulk-rows")?.addEventListener("paste", (event) => {
    fillBulkTableFromPaste(event);
  });

  renderBulkEpisodeRows(Number(document.querySelector("#episode-bulk-count")?.value || 6));
}

async function initAdminPage() {
  const session = await ensureAdmin();
  if (!session) return;

  bindCreationTabs();
  await loadUsers();
  bindCreateMedia();
  bindSeriesForms();
  await refreshSeriesData();
}

initAdminPage();
