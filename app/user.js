import { supabase } from "../supabaseClient.js";
import {
  buildDenseRankLabels,
  escapeHTML,
  formatScore,
  getScoreClass,
  getUserIdFromURL,
  renderAvatarInto,
  setMessage
} from "./utils.js";
import { createRankingFilterController } from "./personal-ranking.js";
import { buildActivityBadgeMarkup, fetchLastActivityAt, getActivityStatus } from "./activity-status.js";

const rankingController = createRankingFilterController({ onChange: () => renderRanking() });

function renderMediaMemberships(rows) {
  const approvedListEl = document.querySelector("#profile-media-approved-list");
  if (!approvedListEl) return;

  approvedListEl.innerHTML = rows.length
    ? rows
        .map(
          (row) =>
            `<li><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHTML(row.media_outlets?.name || "Média")}</li>`
        )
        .join("")
    : `<li class="film-meta">Ind&eacute;pendant (aucun m&eacute;dia rattach&eacute;)</li>`;
}

async function loadMemberships(userId) {
  const { data, error } = await supabase
    .from("profile_media_memberships")
    .select("id, media_outlets(name)")
    .eq("profile_id", userId)
    .eq("status", "approved")
    .order("requested_at", { ascending: false });

  if (error) throw error;

  renderMediaMemberships(data || []);
}

function renderRanking() {
  const body = document.querySelector("#personal-ratings-body");
  const filteredRows = rankingController.getFilteredRows();

  if (!filteredRows.length) {
    body.innerHTML = `<tr><td colspan="3">Aucun élément pour ce filtre.</td></tr>`;
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
      const badge = row.score === null
        ? `<span class="score-badge stade-neutre">Pas noté</span>`
        : `<span class="score-with-suffix"><span class="score-badge ${getScoreClass(row.score)}">${formatScore(row.score)}</span> <span class="score-suffix">/ 10</span></span>`;
      const typeLabel = row.type === "film" ? "Film" : "Série";
      const href = row.type === "film"
        ? `/film.html?id=${row.film_id}`
        : row.type === "season_phase"
          ? `/season.html?id=${row.season_id}`
          : `/series.html?id=${row.series_id}`;

      return `
        <tr>
          <td>${rank}</td>
          <td>
            <a href="${href}" class="film-link">${escapeHTML(row.title)}</a>
            <small>(${escapeHTML(row.type === "season_phase" ? "Saison" : typeLabel)}${row.phase ? ` - ${escapeHTML(row.phase)}` : ""})</small>
          </td>
          <td>${badge}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadUserProfile() {
  const userId = getUserIdFromURL();
  if (!userId) {
    setMessage("#page-message", "Utilisateur introuvable.", true);
    return;
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, bio")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      setMessage("#page-message", "Utilisateur introuvable.", true);
      return;
    }

    const username = data.username || "Utilisateur";
    document.querySelector("#profile-username-display").textContent = username;
    document.querySelector("#user-ranking-title").textContent = `Classement de ${username}`;
    renderAvatarInto("#profile-avatar-display", data.avatar_url, "avatar profile-avatar-large");

    const bioBlockEl = document.querySelector("#profile-bio-block");
    const bioDisplayEl = document.querySelector("#profile-bio-display");
    if (bioBlockEl && bioDisplayEl) {
      const bio = String(data.bio || "").trim();
      bioDisplayEl.textContent = bio;
      bioBlockEl.style.display = bio ? "" : "none";
    }

    const renderActivityBadge = (async () => {
      const badgeEl = document.querySelector("#profile-activity-badge");
      if (!badgeEl) return;
      const lastActivityAt = await fetchLastActivityAt(data.id);
      badgeEl.innerHTML = buildActivityBadgeMarkup(getActivityStatus(lastActivityAt));
    })();

    await Promise.all([loadMemberships(data.id), rankingController.load(data.id), renderActivityBadge]);
  } catch (error) {
    setMessage("#page-message", error.message || "Erreur de chargement du profil.", true);
  }
}

loadUserProfile();
