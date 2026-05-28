"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * Browser-side Supabase client.
 *
 * Use this in client components for auth ops (signUp / signIn / signOut)
 * and for non-privileged DB reads/writes that should respect RLS.
 *
 * Session is persisted to cookies (via @supabase/ssr) so the server can
 * read it as well.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
