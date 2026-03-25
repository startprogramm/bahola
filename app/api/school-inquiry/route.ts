import { NextRequest, NextResponse } from "next/server";
import { sendMessage } from "@/lib/telegram";

/**
 * POST /api/school-inquiry
 * Receives school inquiry from the maktab login page and notifies admins via Telegram.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { schoolNumber, location, studentCount, teacherCount, phone, telegram } = body;

    if (!schoolNumber?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: "Maktab nomi va telefon raqam kiritilishi shart" },
        { status: 400 }
      );
    }

    // Build notification message
    const message =
      `🏫 <b>Yangi maktab so'rovi!</b>\n\n` +
      `📝 <b>Maktab:</b> ${schoolNumber}\n` +
      `📍 <b>Joylashuv:</b> ${location || "Ko'rsatilmagan"}\n` +
      `👨‍🎓 <b>O'quvchilar:</b> ${studentCount || "Ko'rsatilmagan"}\n` +
      `👨‍🏫 <b>O'qituvchilar:</b> ${teacherCount || "Ko'rsatilmagan"}\n` +
      `📞 <b>Telefon:</b> ${phone}\n` +
      `💬 <b>Telegram:</b> ${telegram || "Ko'rsatilmagan"}\n\n` +
      `📅 ${new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`;

    // Send to all configured notification chat IDs
    const chatIds = (process.env.TELEGRAM_INQUIRY_CHAT_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    // Also send to admin chat ID as fallback
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId && !chatIds.includes(adminChatId)) {
      chatIds.push(adminChatId);
    }

    await Promise.all(chatIds.map((chatId) => sendMessage(chatId, message)));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[School Inquiry] Error:", error);
    return NextResponse.json({ error: "Server xatosi" }, { status: 500 });
  }
}
