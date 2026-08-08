import { supabase } from "../supabaseClient.js";
import { injectLayout, initThemeToggle, setMessage } from "./utils.js";
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

const ANNOUNCEMENT_VERSION = "4.2.0";
const ANNOUNCEMENT_DISMISSED_KEY = `marvelreview:announcement:dismissed:${ANNOUNCEMENT_VERSION}`;
const ANNOUNCEMENT_SESSION_KEY = `marvelreview:announcement:session-hidden:${ANNOUNCEMENT_VERSION}`;

function isHomePage(pathname = window.location.pathname) {
  return normalizePath(pathname) === "/index.html";
}

function buildAnnouncementStorageKey(baseKey, profileId) {
  return `${baseKey}:${profileId || "guest"}`;
}

function ensureAnnouncementModalRoot() {
  let root = document.querySelector("#announcement-root");
  if (root) return root;

  root = document.createElement("div");
  root.id = "announcement-root";
  root.innerHTML = `
    <div id="announcement-modal" class="announcement-modal" hidden>
      <div class="announcement-backdrop" data-announcement-action="close"></div>
      <section
        class="announcement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-title"
        aria-describedby="announcement-description"
      >
        <button
          type="button"
          class="announcement-close"
          data-announcement-action="close"
          aria-label="Fermer la fenêtre des nouveautés"
        >
          &times;
        </button>
        <div class="announcement-copy">
          <p class="announcement-kicker">Nouveaut&eacute;s - version ${ANNOUNCEMENT_VERSION}</p>
          <h2 id="announcement-title">Quoi de neuf sur Marvel Review ?</h2>
          <div id="announcement-description" class="announcement-text">
            <ul class="announcement-list">
              <li>Les pages de profil public font leur apparition : classement individuel de chaque utilisateur, consultable directement depuis Classement &gt; Classement par utilisateur gr&acirc;ce &agrave; une recherche dynamique.</li>
              <li>Le profil s'enrichit : photo de profil, description libre, badge d'activit&eacute; et date de derni&egrave;re connexion.</li>
              <li>Le mode clair/sombre fait son arriv&eacute;e sur tout le site.</li>
              <li>Les critiques peuvent d&eacute;sormais &ecirc;tre marqu&eacute;es comme contenant des spoilers, auquel cas elles seront prot&eacute;g&eacute;es sur les 2 premi&egrave;res semaines suivant la sortie d'un contenu.</li>
              <li>L'interface des s&eacute;ries a &eacute;t&eacute; retravaill&eacute;e.</li>
            </ul>
          </div>
        </div>
        <div class="announcement-actions">
          <button type="button" class="ghost-button" data-announcement-action="close">Fermer</button>
          <button type="button" class="button" data-announcement-action="dismiss">Ne plus afficher</button>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(root);
  return root;
}

function openAnnouncementModal() {
  const modal = document.querySelector("#announcement-modal");
  if (!modal) return;

  modal.hidden = false;
  document.body.classList.add("announcement-open");
  document.querySelector(".announcement-close")?.focus();
}

function closeAnnouncementModal(profileId, rememberForSession = false) {
  const modal = document.querySelector("#announcement-modal");
  if (!modal) return;

  if (rememberForSession) {
    writeStorageValue(
      window.sessionStorage,
      buildAnnouncementStorageKey(ANNOUNCEMENT_SESSION_KEY, profileId),
      "1"
    );
  }

  modal.hidden = true;
  document.body.classList.remove("announcement-open");
}

function initAnnouncementExperience({ profileId }) {
  if (!isHomePage()) return;

  const root = ensureAnnouncementModalRoot();
  const modal = root.querySelector("#announcement-modal");
  if (!modal) return;

  if (root.dataset.bound !== "1") {
    root.addEventListener("click", (event) => {
      const actionSource = event.target.closest("[data-announcement-action]");
      if (!actionSource) return;

      const { announcementAction } = actionSource.dataset;
      if (announcementAction === "close") {
        closeAnnouncementModal(root.dataset.profileId || "", true);
        return;
      }

      if (announcementAction === "dismiss") {
        const activeProfileId = root.dataset.profileId || "";
        writeStorageValue(
          window.localStorage,
          buildAnnouncementStorageKey(ANNOUNCEMENT_DISMISSED_KEY, activeProfileId),
          "1"
        );
        closeAnnouncementModal(activeProfileId, true);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeAnnouncementModal(root.dataset.profileId || "", false);
      }
    });

    root.dataset.bound = "1";
  }

  root.dataset.profileId = profileId || "";

  const dismissedKey = buildAnnouncementStorageKey(ANNOUNCEMENT_DISMISSED_KEY, profileId);
  const sessionKey = buildAnnouncementStorageKey(ANNOUNCEMENT_SESSION_KEY, profileId);
  const isDismissedForever = readStorageValue(window.localStorage, dismissedKey) === "1";
  const isHiddenForSession = readStorageValue(window.sessionStorage, sessionKey) === "1";

  if (!isDismissedForever && !isHiddenForSession) {
    openAnnouncementModal();
  } else {
    closeAnnouncementModal(profileId, false);
  }
}

function initSpoilerReveal() {
  const toggle = (target) => {
    const wrap = target.closest?.(".spoiler-wrap");
    if (!wrap) return;
    wrap.classList.toggle("is-revealed");
  };

  document.addEventListener("click", (event) => toggle(event.target));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target.closest?.(".spoiler-wrap")) return;
    event.preventDefault();
    toggle(event.target);
  });
}

initSpoilerReveal();

const ADMIN_REVIEW_EDIT_TABLE_LABELS = {
  ratings: "critique de film",
  episode_ratings: "critique d'épisode",
  season_user_ratings: "critique de saison",
  series_reviews: "critique de série"
};

let adminReviewEditContext = null;

function ensureAdminReviewEditRoot() {
  let root = document.querySelector("#admin-review-edit-root");
  if (root) return root;

  root = document.createElement("div");
  root.id = "admin-review-edit-root";
  root.innerHTML = `
    <div id="admin-review-edit-modal" class="season-adjust-modal admin-review-edit-modal" hidden>
      <div class="season-adjust-backdrop" data-admin-review-edit-action="close"></div>
      <section
        class="season-adjust-dialog admin-review-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-review-edit-title"
      >
        <h2 id="admin-review-edit-title">Modifier la critique (admin)</h2>
        <p id="admin-review-edit-meta" class="film-meta"></p>
        <form id="admin-review-edit-form" class="form">
          <label>
            Texte de la critique
            <textarea id="admin-review-edit-textarea" maxlength="2500"></textarea>
          </label>
          <label class="spoiler-checkbox-label" for="admin-review-edit-spoiler">
            <input type="checkbox" id="admin-review-edit-spoiler" class="spoiler-checkbox-input" />
            <span>Cette critique r&eacute;v&egrave;le des &eacute;l&eacute;ments de l'intrigue (spoiler)</span>
          </label>
          <div class="inline-actions">
            <button type="submit" class="button">Enregistrer</button>
            <button type="button" id="admin-review-edit-delete-button" class="ghost-button ghost-button-danger">Supprimer totalement</button>
            <button type="button" class="ghost-button" data-admin-review-edit-action="close">Annuler</button>
          </div>
          <p id="admin-review-edit-message" class="message" aria-live="polite"></p>
        </form>
      </section>
    </div>
  `;

  document.body.appendChild(root);
  return root;
}

function closeAdminReviewEditModal() {
  const modal = document.querySelector("#admin-review-edit-modal");
  if (!modal) return;
  modal.hidden = true;
  adminReviewEditContext = null;
}

function openAdminReviewEditModal() {
  const modal = document.querySelector("#admin-review-edit-modal");
  if (!modal) return;
  modal.hidden = false;
  document.querySelector("#admin-review-edit-textarea")?.focus();
}

function setAdminReviewEditMessage(message, isError = false) {
  const messageEl = document.querySelector("#admin-review-edit-message");
  if (!messageEl) return;
  messageEl.textContent = message || "";
  messageEl.classList.toggle("error", isError);
}

async function handleAdminReviewEditTrigger(button) {
  const table = button.dataset.reviewTable;
  const id = button.dataset.reviewId;
  if (!table || !id) return;

  const root = ensureAdminReviewEditRoot();
  const textarea = root.querySelector("#admin-review-edit-textarea");
  const spoilerInput = root.querySelector("#admin-review-edit-spoiler");
  const metaEl = root.querySelector("#admin-review-edit-meta");

  setAdminReviewEditMessage("");
  textarea.value = "";
  spoilerInput.checked = false;
  const label = ADMIN_REVIEW_EDIT_TABLE_LABELS[table] || "critique";
  const authorLabel = button.dataset.reviewAuthor || "";
  const contentLabel = button.dataset.reviewContent || "";
  metaEl.textContent = [label, authorLabel, contentLabel].filter(Boolean).join(" — ");

  const selectColumns = table === "season_user_ratings"
    ? "review, has_spoiler, manual_score, adjustment"
    : "review, has_spoiler";

  const { data, error } = await supabase.from(table).select(selectColumns).eq("id", id).maybeSingle();
  if (error || !data) {
    adminReviewEditContext = null;
    setAdminReviewEditMessage("Impossible de charger cette critique.", true);
    openAdminReviewEditModal();
    return;
  }

  adminReviewEditContext = {
    table,
    id,
    manualScore: data.manual_score ?? null,
    adjustment: Number(data.adjustment || 0)
  };
  textarea.value = data.review || "";
  spoilerInput.checked = Boolean(data.has_spoiler);
  openAdminReviewEditModal();
}

async function saveAdminReviewEdit() {
  if (!adminReviewEditContext) return;
  const { table, id } = adminReviewEditContext;
  const textarea = document.querySelector("#admin-review-edit-textarea");
  const spoilerInput = document.querySelector("#admin-review-edit-spoiler");
  const reviewValue = textarea.value.trim();

  if (table === "series_reviews" && !reviewValue) {
    setAdminReviewEditMessage("La critique d'une série ne peut pas être vide — utilise Supprimer.", true);
    return;
  }

  const { error } = await supabase
    .from(table)
    .update({
      review: reviewValue || null,
      has_spoiler: reviewValue ? spoilerInput.checked : false
    })
    .eq("id", id);

  if (error) {
    setAdminReviewEditMessage(error.message || "Impossible d'enregistrer.", true);
    return;
  }

  window.location.reload();
}

async function deleteAdminReviewEdit() {
  if (!adminReviewEditContext) return;
  const { table, id, manualScore, adjustment } = adminReviewEditContext;

  if (table === "ratings" || table === "episode_ratings") {
    const confirmed = window.confirm(
      "Supprimer cette critique supprimera aussi la note (score) associée. Continuer ?"
    );
    if (!confirmed) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return setAdminReviewEditMessage(error.message || "Suppression impossible.", true);
    window.location.reload();
    return;
  }

  if (table === "series_reviews") {
    const confirmed = window.confirm("Supprimer définitivement cette critique de série ?");
    if (!confirmed) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return setAdminReviewEditMessage(error.message || "Suppression impossible.", true);
    window.location.reload();
    return;
  }

  const hasScoreData = manualScore !== null || Number(adjustment || 0) !== 0;
  if (!hasScoreData) {
    const confirmed = window.confirm("Supprimer définitivement cette critique de saison ?");
    if (!confirmed) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return setAdminReviewEditMessage(error.message || "Suppression impossible.", true);
    window.location.reload();
    return;
  }

  const confirmed = window.confirm(
    "Cette saison a une note associée : seule la critique (texte) sera supprimée, la note sera conservée. Continuer ?"
  );
  if (!confirmed) return;
  const { error } = await supabase.from(table).update({ review: null, has_spoiler: false }).eq("id", id);
  if (error) return setAdminReviewEditMessage(error.message || "Suppression impossible.", true);
  window.location.reload();
}

function initAdminReviewEdit() {
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-admin-review-edit]");
    if (trigger) {
      handleAdminReviewEditTrigger(trigger).catch((error) => {
        setAdminReviewEditMessage(error.message || "Erreur de chargement.", true);
        openAdminReviewEditModal();
      });
      return;
    }

    if (event.target.closest("[data-admin-review-edit-action='close']")) {
      closeAdminReviewEditModal();
      return;
    }

    if (event.target.closest("#admin-review-edit-delete-button")) {
      deleteAdminReviewEdit().catch((error) => {
        setAdminReviewEditMessage(error.message || "Erreur.", true);
      });
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "admin-review-edit-form") return;
    event.preventDefault();
    saveAdminReviewEdit().catch((error) => {
      setAdminReviewEditMessage(error.message || "Erreur.", true);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = document.querySelector("#admin-review-edit-modal");
    if (modal && !modal.hidden) closeAdminReviewEditModal();
  });
}

initAdminReviewEdit();

async function initCommonLayout() {
  ensureAppHeadMetadata();
  injectLayout();
  markActiveNavLink();
  initMobileNav();
  initThemeToggle();
  const statusEl = document.querySelector("#auth-status");
  const navUserValueEl = document.querySelector("#nav-user-value");
  const navUserAvatarEl = document.querySelector("#nav-user-avatar");

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

      if (navUserAvatarEl) {
        const avatarUrl = String(profile?.avatar_url || "").trim();
        if (avatarUrl) {
          navUserAvatarEl.src = avatarUrl;
          navUserAvatarEl.alt = `Photo de profil de ${displayName}`;
          navUserAvatarEl.hidden = false;
        } else {
          navUserAvatarEl.hidden = true;
          navUserAvatarEl.removeAttribute("src");
        }
      }

      const managedMediaCount = await getManagedMediaCount(session.user.id);
      const canAccessAdminPage = Boolean(profile?.is_admin) || managedMediaCount > 0;
      setAdminOnlyVisibility(Boolean(profile?.is_admin));
      setAdminOrManagerVisibility(canAccessAdminPage);
      initSeasonInfoExperience({ isLoggedIn: true, profileId: profile?.id || session.user.id });
      initAnnouncementExperience({ profileId: profile?.id || session.user.id });
    } else {
      if (navUserValueEl) navUserValueEl.textContent = "";
      if (navUserAvatarEl) {
        navUserAvatarEl.hidden = true;
        navUserAvatarEl.removeAttribute("src");
      }
      setAdminOnlyVisibility(false);
      setAdminOrManagerVisibility(false);
      initSeasonInfoExperience({ isLoggedIn: false, profileId: "" });
      initAnnouncementExperience({ profileId: "" });
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
