import { NextRequest, NextResponse } from "next/server";
import { setWebhook, getWebhookInfo } from "@/lib/telegram";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function isTeacherUser(userId: string): Promise<boolean> {
    const [ownedClass, coTeachingEnrollment] = await Promise.all([
        prisma.class.findFirst({
            where: { teacherId: userId },
            select: { id: true },
        }),
        prisma.enrollment.findFirst({
            where: { studentId: userId, role: "TEACHER" },
            select: { id: true },
        }),
    ]);

    return Boolean(ownedClass || coTeachingEnrollment);
}

// GET: check current webhook status
export async function GET(_req: NextRequest) {
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hasTeacherAccess = await isTeacherUser(session.user.id);
    if (!hasTeacherAccess) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const info = await getWebhookInfo();
    return NextResponse.json(info);
}

// POST: register the webhook with Telegram
export async function POST(_req: NextRequest) {
    const session = await getAuthSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hasTeacherAccess = await isTeacherUser(session.user.id);
    if (!hasTeacherAccess) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const baseUrl = process.env.NEXTAUTH_URL || "https://teztekshir.uz";
    const webhookUrl = `${baseUrl}/api/telegram/webhook`;
    const result = await setWebhook(webhookUrl);
    return NextResponse.json(result);
}
