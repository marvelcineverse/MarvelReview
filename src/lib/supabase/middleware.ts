import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: unknown) {
          request.cookies.set({ name, value, ...normalizeCookieOptions(options) });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...normalizeCookieOptions(options) });
        },
        remove(name: string, options: unknown) {
          request.cookies.set({ name, value: "", ...normalizeCookieOptions(options) });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value: "", ...normalizeCookieOptions(options) });
        }
      }
    }
  );

  await supabase.auth.getUser();
  return response;
}
