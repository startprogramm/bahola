"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/lib/i18n/language-context";
import type { Language } from "@/lib/i18n/translations";

/**
 * Invisible component that syncs language between DB (via NextAuth session) and localStorage.
 * Rendered in the dashboard layout.
 *
 * On mount (login): reads DB language from session → sets localStorage.
 * On language change (user action): syncs new language → DB + JWT.
 */
export function LanguageSync() {
  const { data: session, update } = useSession();
  const { language, setLanguage } = useLanguage();
  const initialSyncDone = useRef(false);

  // On mount: sync DB language → localStorage
  useEffect(() => {
    if (!session?.user || initialSyncDone.current) return;

    const dbLanguage = session.user.language as Language | undefined;
    if (dbLanguage && ["en", "uz", "ru"].includes(dbLanguage)) {
      setLanguage(dbLanguage);
    }
    initialSyncDone.current = true;
  }, [session, setLanguage]);

  // On language change (after initial sync): sync to DB + JWT
  useEffect(() => {
    if (!initialSyncDone.current || !session?.user) return;

    // Only sync if language differs from what's in the session
    if (language === session.user.language) return;

    // Fire-and-forget: update DB
    fetch("/api/user/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    }).catch(() => {
      // silently ignore errors
    });

    // Update JWT session
    update({ language }).catch(() => {
      // silently ignore errors
    });
  }, [language, session, update]);

  return null;
}
