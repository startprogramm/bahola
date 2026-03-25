import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Generate a short ETag from JSON-serializable data.
 * Uses MD5 of JSON string, truncated to 12 chars (sufficient for collision avoidance).
 */
export function generateETag(data: unknown): string {
  const json = JSON.stringify(data);
  return `"${crypto.createHash("md5").update(json).digest("hex").slice(0, 12)}"`;
}

/**
 * Check If-None-Match header against an ETag.
 * Returns a 304 response if they match, or null if the data should be sent.
 */
export function checkNotModified(request: NextRequest, etag: string): NextResponse | null {
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
      },
    });
  }
  return null;
}

/**
 * Create a JSON response with ETag header.
 */
export function jsonWithETag(
  data: unknown,
  etag: string,
  extraHeaders?: Record<string, string>
): NextResponse {
  return NextResponse.json(data, {
    headers: {
      ETag: etag,
      "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
      ...extraHeaders,
    },
  });
}
