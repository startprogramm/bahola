import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector, invalidateDirectorAuthCache } from "@/lib/director/auth";
import { invalidateSchoolServerCache } from "@/lib/server-cache";

/**
 * GET /api/director/school-settings
 * Returns school info + director user name for the settings page.
 */
export async function GET() {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school, session } = auth;

  const directorUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });

  const response = NextResponse.json({
    school: {
      id: school.id,
      name: school.name,
      address: school.address ?? "",
      phone: school.phone ?? "",
      email: school.email ?? "",
    },
    director: {
      name: directorUser?.name ?? "",
      email: directorUser?.email ?? "",
    },
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

/**
 * PATCH /api/director/school-settings
 * Updates school fields and optionally the director's display name.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school, session } = auth;

  const body = await req.json();
  const { name, address, phone, email, directorName } = body as {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    directorName?: string;
  };

  if (name !== undefined && (!name || name.trim().length < 2)) {
    return NextResponse.json({ error: "Maktab nomi kamida 2 ta belgi bo'lishi kerak" }, { status: 400 });
  }

  const updates: Promise<unknown>[] = [];

  updates.push(
    prisma.school.update({
      where: { id: school.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(address !== undefined && { address: address.trim() || null }),
        ...(phone !== undefined && { phone: phone.trim() || null }),
        ...(email !== undefined && { email: email.trim() || null }),
      },
    })
  );

  if (directorName !== undefined && directorName.trim().length >= 2) {
    updates.push(
      prisma.user.update({
        where: { id: session.user.id },
        data: { name: directorName.trim() },
      })
    );
  }

  await Promise.all(updates);

  // Invalidate server-side caches so the sidebar and other components
  // pick up the updated school name immediately.
  invalidateDirectorAuthCache(session.user.id);
  invalidateSchoolServerCache(session.user.id);

  const response = NextResponse.json({ success: true });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
