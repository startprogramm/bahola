import { NextRequest, NextResponse } from "next/server";

/**
 * App version check endpoint.
 * Mobile apps call this on startup to check if they need to update.
 *
 * Update these values when releasing new mobile app versions.
 */
const APP_CONFIG = {
  android: {
    minVersion: "1.0.0",       // Minimum supported version (force update below this)
    latestVersion: "1.0.0",    // Latest available version
    updateUrl: "https://play.google.com/store/apps/details?id=uz.teztekshir.app",
  },
  ios: {
    minVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateUrl: "https://apps.apple.com/app/teztekshir/id000000000",
  },
};

function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }
  return 0;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") as "android" | "ios" | null;
  const currentVersion = searchParams.get("version");

  if (!platform || !APP_CONFIG[platform]) {
    return NextResponse.json(
      { error: "Invalid platform. Use 'android' or 'ios'." },
      { status: 400 }
    );
  }

  if (!currentVersion) {
    return NextResponse.json(
      { error: "Version parameter is required." },
      { status: 400 }
    );
  }

  const config = APP_CONFIG[platform];
  const forceUpdate = compareVersions(currentVersion, config.minVersion) < 0;
  const updateAvailable = compareVersions(currentVersion, config.latestVersion) < 0;

  return NextResponse.json({
    forceUpdate,
    updateAvailable,
    latestVersion: config.latestVersion,
    minVersion: config.minVersion,
    updateUrl: config.updateUrl,
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
