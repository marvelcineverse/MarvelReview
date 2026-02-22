import { getCurrentProfile, requireAuth } from "./auth.js";
import { setMessage } from "./utils.js";

async function guardApiPage() {
  const session = await requireAuth("/login.html");
  if (!session) return;

  try {
    const profile = await getCurrentProfile();
    if (profile?.is_admin) return;

    setMessage("#page-message", "Acces reserve aux administrateurs.", true);
    window.setTimeout(() => {
      window.location.href = "/index.html";
    }, 700);
  } catch (error) {
    setMessage("#page-message", error.message || "Verification des droits impossible.", true);
    window.setTimeout(() => {
      window.location.href = "/index.html";
    }, 700);
  }
}

guardApiPage();
