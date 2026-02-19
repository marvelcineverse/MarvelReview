import { injectLayout, setMessage } from "./utils.js";
import { bindAuthVisibility, getCurrentProfile, getSession, signOut } from "./auth.js";

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
  injectLayout();
  markActiveNavLink();
  initMobileNav();
  const statusEl = document.querySelector("#auth-status");

  try {
    const session = await getSession();
    const isLoggedIn = Boolean(session);
    bindAuthVisibility(isLoggedIn);

    if (statusEl) {
      statusEl.textContent = isLoggedIn ? `Connecte: ${session.user.email}` : "Non connecte";
    }

    if (isLoggedIn) {
      const profile = await getCurrentProfile();
      document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
        el.style.display = profile?.is_admin ? "inline-flex" : "none";
      });
    } else {
      document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
        el.style.display = "none";
      });
    }

    const logoutButton = document.querySelector("#logout-button");
    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        try {
          await signOut();
          window.location.href = "/index.html";
        } catch (error) {
          setMessage("#page-message", error.message || "Erreur de deconnexion.", true);
        }
      });
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = "Erreur session";
    setMessage("#page-message", error.message || "Erreur de chargement session.", true);
  }
}

initCommonLayout();
