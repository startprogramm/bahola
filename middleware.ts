import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { getCrossAppAccessViolation } from "./lib/app-access";
import { isMaktab } from "./lib/platform";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth check for public routes
  if (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/join/") ||
    pathname.startsWith("/blog") ||
    pathname.startsWith("/api/blog") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/click") ||
    pathname.startsWith("/api/telegram") ||
    pathname.startsWith("/api/school-inquiry") ||
    pathname.startsWith("/api/app/version-check") ||
    pathname.startsWith("/payment") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icon") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Check JWT token (no DB call - just validates the token)
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Redirect unauthenticated users to login
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const accessViolation = getCrossAppAccessViolation({
    email: token.email as string | null,
    schoolId: (token as { schoolId?: string | null }).schoolId ?? null,
  });

  if (accessViolation) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: accessViolation.message, loginUrl: accessViolation.loginUrl },
        { status: 403 }
      );
    }
    return NextResponse.redirect(accessViolation.loginUrl);
  }

  // Both platforms: Redirect DIRECTOR users to /director when they access regular pages
  if (
    isMaktab() &&
    token.role === "DIRECTOR" &&
    !pathname.startsWith("/director") &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/settings") &&
    !pathname.startsWith("/classes") &&
    !pathname.startsWith("/assessments")
  ) {
    return NextResponse.redirect(new URL("/director", request.url));
  }

  // Maktab only: Redirect non-DIRECTOR users away from /director pages
  if (
    isMaktab() &&
    token.role !== "DIRECTOR" &&
    pathname.startsWith("/director")
  ) {
    return NextResponse.redirect(new URL("/classes", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|uploads/|landing/).*)",
  ],
};
