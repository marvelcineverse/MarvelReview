import { supabase } from "../supabaseClient.js";

export async function getSession() {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();
  if (error) throw error;
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

export async function signOut() {
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
    if (session) window.location.href = path;
  });
}

export async function requireAuth(path = "/login.html") {
  const session = await getSession();
  if (!session) {
    window.location.href = path;
    return null;
  }
  return session;
}
