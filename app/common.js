import { supabase } from "../supabaseClient.js";
import { injectLayout, setMessage } from "./utils.js";
import {
  bindAuthVisibility,
  getCurrentProfile,
  getSession,
  isPasswordRecoveryPending,
  isUpdatePasswordPath,
  signOut
} from "./auth.js";

function ensureHeadElement(selector, tagName, attributes) {
  const headEl = document.head;
  if (!headEl) return;

  let element = headEl.querySelector(selector);
  if (!element) {
    element = document.createElement(tagName);
    headEl.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
}

function ensureAppHeadMetadata() {
  ensureHeadElement("link[rel='icon']", "link", {
    rel: "icon",
    type: "image/svg+xml",
    href: "/favicon.svg"
  });

  ensureHeadElement("link[rel='manifest']", "link", {
    rel: "manifest",
    href: "/site.webmanifest"
  });

  ensureHeadElement("link[rel='apple-touch-icon']", "link", {
    rel: "apple-touch-icon",
    href: "/favicon.svg"
  });

  ensureHeadElement("meta[name='theme-color']", "meta", {
    name: "theme-color",
    content: "#cf1c1c"
  });

  ensureHeadElement("meta[name='apple-mobile-web-app-title']", "meta", {
    name: "apple-mobile-web-app-title",
    content: "MarvelReview"
  });

  ensureHeadElement("meta[name='mobile-web-app-capable']", "meta", {
    name: "mobile-web-app-capable",
    content: "yes"
  });

  ensureHeadElement("meta[name='apple-mobile-web-app-capable']", "meta", {
    name: "apple-mobile-web-app-capable",
    content: "yes"
  });
}

function setAdminOnlyVisibility(isAdmin) {
  document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
    if (!isAdmin) {
      el.style.display = "none";
      return;
    }

    el.style.display = el.getAttribute("data-access-display") || "inline";
  });
}

function setAdminOrManagerVisibility(canAccessAdminPage) {
  document.querySelectorAll("[data-admin-or-manager-only='true']").forEach((el) => {
    if (!canAccessAdminPage) {
      el.style.display = "none";
      return;
    }

    el.style.display = el.getAttribute("data-access-display") || "inline";
  });
}

async function getManagedMediaCount(userId) {
  if (!userId) return 0;

  const { count, error } = await supabase
    .from("media_outlets")
    .select("id", { count: "exact", head: true })
    .eq("admin_profile_id", userId);

  if (error) throw error;
  return Number(count || 0);
}

function markActiveNavLink() {
  const navLinks = document.querySelectorAll("#primary-nav a.nav-link");
  if (!navLinks.length) return;

  const normalizePath = (path) => {
    const value = String(path || "/").toLowerCase();
    if (value === "/") return "/index.html";
    return value;
  };

  const currentPath = normalizePath(window.location.pathname);
  navLinks.forEach((link) => {
    const linkPath = normalizePath(new URL(link.href, window.location.origin).pathname);
    const isActive = linkPath === currentPath;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function initMobileNav() {
  const navToggle = document.querySelector("#nav-toggle");
  const nav = document.querySelector("#primary-nav");
  if (!navToggle || !nav) return;

  const closeNav = () => {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  };

  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll("a, button").forEach((item) => {
    item.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 860px)").matches) {
        closeNav();
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNav();
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 861px)").matches) {
      closeNav();
    }
  });
}

async function initCommonLayout() {
  ensureAppHeadMetadata();
  injectLayout();
  markActiveNavLink();
  initMobileNav();
  const statusEl = document.querySelector("#auth-status");
  const navUserValueEl = document.querySelector("#nav-user-value");

  try {
    const session = await getSession();
    if (session && isPasswordRecoveryPending() && !isUpdatePasswordPath()) {
      window.location.href = "/update-password.html";
      return;
    }

    const isLoggedIn = Boolean(session);
    bindAuthVisibility(isLoggedIn);

    if (statusEl) {
      statusEl.textContent = "";
      statusEl.style.display = "none";
    }

    if (isLoggedIn) {
      const profile = await getCurrentProfile();
      const displayName = String(profile?.username || "").trim() || session.user.email;
      if (navUserValueEl) navUserValueEl.textContent = displayName;

      const managedMediaCount = await getManagedMediaCount(session.user.id);
      const canAccessAdminPage = Boolean(profile?.is_admin) || managedMediaCount > 0;
      setAdminOnlyVisibility(Boolean(profile?.is_admin));
      setAdminOrManagerVisibility(canAccessAdminPage);
    } else {
      if (navUserValueEl) navUserValueEl.textContent = "";
      setAdminOnlyVisibility(false);
      setAdminOrManagerVisibility(false);
    }

    const logoutLink = document.querySelector("#logout-link");
    if (logoutLink) {
      logoutLink.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await signOut();
          window.location.href = "/index.html";
        } catch (error) {
          setMessage("#page-message", error.message || "Erreur de deconnexion.", true);
        }
      });
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.style.display = "none";
    }
    setMessage("#page-message", error.message || "Erreur de chargement session.", true);
  }
}

initCommonLayout();
