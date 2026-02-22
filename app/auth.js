import { supabase } from "../supabaseClient.js";

const PASSWORD_RECOVERY_PENDING_KEY = "marvelreview:password-recovery-pending";
const PASSWORD_RECOVERY_PATH = "/update-password.html";

function normalizePath(path) {
  const value = String(path || "/").toLowerCase();
  if (value === "/") return "/index.html";
  return value;
}

function readRecoveryTypeFromURL() {
  const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  if (hashParams.get("type") === "recovery") return "recovery";

  const queryParams = new URLSearchParams(window.location.search);
  if (queryParams.get("type") === "recovery") return "recovery";

  return "";
}

export function markPasswordRecoveryPending() {
  window.sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, "1");
}

export function clearPasswordRecoveryPending() {
  window.sessionStorage.removeItem(PASSWORD_RECOVERY_PENDING_KEY);
}

export function isPasswordRecoveryPending() {
  return window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY) === "1";
}

export function isUpdatePasswordPath(pathname = window.location.pathname) {
  return normalizePath(pathname) === PASSWORD_RECOVERY_PATH;
}

if (readRecoveryTypeFromURL() === "recovery") {
  markPasswordRecoveryPending();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    markPasswordRecoveryPending();
  }
});

export async function getSession() {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();
  if (error) throw error;

  if (!session) {
    clearPasswordRecoveryPending();
  }

  return session;
}

export async function getUser() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

export async function getCurrentProfile() {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, is_admin")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function signOut() {
  clearPasswordRecoveryPending();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function bindAuthVisibility(isLoggedIn) {
  document.querySelectorAll("[data-auth='logged-in']").forEach((el) => {
    el.style.display = isLoggedIn ? "inline-flex" : "none";
  });
  document.querySelectorAll("[data-auth='logged-out']").forEach((el) => {
    el.style.display = isLoggedIn ? "none" : "inline-flex";
  });
}

export function redirectIfLoggedIn(path = "/index.html") {
  return getSession().then((session) => {
    if (!session) return;

    if (isPasswordRecoveryPending() && !isUpdatePasswordPath()) {
      window.location.href = PASSWORD_RECOVERY_PATH;
      return;
    }

    if (!isPasswordRecoveryPending()) {
      window.location.href = path;
    }
  });
}

export async function requireAuth(path = "/login.html") {
  const session = await getSession();
  if (!session) {
    window.location.href = path;
    return null;
  }

  if (isPasswordRecoveryPending() && !isUpdatePasswordPath()) {
    window.location.href = PASSWORD_RECOVERY_PATH;
    return null;
  }

  return session;
}
