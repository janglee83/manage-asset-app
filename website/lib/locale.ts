/**
 * lib/locale.ts
 *
 * Server-side helper to read the user's locale preference from the
 * "av_locale" cookie set by the client-side LanguageProvider.
 *
 * Only call this from async Server Components or Route Handlers.
 */

import { cookies } from "next/headers";
import type { Locale } from "./i18n";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get("av_locale")?.value;
  return value === "vi" ? "vi" : "en";
}
