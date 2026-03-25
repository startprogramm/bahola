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

    const studentId = session.user.id;

    // Get recent assessments from enrolled classes in a single query
    const assessments = await prisma.assessment.findMany({
      where: {
        status: "ACTIVE",
        class: {
          enrollments: { some: { studentId } },
        },
      },
      select: {
        id: true,
        title: true,
        totalMarks: true,
        dueDate: true,
        status: true,
        createdAt: true,
        class: {
          select: { name: true },
        },
        submissions: {
          where: { studentId },
          select: {
            id: true,
            score: true,
            maxScore: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ assessments }, {
      headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Error fetching recent assessments:", error);
    return NextResponse.json(
      { error: "Failed to fetch assessments" },
      { status: 500 }
    );
  }
}
