import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return NextResponse.json({ error: "Code required" }, { status: 400 });
    }

    const cls = await prisma.class.findUnique({
      where: { code },
      select: { id: true, name: true },
    });

    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    return NextResponse.json(cls);
  } catch (error) {
    console.error("Error finding class by code:", error);
    return NextResponse.json({ error: "Failed to find class" }, { status: 500 });
  }
}
