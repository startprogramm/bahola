import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
    try {
        const session = await getAuthSession();

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const ids: string[] = body.ids;

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json(
                { error: "ids must be a non-empty array" },
                { status: 400 }
            );
        }

        // Cap at 50 to prevent abuse
        const limitedIds = ids.slice(0, 50);

        const submissions = await prisma.submission.findMany({
            where: {
                id: { in: limitedIds },
                studentId: session.user.id,
            },
            select: {
                id: true,
                status: true,
                score: true,
                maxScore: true,
            },
        });

        return NextResponse.json({ submissions });
    } catch (error) {
        console.error("Error fetching batch submission statuses:", error);
        return NextResponse.json(
            { error: "Failed to fetch submission statuses" },
            { status: 500 }
        );
    }
}
