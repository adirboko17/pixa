"use client";

import { createClient } from "./client";
import type { Session, User } from "@supabase/supabase-js";

export type AuthResult = {
  user: User | null;
  session: Session | null;
  /** True iff the account exists but still needs email confirmation. */
  needsEmailConfirmation: boolean;
  /** True iff Supabase silently de-duped a signup because the email is already taken. */
  alreadyRegistered: boolean;
};

/**
 * Sign up a new user with email + password, and stash the business name
 * in the auth user_metadata so the DB trigger can drop it into `profiles`.
 *
 * If the project has "Confirm email" enabled in Supabase Auth → the user
 * has to click the link in the email before signIn works. We surface that
 * via `needsEmailConfirmation = true`.
 *
 * If the email is already registered, Supabase returns a synthetic user
 * object with `identities: []` to avoid leaking which emails exist. We
 * detect that case via `alreadyRegistered = true` so the UI can tell the
 * user to log in instead.
 */
export async function signUpWithPassword(args: {
  email: string;
  password: string;
  businessName: string;
}): Promise<AuthResult> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email: args.email.trim(),
    password: args.password,
    options: {
      data: { business_name: args.businessName },
      emailRedirectTo:
        typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });

  if (error) throw error;

  // Supabase de-dup signal: empty identities array = email already exists.
  const alreadyRegistered =
    !!data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation: !!data.user && !data.session && !alreadyRegistered,
    alreadyRegistered,
  };
}

export async function signInWithPassword(args: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: args.email.trim(),
    password: args.password,
  });
  if (error) throw error;
  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation: false,
    alreadyRegistered: false,
  };
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/**
 * Translate the most common Supabase auth error codes to friendly Hebrew text.
 */
export function authErrorToHebrew(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.toLowerCase();

  if (m.includes("invalid login")) return "אימייל או סיסמה לא נכונים";
  if (m.includes("email not confirmed"))
    return "האימייל עדיין לא אומת. בדוק את תיבת הדואר שלך.";
  if (m.includes("user already registered"))
    return "המייל הזה כבר רשום. נסה להיכנס במקום.";
  if (m.includes("password should be at least"))
    return "הסיסמה חייבת להיות לפחות 6 תווים";
  if (m.includes("rate limit") || m.includes("too many"))
    return "יותר מדי ניסיונות. נסה שוב בעוד דקה.";
  if (m.includes("network")) return "בעיית רשת. בדוק חיבור ונסה שוב.";
  return msg;
}
