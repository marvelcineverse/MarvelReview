import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieOptions = {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
};

function normalizeCookieOptions(options: unknown): CookieOptions {
  if (!options || typeof options !== "object") {
    return {};
  }
  return options as CookieOptions;
}

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: unknown) {
          try {
            cookieStore.set({ name, value, ...normalizeCookieOptions(options) });
          } catch {
            // set is only available in Server Actions / Route Handlers
          }
        },
        remove(name: string, options: unknown) {
          try {
            cookieStore.set({ name, value: "", ...normalizeCookieOptions(options) });
          } catch {
            // remove is only available in Server Actions / Route Handlers
          }
        }
      }
    }
  );
}
