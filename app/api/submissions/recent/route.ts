import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "5");

    const submissions = await prisma.submission.findMany({
      where: {
        assessment: {
          class: {
            teacherId: session.user.id,
          },
        },
      },
      select: {
        id: true,
        status: true,
        score: true,
        maxScore: true,
        createdAt: true,
        student: {
          select: { name: true },
        },
        assessment: {
          select: {
            id: true,
            title: true,
            class: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ submissions }, {
      headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Error fetching recent submissions:", error);
    return NextResponse.json(
      { error: "Failed to fetch submissions" },
      { status: 500 }
    );
  }
}
