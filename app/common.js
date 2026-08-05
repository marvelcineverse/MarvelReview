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

const SEASON_INFO_VERSION = "v1";
const SEASON_INFO_DISMISSED_KEY = `marvelreview:season-note-info:dismissed:${SEASON_INFO_VERSION}`;
const SEASON_INFO_SESSION_KEY = `marvelreview:season-note-info:session-hidden:${SEASON_INFO_VERSION}`;
const SEASON_INFO_SERIES_PATHS = new Set(["/series.html", "/season.html", "/episode.html"]);

function normalizePath(path) {
  const value = String(path || "/").toLowerCase();
  if (value === "/") return "/index.html";
  return value;
}

function isSeriesInfoPage(pathname = window.location.pathname) {
  return SEASON_INFO_SERIES_PATHS.has(normalizePath(pathname));
}

function buildSeasonInfoStorageKey(baseKey, profileId) {
  return `${baseKey}:${profileId || "guest"}`;
}

function readStorageValue(storage, key) {
  try {
    return storage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function writeStorageValue(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (_error) {
    // Ignore storage failures: the info popup can still function for the current page.
  }
}

function ensureSeasonInfoExperienceRoot() {
  let root = document.querySelector("#season-note-info-root");
  if (root) return root;

  root = document.createElement("div");
  root.id = "season-note-info-root";
  root.innerHTML = `
    <button
      id="season-note-info-trigger"
      type="button"
      class="season-note-info-trigger"
      aria-label="Afficher l'explication des notes de saisons"
      aria-controls="season-note-info-modal"
      aria-expanded="false"
      hidden
    >
      <span aria-hidden="true">i</span>
    </button>
    <div id="season-note-info-modal" class="season-note-info-modal" hidden>
      <div class="season-note-info-backdrop" data-season-info-action="close"></div>
      <section
        class="season-note-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="season-note-info-title"
        aria-describedby="season-note-info-description"
      >
        <button
          type="button"
          class="season-note-info-close"
          data-season-info-action="close"
          aria-label="Fermer la fenêtre d'information"
        >
          &times;
        </button>
        <div class="season-note-info-copy">
          <p class="season-note-info-kicker">Info notes de saisons</p>
          <h2 id="season-note-info-title">Pas satisfaisant de la moyenne d'une saison ? Ajuste-la !</h2>
          <div id="season-note-info-description" class="season-note-info-text">
            <p>
              La note de saison se base sur la moyenne de tes épisodes quand toute la saison est notée.
            </p>
            <p>
              Si le ressenti global de la saison te semble un peu au-dessus ou en dessous, utilise
              l'ajusteur pour corriger par pas de 0,25.
            </p>
            <p>Si tu saisis une note manuelle de saison, l'ajusteur se désactive automatiquement.</p>
          </div>
        </div>
        <figure class="season-note-info-media">
          <img
            src="https://www.marvel-cineverse.fr/medias/files/adobe-express-mr-note-saison.gif"
            alt="Démonstration du calcul de note de saison et de l'ajusteur"
            loading="lazy"
          />
        </figure>
        <div class="season-note-info-actions">
          <button type="button" class="ghost-button" data-season-info-action="close">Fermer</button>
          <button type="button" class="button" data-season-info-action="dismiss">Ne plus afficher</button>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(root);
  return root;
}

function openSeasonInfoModal() {
  const modal = document.querySelector("#season-note-info-modal");
  if (!modal) return;

  modal.hidden = false;
  document.body.classList.add("season-note-info-open");
  document.querySelector("#season-note-info-trigger")?.setAttribute("aria-expanded", "true");
  document.querySelector(".season-note-info-close")?.focus();
}

function closeSeasonInfoModal(profileId, rememberForSession = false) {
  const modal = document.querySelector("#season-note-info-modal");
  if (!modal) return;

  if (rememberForSession) {
    writeStorageValue(
      window.sessionStorage,
      buildSeasonInfoStorageKey(SEASON_INFO_SESSION_KEY, profileId),
      "1"
    );
  }

  modal.hidden = true;
  document.body.classList.remove("season-note-info-open");
  document.querySelector("#season-note-info-trigger")?.setAttribute("aria-expanded", "false");
}

function initSeasonInfoExperience({ isLoggedIn, profileId }) {
  const root = ensureSeasonInfoExperienceRoot();
  const trigger = root.querySelector("#season-note-info-trigger");
  const modal = root.querySelector("#season-note-info-modal");
  if (!trigger || !modal) return;

  const canOpenFromPage = isLoggedIn && isSeriesInfoPage();
  trigger.hidden = !canOpenFromPage;

  if (root.dataset.bound !== "1") {
    root.addEventListener("click", (event) => {
      const actionSource = event.target.closest("[data-season-info-action]");
      if (!actionSource) return;

      const { seasonInfoAction } = actionSource.dataset;
      if (seasonInfoAction === "close") {
        closeSeasonInfoModal(root.dataset.profileId || "", true);
        return;
      }

      if (seasonInfoAction === "dismiss") {
        const activeProfileId = root.dataset.profileId || "";
        writeStorageValue(
          window.localStorage,
          buildSeasonInfoStorageKey(SEASON_INFO_DISMISSED_KEY, activeProfileId),
          "1"
        );
        closeSeasonInfoModal(activeProfileId, true);
      }
    });

    trigger.addEventListener("click", () => {
      openSeasonInfoModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeSeasonInfoModal(root.dataset.profileId || "", false);
      }
    });

    root.dataset.bound = "1";
  }

  root.dataset.profileId = profileId || "";

  if (!isLoggedIn) {
    closeSeasonInfoModal("", false);
    return;
  }

  const dismissedKey = buildSeasonInfoStorageKey(SEASON_INFO_DISMISSED_KEY, profileId);
  const sessionKey = buildSeasonInfoStorageKey(SEASON_INFO_SESSION_KEY, profileId);
  const isDismissedForever = readStorageValue(window.localStorage, dismissedKey) === "1";
  const isHiddenForSession = readStorageValue(window.sessionStorage, sessionKey) === "1";

  if (!isDismissedForever && !isHiddenForSession) {
    openSeasonInfoModal();
  } else {
    closeSeasonInfoModal(profileId, false);
  }
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

    const isRecoveryOnlySession = Boolean(session) && isPasswordRecoveryPending();
    const isLoggedIn = Boolean(session) && !isRecoveryOnlySession;
    bindAuthVisibility(isLoggedIn);

    if (statusEl) {
      statusEl.textContent = "";
      statusEl.style.display = "none";
    }

    if (isLoggedIn) {
      const profile = await getCurrentProfile();
      const moderationStatus = String(profile?.moderation_status || "active").toLowerCase();
      if (moderationStatus === "suspended" || moderationStatus === "banned") {
        await signOut();
        window.location.href = `/login.html?blocked=${encodeURIComponent(moderationStatus)}`;
        return;
      }

      const displayName = String(profile?.username || "").trim() || session.user.email;
      if (navUserValueEl) navUserValueEl.textContent = displayName;

      const managedMediaCount = await getManagedMediaCount(session.user.id);
      const canAccessAdminPage = Boolean(profile?.is_admin) || managedMediaCount > 0;
      setAdminOnlyVisibility(Boolean(profile?.is_admin));
      setAdminOrManagerVisibility(canAccessAdminPage);
      initSeasonInfoExperience({ isLoggedIn: true, profileId: profile?.id || session.user.id });
    } else {
      if (navUserValueEl) navUserValueEl.textContent = "";
      setAdminOnlyVisibility(false);
      setAdminOrManagerVisibility(false);
      initSeasonInfoExperience({ isLoggedIn: false, profileId: "" });
    }

    const logoutLink = document.querySelector("#logout-link");
    if (logoutLink) {
      logoutLink.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await signOut();
          window.location.href = "/index.html";
        } catch (error) {
          setMessage("#page-message", error.message || "Erreur de déconnexion.", true);
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
