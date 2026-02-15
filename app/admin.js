import { supabase } from "../supabaseClient.js";
import { getCurrentProfile, requireAuth } from "./auth.js";
import { escapeHTML, setMessage } from "./utils.js";

const state = {
  series: [],
  seasons: [],
  episodes: []
};

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

  document.querySelector("#episode-season-id").innerHTML = episodeSeasonOptions;
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
  const [{ data: series, error: seriesError }, { data: seasons, error: seasonsError }, { data: episodes, error: episodesError }] = await Promise.all([
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

  if (seriesError) throw seriesError;
  if (seasonsError) throw seasonsError;
  if (episodesError) throw episodesError;

  state.series = series || [];
  state.seasons = seasons || [];
  state.episodes = episodes || [];

  const selectedSeriesId = document.querySelector("#series-id")?.value || "";
  const selectedSeasonSeriesId = document.querySelector("#season-series-id")?.value || "";
  const selectedSeasonId = document.querySelector("#season-id")?.value || "";
  const selectedEpisodeSeasonId = document.querySelector("#episode-season-id")?.value || "";
  const selectedEpisodeId = document.querySelector("#episode-id")?.value || "";

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
}

function bindSeriesForms() {
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
}

async function initAdminPage() {
  const session = await ensureAdmin();
  if (!session) return;

  await loadUsers();
  bindCreateMedia();
  bindSeriesForms();
  await refreshSeriesData();
}

initAdminPage();
