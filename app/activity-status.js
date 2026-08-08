import { supabase } from "../supabaseClient.js";
import { escapeHTML, formatDate } from "./utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_THRESHOLD_DAYS = 30;
const RECENT_THRESHOLD_DAYS = 90;

const ACTIVITY_TABLES = ["ratings", "episode_ratings", "season_user_ratings", "series_reviews"];

const ACTIVITY_STATUS_LABELS = {
  active: "Actif",
  recent: "Récemment actif",
  occasional: "Occasionnel",
  inactive: "Inactif"
};

function latestTimestamp(values) {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

async function fetchLastUpdatedAt(table, userId) {
  const { data, error } = await supabase
    .from(table)
    .select("updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.updated_at || null;
}

export async function fetchLastActivityAt(userId) {
  const results = await Promise.all(ACTIVITY_TABLES.map((table) => fetchLastUpdatedAt(table, userId)));
  return latestTimestamp(results);
}

export async function fetchLastSignInAt(userId) {
  const { data, error } = await supabase.rpc("api_profile_last_sign_in_at", { p_user_id: userId });
  if (error) throw error;
  return data || null;
}

export async function fetchLastInteractionAt(userId, { knownLastSignInAt } = {}) {
  const [lastActivityAt, lastSignInAt] = await Promise.all([
    fetchLastActivityAt(userId),
    knownLastSignInAt !== undefined ? Promise.resolve(knownLastSignInAt) : fetchLastSignInAt(userId)
  ]);

  return latestTimestamp([lastActivityAt, lastSignInAt]);
}

export function getActivityStatus(lastInteractionAt) {
  if (!lastInteractionAt) return "inactive";

  const lastInteractionTs = new Date(lastInteractionAt).getTime();
  if (!Number.isFinite(lastInteractionTs)) return "inactive";

  const daysSince = (Date.now() - lastInteractionTs) / DAY_MS;
  if (daysSince <= ACTIVE_THRESHOLD_DAYS) return "active";
  if (daysSince <= RECENT_THRESHOLD_DAYS) return "recent";
  return "occasional";
}

export function buildActivityBadgeMarkup(status) {
  const label = ACTIVITY_STATUS_LABELS[status] || ACTIVITY_STATUS_LABELS.inactive;
  return `<span class="profile-activity-badge activity-status-${status}">${label}</span>`;
}

export function buildLastInteractionMarkup(lastInteractionAt) {
  const label = lastInteractionAt
    ? `Dernière interaction : ${formatDate(lastInteractionAt)}`
    : "Dernière interaction inconnue";
  return `<small class="film-meta profile-last-seen">${escapeHTML(label)}</small>`;
}

export async function renderUserActivityInto(userId, { badgeSelector, lastSeenSelector } = {}) {
  const lastInteractionAt = await fetchLastInteractionAt(userId);

  if (badgeSelector) {
    const badgeEl = document.querySelector(badgeSelector);
    if (badgeEl) badgeEl.innerHTML = buildActivityBadgeMarkup(getActivityStatus(lastInteractionAt));
  }

  if (lastSeenSelector) {
    const lastSeenEl = document.querySelector(lastSeenSelector);
    if (lastSeenEl) lastSeenEl.innerHTML = buildLastInteractionMarkup(lastInteractionAt);
  }
}
