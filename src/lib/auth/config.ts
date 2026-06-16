/**
 * Login configuration.
 *
 * The login form takes a username + password. Internally, Supabase Auth still
 * uses email as the unique identifier, so we map the friendly username here.
 *
 * To add more admin accounts, append to USERS with a unique username and the
 * corresponding Supabase Auth email.
 */
export type AdminUser = {
  /** Friendly username shown on the login form. Case-insensitive. */
  username: string;
  /** Email that Supabase Auth actually uses as the unique id. */
  email: string;
  /** Display name shown in the account menu. */
  displayName: string;
};

export const USERS: readonly AdminUser[] = [
  { username: 'admin', email: 'sam.lee@naughtythings.com.hk', displayName: 'Admin' }
] as const;

/** Look up the email for a given username (case-insensitive). Returns null if unknown. */
export function usernameToEmail(username: string): string | null {
  const u = username.trim().toLowerCase();
  if (!u) return null;
  const match = USERS.find(x => x.username.toLowerCase() === u);
  return match?.email ?? null;
}
