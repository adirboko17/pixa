import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

/**
 * Server-side Supabase client (RSC, Route Handlers, Server Actions).
 *
 * Reads/writes the session from Next.js cookies so the user's identity is
 * available for RLS-enforced queries. Use this in API routes / server
 * components when you want to act as the *signed-in* user.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `set` method can throw in a Server Component when not
            // wrapped in a Server Action / Route Handler. Safe to ignore
            // here because the middleware will refresh the session anyway.
          }
        },
      },
    }
  );
}
