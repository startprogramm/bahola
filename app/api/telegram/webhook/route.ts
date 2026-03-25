import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/telegram";
import { generateSchoolCode } from "@/lib/school-utils";

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const ADMIN_CHAT_IDS = ["6659975124", "1073934929"];

interface TelegramUpdate {
    message?: {
        from: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
        };
        chat: { id: number };
        text?: string;
    };
}

export async function POST(req: NextRequest) {
    try {
        const update: TelegramUpdate = await req.json();
        const message = update.message;
        if (!message || !message.text) return NextResponse.json({ ok: true });

        const chatId = message.chat.id;
        const text = message.text.trim();
        const from = message.from;
        const username = from.username || `${from.first_name}${from.last_name ? " " + from.last_name : ""}`;

        // /start command
        if (text === "/start") {
            await sendMessage(
                chatId,
                `👋 <b>Xush kelibsiz Bahola botiga!</b>\n\n` +
                `Bahola — sun'iy intellekt yordamida testlarni avtomatik tekshirish tizimi.\n\n` +
                `🌐 <a href="https://teztekshir.uz">teztekshir.uz</a>\n` +
                `🏫 <a href="https://maktab.teztekshir.uz">maktab.teztekshir.uz</a>\n` +
                `💬 <a href="https://t.me/+xL8nCnyQj2xmOGIy">Qo'llab-quvvatlash guruhi</a>\n\n` +
                `📌 <b>Buyruqlar:</b>\n` +
                `/help — Barcha buyruqlar ro'yxati\n` +
                `/support — Yordam olish\n\n` +
                `Savolingiz bormi? Shunchaki xabar yozing yoki guruhga qo'shiling!`
            );
            return NextResponse.json({ ok: true });
        }

        // /help command
        if (text === "/help") {
            await sendMessage(
                chatId,
                `📌 <b>Buyruqlar ro'yxati:</b>\n\n` +
                `/start — Botni boshlash\n` +
                `/help — Barcha buyruqlar\n` +
                `/create_school Nomi — Yangi maktab yaratish\n` +
                `/my_school — Maktab ma'lumotlari\n` +
                `/support — Yordam olish\n\n` +
                `🌐 <a href="https://teztekshir.uz">teztekshir.uz</a>\n` +
                `🏫 <a href="https://maktab.teztekshir.uz">maktab.teztekshir.uz</a>\n` +
                `💬 <a href="https://t.me/+xL8nCnyQj2xmOGIy">Qo'llab-quvvatlash guruhi</a>\n\n` +
                `Xabaringiz 24 soat ichida ko'rib chiqiladi!`
            );
            return NextResponse.json({ ok: true });
        }

        // /support command
        if (text === "/support") {
            await sendMessage(
                chatId,
                `👨‍💻 <b>Yordam</b>\n\n` +
                `Savolingizni shu yerda yozing yoki qo'llab-quvvatlash guruhiga qo'shiling:\n\n` +
                `💬 <a href="https://t.me/+xL8nCnyQj2xmOGIy">Qo'llab-quvvatlash guruhi</a>\n\n` +
                `🌐 <a href="https://teztekshir.uz">teztekshir.uz</a>\n` +
                `🏫 <a href="https://maktab.teztekshir.uz">maktab.teztekshir.uz</a>`
            );
            return NextResponse.json({ ok: true });
        }

        // /create_school command
        if (text.startsWith("/create_school")) {
            const schoolName = text.replace("/create_school", "").trim();
            if (!schoolName || schoolName.length < 2) {
                await sendMessage(
                    chatId,
                    `❌ <b>Maktab nomi kiritilmagan</b>\n\n` +
                    `Foydalanish:\n<code>/create_school Maktab nomi</code>\n\n` +
                    `Misol:\n<code>/create_school 15-sonli maktab</code>`
                );
                return NextResponse.json({ ok: true });
            }

            // Find user linked to this Telegram chat
            const user = await prisma.user.findFirst({
                where: { telegramChatId: String(chatId) },
                select: { id: true, name: true, role: true, schoolId: true },
            });

            if (!user) {
                await sendMessage(
                    chatId,
                    `❌ <b>Hisob topilmadi</b>\n\n` +
                    `Telegram hisobingiz Bahola hisobiga ulanmagan.\n\n` +
                    `Avval Bahola ilovasida "Sozlamalar" sahifasida Telegram hisobingizni ulang.`
                );
                return NextResponse.json({ ok: true });
            }

            // Check if user already has a school
            if (user.schoolId) {
                const existingSchool = await prisma.school.findUnique({
                    where: { id: user.schoolId },
                    select: { name: true },
                });
                await sendMessage(
                    chatId,
                    `⚠️ <b>Sizda allaqachon maktab mavjud</b>\n\n` +
                    `🏫 ${existingSchool?.name}`
                );
                return NextResponse.json({ ok: true });
            }

            // Create school
            const code = await generateSchoolCode();
            const school = await prisma.$transaction(async (tx) => {
                const s = await tx.school.create({
                    data: {
                        name: schoolName,
                        code,
                        directorId: user.id,
                    },
                });

                await tx.user.update({
                    where: { id: user.id },
                    data: { role: "DIRECTOR", schoolId: s.id },
                });

                await tx.schoolMembership.create({
                    data: {
                        userId: user.id,
                        schoolId: s.id,
                        role: "DIRECTOR",
                        status: "active",
                    },
                });

                return s;
            });

            await sendMessage(
                chatId,
                `✅ <b>Maktab yaratildi!</b>\n\n` +
                `🏫 <b>${school.name}</b>\n\n` +
                `Endi Bahola ilovasida direktor paneliga kiring.`
            );

            if (ADMIN_CHAT_ID) {
                await sendMessage(
                    ADMIN_CHAT_ID,
                    `🏫 <b>Yangi maktab yaratildi (Telegram)</b>\n` +
                    `Nomi: ${school.name}\n` +
                    `Direktor: ${user.name} (@${username})`
                );
            }

            return NextResponse.json({ ok: true });
        }

        // /my_school command
        if (text === "/my_school") {
            const user = await prisma.user.findFirst({
                where: { telegramChatId: String(chatId) },
                select: { schoolId: true },
            });

            if (!user?.schoolId) {
                await sendMessage(
                    chatId,
                    `❌ Sizda maktab topilmadi.\n\n/create_school buyrug'i bilan yangi maktab yarating.`
                );
                return NextResponse.json({ ok: true });
            }

            const school = await prisma.school.findUnique({
                where: { id: user.schoolId },
                select: {
                    name: true,
                    _count: {
                        select: {
                            members: true,
                            classes: { where: { archived: false } },
                        },
                    },
                },
            });

            if (school) {
                await sendMessage(
                    chatId,
                    `🏫 <b>${school.name}</b>\n\n` +
                    `👥 A'zolar: ${school._count.members}\n` +
                    `📚 Sinflar: ${school._count.classes}`
                );
            }

            return NextResponse.json({ ok: true });
        }

        // /reply command — admin only
        if (text.startsWith("/reply")) {
            if (!ADMIN_CHAT_IDS.includes(String(chatId))) {
                await sendMessage(chatId, `❌ Bu buyruq faqat adminlar uchun.`);
                return NextResponse.json({ ok: true });
            }

            const parts = text.replace("/reply", "").trim().split(/\s+/);
            const targetChatId = parts[0];
            const replyMessage = parts.slice(1).join(" ").trim();

            if (!targetChatId || !replyMessage) {
                await sendMessage(
                    chatId,
                    `❌ <b>Foydalanish:</b>\n<code>/reply CHAT_ID xabar matni</code>`
                );
                return NextResponse.json({ ok: true });
            }

            await sendMessage(
                targetChatId,
                `💬 <b>Admin javobi:</b>\n\n${replyMessage}`
            );

            await sendMessage(
                chatId,
                `✅ Xabar yuborildi (chat: ${targetChatId})`
            );

            return NextResponse.json({ ok: true });
        }

        // Store feedback (any other message)
        await prisma.feedback.create({
            data: {
                telegramUserId: String(chatId),
                telegramUsername: username,
                message: text,
            },
        });

        await sendMessage(
            chatId,
            `✅ <b>Xabar qabul qilindi!</b>\n\nXabaringiz 24 soat ichida ko'rib chiqiladi.`
        );

        if (ADMIN_CHAT_ID) {
            for (const adminId of ADMIN_CHAT_IDS) {
                await sendMessage(
                    adminId,
                    `📩 <b>Yangi xabar</b>\nKimdan: ${from.first_name} (@${username})\n🆔 <code>/reply ${chatId}</code>\n\n${text}`
                );
            }
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[Telegram webhook] Error:", error);
        return NextResponse.json({ ok: true });
    }
}
