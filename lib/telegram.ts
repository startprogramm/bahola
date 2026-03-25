const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function sendMessage(chatId: number | string, text: string, parseMode: "HTML" | "Markdown" = "HTML") {
    if (!BOT_TOKEN) return;
    try {
        await fetch(`${API_BASE}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: parseMode,
                disable_web_page_preview: true,
            }),
        });
    } catch (e) {
        console.error("[Telegram] sendMessage error:", e);
    }
}

export async function setWebhook(url: string) {
    const res = await fetch(`${API_BASE}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url }),
    });
    return res.json();
}

export async function getWebhookInfo() {
    const res = await fetch(`${API_BASE}/getWebhookInfo`);
    return res.json();
}

export async function sendGradingNotification({
    chatId,
    studentName,
    assessmentTitle,
    className,
    score,
    maxScore,
    feedbackUrl,
    language = "en",
}: {
    chatId: number | string;
    studentName: string;
    assessmentTitle: string;
    className: string;
    score: number;
    maxScore: number;
    feedbackUrl: string;
    language?: string;
}) {
    const percentage = Math.round((score / maxScore) * 100);
    const emoji = percentage >= 80 ? "🟢" : percentage >= 60 ? "🟡" : percentage >= 40 ? "🟠" : "🔴";

    let text: string;
    if (language === "uz") {
        text = `${emoji} <b>Baholash natijasi</b>\n\n📚 <b>${assessmentTitle}</b>\n🏫 ${className}\n\n✅ Ball: <b>${score}/${maxScore}</b> (${percentage}%)\n\n<a href="${feedbackUrl}">Batafsil ko'rish →</a>`;
    } else if (language === "ru") {
        text = `${emoji} <b>Результат проверки</b>\n\n📚 <b>${assessmentTitle}</b>\n🏫 ${className}\n\n✅ Балл: <b>${score}/${maxScore}</b> (${percentage}%)\n\n<a href="${feedbackUrl}">Посмотреть подробнее →</a>`;
    } else {
        text = `${emoji} <b>Your work has been graded!</b>\n\n📚 <b>${assessmentTitle}</b>\n🏫 ${className}\n\n✅ Score: <b>${score}/${maxScore}</b> (${percentage}%)\n\n<a href="${feedbackUrl}">View feedback →</a>`;
    }

    await sendMessage(chatId, text);
}
