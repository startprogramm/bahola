import { invalidateCache } from "@/lib/director/use-cached-fetch";
import { invalidateAllCache } from "@/lib/fetch-cache";

/**
 * Clears all user-specific data from localStorage and sessionStorage.
 * Should be called before signOut so that switching accounts starts clean.
 *
 * Keys intentionally preserved: "app-theme"
 * (this is a device/browser preference, not account-specific data)
 *
 * "app-language" is cleared because language is now account-specific (synced to DB).
 */
export function clearUserCache() {
  if (typeof window === "undefined") return;

  // --- localStorage: account-specific keys ---
  const localKeysToRemove = [
    "sidebar-pinned",
    "sidebar-teaching-collapsed",
    "sidebar-enrolled-collapsed",
    "sidebar-toReview-collapsed",
    "hiddenClassIds",
    "watched-submissions",
    "app-notifications",
    "ai-assistant-messages",
    "ai-assistant-pos",
    "app-language",
  ];

  for (const key of localKeysToRemove) {
    localStorage.removeItem(key);
  }

  // --- sessionStorage: clear everything (all keys are account-specific cache) ---
  sessionStorage.clear();

  // --- in-memory cache: clear director dashboard fetch cache ---
  invalidateCache();
  invalidateAllCache();
}
