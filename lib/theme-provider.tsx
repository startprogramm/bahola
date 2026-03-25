"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

type Theme = string;
type ResolvedTheme = "light" | "dark";

const DEFAULT_THEMES = ["light", "dark"] as const;
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

type ThemeProviderProps = {
  children: React.ReactNode;
  attribute?: "class" | `data-${string}`;
  defaultTheme?: Theme;
  disableTransitionOnChange?: boolean;
  enableColorScheme?: boolean;
  enableSystem?: boolean;
  forcedTheme?: Theme;
  storageKey?: string;
  themes?: Theme[];
  value?: Record<string, string>;
};

type ThemeContextValue = {
  forcedTheme?: Theme;
  resolvedTheme?: ResolvedTheme;
  setTheme: (theme: Theme | ((currentTheme: Theme) => Theme)) => void;
  systemTheme?: ResolvedTheme;
  theme?: Theme;
  themes: Theme[];
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function getStoredTheme(storageKey: string, fallback: Theme): Theme {
  if (typeof window === "undefined") return fallback;

  try {
    return localStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

function withTransitionsDisabled(callback: () => void) {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}"
    )
  );

  document.head.appendChild(style);
  callback();
  window.getComputedStyle(document.body);

  setTimeout(() => {
    document.head.removeChild(style);
  }, 1);
}

function applyThemeToDocument({
  attribute,
  disableTransitionOnChange,
  enableColorScheme,
  resolvedTheme,
  themes,
  value,
}: {
  attribute: ThemeProviderProps["attribute"];
  disableTransitionOnChange: boolean;
  enableColorScheme: boolean;
  resolvedTheme: ResolvedTheme;
  themes: Theme[];
  value?: Record<string, string>;
}) {
  const root = document.documentElement;
  const domThemes = themes.map((theme) => value?.[theme] || theme);
  const nextValue = value?.[resolvedTheme] || resolvedTheme;

  const update = () => {
    if (attribute === "class") {
      root.classList.remove(...domThemes);
      root.classList.add(nextValue);
    } else {
      root.setAttribute(attribute, nextValue);
    }

    if (enableColorScheme) {
      root.style.colorScheme = resolvedTheme;
    }
  };

  if (disableTransitionOnChange) {
    withTransitionsDisabled(update);
    return;
  }

  update();
}

export function ThemeProvider({
  attribute = "class",
  children,
  defaultTheme = "system",
  disableTransitionOnChange = false,
  enableColorScheme = true,
  enableSystem = true,
  forcedTheme,
  storageKey = "theme",
  themes = [...DEFAULT_THEMES],
  value,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const syncSystemTheme = () => setSystemTheme(getSystemTheme());

    syncSystemTheme();

    const mediaQuery = window.matchMedia(MEDIA_QUERY);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncSystemTheme);
      return () => mediaQuery.removeEventListener("change", syncSystemTheme);
    }

    mediaQuery.addListener(syncSystemTheme);
    return () => mediaQuery.removeListener(syncSystemTheme);
  }, []);

  useIsomorphicLayoutEffect(() => {
    setThemeState(getStoredTheme(storageKey, defaultTheme));
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setThemeState(event.newValue || defaultTheme);
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [defaultTheme, storageKey]);

  const activeTheme = forcedTheme ?? theme;
  const resolvedTheme: ResolvedTheme =
    activeTheme === "system" && enableSystem
      ? systemTheme
      : activeTheme === "dark"
        ? "dark"
        : "light";

  useIsomorphicLayoutEffect(() => {
    applyThemeToDocument({
      attribute,
      disableTransitionOnChange,
      enableColorScheme,
      resolvedTheme,
      themes,
      value,
    });
  }, [
    attribute,
    disableTransitionOnChange,
    enableColorScheme,
    resolvedTheme,
    themes,
    value,
  ]);

  const setTheme = useCallback(
    (nextTheme: Theme | ((currentTheme: Theme) => Theme)) => {
      setThemeState((currentTheme) => {
        const resolvedNextTheme =
          typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme;

        try {
          localStorage.setItem(storageKey, resolvedNextTheme);
        } catch {
          // Ignore storage failures and still update the in-memory theme.
        }

        return resolvedNextTheme;
      });
    },
    [storageKey]
  );

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      forcedTheme,
      resolvedTheme,
      setTheme,
      systemTheme: enableSystem ? systemTheme : undefined,
      theme,
      themes: enableSystem ? [...themes, "system"] : themes,
    }),
    [enableSystem, forcedTheme, resolvedTheme, setTheme, systemTheme, theme, themes]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext) ?? {
    forcedTheme: undefined,
    resolvedTheme: undefined,
    setTheme: () => {},
    systemTheme: undefined,
    theme: undefined,
    themes: [...DEFAULT_THEMES],
  };
}
