import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("Supabase config is missing. Update config.js before using the app.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
