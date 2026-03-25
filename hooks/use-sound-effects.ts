"use client";

// Sound effects disabled - all functions are no-ops

type SoundType = "click" | "success" | "error" | "open" | "close" | "select" | "toggle" | "upload" | "delete" | "submit" | "achievement" | "notification";
type ThemeId = "light" | "dark" | "galaxy" | "solar";

export function updateCachedTheme(_theme: ThemeId) {
  // No-op
}

export function useSoundEffects() {
  return {
    playSound: (_sound: SoundType) => {},
    soundEnabled: false,
    toggleSound: () => {},
  };
}

export function playGlobalSound(_sound: SoundType) {
  // No-op - sound effects disabled
}

export function setGlobalSoundEnabled(_enabled: boolean) {
  // No-op
}

export type { SoundType, ThemeId };
