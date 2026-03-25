"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Language, t as translate, TranslationKey } from "./translations";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LANGUAGE_STORAGE_KEY = "app-language";

// Get initial language from localStorage (client-side only)
function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "uz";
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
    if (saved && ["en", "uz", "ru"].includes(saved)) {
      return saved;
    }
  } catch {
    // Ignore
  }
  return "uz";
}

const LanguageContext = createContext<LanguageContextType>({
  language: "uz",
  setLanguage: () => {},
  t: (key) => translate(key, "uz"),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("uz");

  // Load from localStorage on mount
  useEffect(() => {
    const saved = getInitialLanguage();
    if (saved !== "uz") {
      setLanguageState(saved);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      } catch {
        // Ignore
      }
    }
  };

  const t = (key: TranslationKey): string => {
    return translate(key, language);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

// HOC for components that need translation
export function withLanguage<P extends object>(
  Component: React.ComponentType<P & { t: (key: TranslationKey) => string; language: Language }>
) {
  return function WrappedComponent(props: P) {
    const { t, language } = useLanguage();
    return <Component {...props} t={t} language={language} />;
  };
}
