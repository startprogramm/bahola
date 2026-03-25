---
title: "Sun'iy intellekt baholash qanday ishlaydi: Rasmdan fikr-mulohazagacha bir necha soniyada"
date: "2026-03-17"
author: "TezTekshir jamoasi"
language: "uz"
slug: "how-ai-grading-works"
excerpt: "O'quvchi ishini topshirganda sahna ortida nima bo'lishiga qiziqasizmi? Mana TezTekshir sun'iy intellekt baholash tizimining oddiy tilda tushuntirishi — rasm yuklashdan batafsil fikr-mulohazagacha."
coverImage: "/blog/cover-how-ai-grading-works.png"
theme: "indigo"
---

# Sun'iy intellekt baholash qanday ishlaydi: Rasmdan fikr-mulohazagacha bir necha soniyada

O'quvchi ishining fotosuratini yuklasa va bir necha soniyada ball hamda batafsil fikr-mulohaza olsa, bu sehr kabi tuyulishi mumkin. Ammo bu sehr emas — bu kompyuter ko'rishi, katta til modellari va sizning javoblar sxemangizni birlashtiruvchi puxta ishlab chiqilgan jarayon. Aynan nima sodir bo'lishini tushuntirib beramiz.

## 1-qadam: Rasm yuklash va tayyorlash

O'quvchi yozma ishini suratga oladi — bir sahifa yoki bir nechta. TezTekshir umumiy formatlardagi rasmlarni (PNG, JPG, WebP) qabul qiladi va sudrab tashlash, vaqtinchalik xotiradan joylashtirish va to'g'ridan-to'g'ri yuklashni qo'llab-quvvatlaydi. Katta fayllar tezlikni saqlash uchun avtomatik ravishda siqiladi.

O'quvchi bir nechta sahifa yuklagan bo'lsa, TezTekshir har bir rasm haqiqiy tarkib sahifasi ekanligini (bo'sh yoki tasodifiy rasm emas) tekshirish uchun qayta ishlashdan oldin tezkor sun'iy intellekt skanini ishlatadi.

## 2-qadam: OCR — Qo'l yozuvini o'qish

Bu yerda asosiy ish boshlanadi. TezTekshir har bir rasmda optik belgilarni tanish (OCR) vazifasini bajarish uchun **Google Gemini'ning ko'ruv imkoniyatlaridan** foydalanadi.

Qo'l yozuvida qiynaladigao an'anaviy OCR vositalaridan farqli o'laroq, Gemini — bu kontekstni tushunadigan ko'p qirrali katta til modeli. U quyidagilarni bajara oladi:
- Chalkash yoki qo'shma qo'l yozuvini o'qish
- Matematik belgilar va tenglamalarni aniqlash
- Aralash tilli matnni qayta ishlash (bir javobda o'zbek + rus)
- Diagrammalar, jadvallar va belgilangan chizmalarni ajratib olish

Natijada o'quvchi yozgan hamma narsaning matn transkripsiyasi hosil bo'ladi.

## 3-qadam: Javoblar sxemasini qayta ishlash

Baholash amalga oshirilishidan oldin, TezTekshir to'g'ri javob qanday ko'rinishini tushunishi kerak. O'qituvchi vazifa yaratganda, javoblar sxemasini yuklaydi — bu PDF, Word hujjati, Excel jadvali yoki rasmlar bo'lishi mumkin. TezTekshir bu fayllarni ham OCR qilib, to'liq baholash mezonlarini matn shaklida ajratib oladi.

Ushbu javoblar sxemasi matni sun'iy intellekt baholash uchun foydalanradigan manbasi hisoblanadi. U har bir vazifa uchun bir marta saqlanadi va har bir topshiriq uchun qayta ishlatiladi.

## 4-qadam: Sun'iy intellekt baholash — O'quvchi ishini javoblar sxemasi bilan solishtirish

Endi asosiy baholash bosqichi. TezTekshir ikkala matnni ham — o'quvchining ajratib olingan javoblari va javoblar sxemasini — savol tuzilishi va ball taqsimoti bilan birga **Gemini'ga** yuboradi.

Sun'iy intellekt bilimli imtihon qabul qiluvchi kabi harakat qiladi. U:
- Har bir o'quvchi javobini tegishli savolga moslashtiradi
- Javoblar sxemasidagi asosiy fikrlar yoritilganligini tekshiradi
- Javob mezonlarga qanchalik mos kelishiga qarab har bir savol uchun ball beradi
- Har bir savol uchun aniq, konstruktiv fikr-mulohaza yozadi

Gemini faqat kalit so'zlarni moslashtirmaydi — u ma'noni tushunadi. Kontseptsiyani to'g'ri tushuntirgan, lekin javoblar sxemasidan farqli terminologiyadan foydalangan o'quvchi baribir kredit oladi.

## 5-qadam: Fikr-mulohazani taqdim etish

Baholangan natija saqlanadi va o'qituvchi ham, o'quvchiga ham ko'rsatiladi:
- Ball qayerda olinib, qayerda yo'qotilganini ko'rsatuvchi **har bir savol bo'yicha ball**
- Nima yaxshi bajarilgani, nima yetishmayotgani va qanday takomillashtirish mumkinligini tushuntiradigan **yozma fikr-mulohaza**
- Maksimal ballning ulushi sifatida **umumiy ball** (masalan, 18/25)

Fikr-mulohaza o'qituvchi sinf uchun tanlagan tilda — o'zbek, rus yoki ingliz tilida shakllantiriladi. O'quvchilar natijalarini darhol ko'radi; o'qituvchilar sinf baholar jurnali ko'rinishida barcha topshiriqlarni ko'rib chiqishi mumkin.

## Aniqlik haqida nima deyish mumkin?

Sun'iy intellekt baholash aniq to'g'ri/noto'g'ri mezonlarga ega tuzilgan vazifalar uchun juda aniq (qisqa javoblar, ta'riflar, faktual savollar). Ochiq yoki ijodiy ishlar uchun TezTekshir o'qituvchilar moslashtirishi mumkin bo'lgan boshlang'ich nuqtani taqdim etadi.

O'qituvchilar shuningdek **alohida savollarni qayta baholashlari** mumkin — agar sun'iy intellekt biror narsani o'tkazib yuborgan bo'lsa yoki o'quvchi qisman kredit haqiga loyiq bo'lsa, o'qituvchi ballni bekor qilishi va izoh qo'shishi mumkin. Barcha tuzatmalar shaffoflik uchun qayd etiladi.

## Texnologiya to'plami

- **OCR va rasmni tushunish:** Google Gemini (ko'p qirrali)
- **Baholash intellekti:** Gemini 3 Flash Preview
- **Sahifani aniqlash:** Gemini 2.0 Flash Lite
- **Rasmni qayta ishlash:** Sharp (server tomonida siqish va formatlash)
- **Navbat boshqaruvi:** 6 ta parallel baholash ishi bilan xotira ichidagi FIFO navbati

Butun jarayon bir vaqtning o'zida 30 ta topshiriqni bajarish uchun mo'ljallangan va butun sinf uchun 1–2 daqiqa ichida natijalarni taqdim etadi.

---

*Buni amalda ko'rishni xohlaysizmi? [Bepul hisob yarating](#) va bugun birinchi sun'iy intellekt tomonidan baholangan vazifangizni bajaring.*
