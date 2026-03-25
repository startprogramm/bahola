"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Brain,
  Check,
  CheckCircle,
  ChevronDown,

  FileText,
  Menu,
  Shield,
  Sparkles,
  Star,
  Target,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { LogoIcon } from "@/components/logo";
import { EidBanner } from "@/components/eid-banner";
/* ── Data ────────────────────────────────────────────────── */

const navItems = [
  { label: "Imkoniyatlar", href: "#features" },
  { label: "Jarayon", href: "#workflow" },
  { label: "Narxlar", href: "#pricing" },
  { label: "Savollar", href: "#faq" },
  { label: "Blog", href: "/blog" },
];

type Feature = {
  title: string;
  description: string;
  icon: LucideIcon;
};

const coreFeatures: Feature[] = [
  {
    title: "Savolma-savol baholash",
    description:
      "Har bir javob baholash mezoni asosida tekshirilib, batafsil izoh beriladi.",
    icon: Target,
  },
  {
    title: "Qo'lyozmani raqamlashtirish",
    description:
      "Rasm yoki PDF yuklang — OCR tizimi javoblarni soniyalar ichida raqamlashtiradi.",
    icon: FileText,
  },
  {
    title: "Xalqaro standartlarga mos",
    description:
      "Edexcel, Cambridge, AQA va IB talablari asosida baholash jarayoni.",
    icon: Shield,
  },
  {
    title: "Sinf boshqaruvi",
    description:
      "Sinflar yarating, topshiriqlar bering va natijalarni bitta paneldan kuzating.",
    icon: Users,
  },
  {
    title: "Tezkor tahrirlash",
    description:
      "Baholarni qo'lda tahrirlang, izoh qoldiring va o'zgarishlar tarixini saqlang.",
    icon: Zap,
  },
  {
    title: "Ko'p tilli izohlar",
    description:
      "O'quvchilarga o'zbek, ingliz yoki rus tilida tushuntirish bering.",
    icon: Brain,
  },
];

const workflowSteps = [
  {
    title: "Baholash mezonini yuklang",
    description:
      "O'qituvchi baholash mezonini bir marta yuklaydi — PDF, Word yoki rasm ko'rinishida. Tizim uni avtomatik tahlil qiladi va keyingi barcha tekshirishlar uchun tayyor holda saqlaydi.",
    image: "/landing/step1.png",
  },
  {
    title: "O'quvchilar ishlarini topshiradi",
    description:
      "O'quvchilar sinf kodini kiritib, yozma ishlarini telefondan rasmga olib yoki PDF yuklash orqali topshiradilar. Ko'p sahifali ishlar ham qabul qilinadi va sahifalar avtomatik tartibga solinadi.",
    image: "/landing/step2.png",
  },
  {
    title: "AI har bir savolni tekshiradi",
    description:
      "Sun'iy intellekt har bir savolni baholash mezoni bilan alohida solishtiradi. Javob to'g'riligi, yechim usuli va mantiqiy izchillik hisobga olinadi. Edexcel, Cambridge, AQA va boshqa standartlar qo'llab-quvvatlanadi.",
    image: "/landing/step3.png",
  },
  {
    title: "Foydali xulosalar qaytariladi",
    description:
      "O'quvchi darhol batafsil hisobot oladi: har bir savol bo'yicha ball, qayerda xato qilgani va qanday yaxshilash mumkinligi haqida aniq tavsiyalar. O'qituvchi istalgan vaqt bahoni tahrirlashi mumkin.",
    image: "/landing/step4.png",
  },
];

type Plan = {
  name: string;
  monthlyPrice: string;
  annualPricePerMonth: string;
  annualTotalPrice: string;
  annualDiscount: string;
  cadenceMonthly: string;
  summary: string;
  features: string[];
  cta: string;
  featured: boolean;
  darkFeatured?: boolean;
};

const plans: Plan[] = [
  {
    name: "Boshlang'ich",
    monthlyPrice: "Bepul",
    annualPricePerMonth: "Bepul",
    annualTotalPrice: "",
    annualDiscount: "",
    cadenceMonthly: "",
    summary: "Tizimni sinab ko'rish uchun",
    features: [
      "50 AI kredit / oy",
      "Fayl: 5 MB gacha",
      "3 ta parallel baholash",
      "Asosiy natijalar ko'rinishi",
    ],
    cta: "Bepul boshlash",
    featured: false,
  },
  {
    name: "Plus",
    monthlyPrice: "29,000",
    annualPricePerMonth: "19,000",
    annualTotalPrice: "228,000",
    annualDiscount: "-34%",
    cadenceMonthly: "so'm / oy",
    summary: "Faol o'qituvchilar uchun",
    features: [
      "300 AI kredit / oy",
      "Fayl: 20 MB gacha",
      "10 ta parallel baholash",
      "Batafsil natijalar tahlili",
      "Email yordami",
    ],
    cta: "Plus tanlash",
    featured: true,
  },
  {
    name: "Pro",
    monthlyPrice: "99,000",
    annualPricePerMonth: "49,000",
    annualTotalPrice: "588,000",
    annualDiscount: "-51%",
    cadenceMonthly: "so'm / oy",
    summary: "Kafedra va maktablar uchun",
    features: [
      "Cheksiz AI kredit",
      "Fayl: 50 MB gacha",
      "20 ta parallel baholash (ustuvor)",
      "To'liq analitika va eksport",
      "Ustuvor yordam",
    ],
    cta: "Pro tanlash",
    featured: false,
    darkFeatured: true,
  },
];

const faqs: { question: string; answer: string; bullets: string[] }[] = [
  {
    question: "O'qituvchilar AI bahosini o'zgartira oladimi?",
    answer: "Ha, albatta. Tizim har doim o'qituvchi nazorati ostida ishlaydi:",
    bullets: [
      "Har qanday bahoni qo'lda tahrirlash mumkin — sabab ko'rsatib",
      "O'zgartirish tarixi to'liq saqlanib qoladi",
      "Bir nechta o'qituvchi ham baho qo'ya oladi (hamkorlik rejimi)",
      "O'quvchiga yangilangan baho va izoh avtomatik yuboriladi",
    ],
  },
  {
    question: "Qanday fayl turlari qo'llab-quvvatlanadi?",
    answer: "Tizim keng formatlarni qabul qiladi:",
    bullets: [
      "Baholash mezoni uchun: PDF, Word (.docx), Excel (.xlsx), PNG, JPG",
      "O'quvchi ishlari uchun: PNG, JPG, GIF, WebP rasmlari (har biri max 10 MB)",
      "Ko'p sahifali PDF va bir nechta rasmli ishlar to'liq qabul qilinadi",
      "Telefon kamerasi orqali tushirilgan rasmlar ham to'g'ri ishlaydi",
    ],
  },
  {
    question: "O'quvchi ma'lumotlari xavfsizmi?",
    answer: "Ha. Ma'lumotlar himoyasi asosiy ustuvorligimiz:",
    bullets: [
      "Barcha ma'lumotlar shifrlangan holda saqlanadi",
      "O'quvchi natijalarini faqat tegishli o'qituvchisi ko'ra oladi",
      "Uchinchi tomonlarga hech qanday ma'lumot uzatilmaydi",
      "Sessiya muddati tugagach foydalanuvchi avtomatik chiqariladi",
    ],
  },
  {
    question: "Tekshirish qancha vaqt oladi?",
    answer: "Tekshirish vaqti fayl hajmi va murakkabligiga bog'liq:",
    bullets: [
      "Oddiy ishlar (1–4 sahifa): 1–3 daqiqa",
      "Ko'p sahifali ishlar (5–12 sahifa): 3–7 daqiqa",
      "Bir vaqtda ko'p o'quvchi topshirsa ham navbat avtomatik boshqariladi",
      "Tekshirish tugagach o'qituvchiga bildirish yuboriladi",
    ],
  },
  {
    question: "Bir nechta sinf yaratish mumkinmi?",
    answer: "Ha, sinflar boshqaruvi moslashuvchan tarzda ishlaydi:",
    bullets: [
      "Boshlang'ich rejada: 5 tagacha sinf",
      "Plus va Pro rejalarida: cheksiz sinf yaratish mumkin",
      "Har bir sinfga alohida baholash va topshiriqlar berish mumkin",
      "O'quvchilar sinf kodi orqali qo'shiladi — ro'yxatdan o'tish talab qilinmaydi",
    ],
  },
  {
    question: "AI baholash qanchalik aniq?",
    answer: "AI baholash tajribali o'qituvchi darajasida ishlaydi:",
    bullets: [
      "Tajribali o'qituvchi baholari bilan 95% mos kelish darajasi",
      "Edexcel, Cambridge, AQA va IB standartlarini to'liq qo'llab-quvvatlaydi",
      "Har bir javobga to'liq izoh va yaxshilash bo'yicha aniq tavsiyalar beriladi",
      "Noaniq holatlarda tizim belgini qo'yib o'qituvchiga tekshirishni tavsiya qiladi",
    ],
  },
  {
    question: "Qanday to'lov usullari qabul qilinadi?",
    answer: "To'lov jarayoni qulay va xavfsiz:",
    bullets: [
      "Click to'lov tizimi orqali bank kartasi bilan to'lash mumkin",
      "Oylik yoki yillik obuna tanlash imkoni bor",
      "Yillik obunada 51% gacha chegirma mavjud",
      "To'lov tarixini profil sahifasidan ko'rish mumkin",
    ],
  },
  {
    question: "O'quvchilar o'z natijalarini ko'ra oladimi?",
    answer: "Ha, o'quvchilar o'z sinfiga kirib:",
    bullets: [
      "Har bir savol bo'yicha batafsil izoh va ballni ko'ra oladi",
      "Qayerda xato qilganini va nima yaxshilash kerakligini aniq biladi",
      "O'qituvchi tomonidan qo'shilgan shaxsiy izohlarni ko'radi",
      "Barcha topshiriqlar tarixi saqlanib, istalgan vaqt qayta ko'rish mumkin",
    ],
  },
];

const stats = [
  { value: "10,000+", label: "Tekshirilgan ishlar" },
  { value: "95%", label: "Aniqlik darajasi" },
  { value: "3 daqiqa", label: "O'rtacha tekshirish" },
  { value: "100+", label: "Faol o'qituvchilar" },
];

/* ── Feature icon accent colors (vary instead of all-blue) ── */

const featureAccents = [
  { bg: "bg-blue-50",    text: "text-blue-600",   hoverBg: "group-hover:bg-blue-600",   shadow: "0 8px 28px rgba(59,130,246,0.22)",  barColor: "#2563eb" },
  { bg: "bg-teal-50",    text: "text-teal-600",   hoverBg: "group-hover:bg-teal-600",   shadow: "0 8px 28px rgba(20,184,166,0.22)",  barColor: "#0d9488" },
  { bg: "bg-indigo-50",  text: "text-indigo-600", hoverBg: "group-hover:bg-indigo-600", shadow: "0 8px 28px rgba(99,102,241,0.22)",  barColor: "#4f46e5" },
  { bg: "bg-emerald-50", text: "text-emerald-600",hoverBg: "group-hover:bg-emerald-600",shadow: "0 8px 28px rgba(16,185,129,0.22)",  barColor: "#059669" },
  { bg: "bg-amber-50",   text: "text-amber-600",  hoverBg: "group-hover:bg-amber-600",  shadow: "0 8px 28px rgba(245,158,11,0.22)",  barColor: "#d97706" },
  { bg: "bg-violet-50",  text: "text-violet-600", hoverBg: "group-hover:bg-violet-600", shadow: "0 8px 28px rgba(139,92,246,0.22)",  barColor: "#7c3aed" },
];

/* ── Animation ────────────────────────────────────────────── */

const smoothEase = [0.16, 1, 0.3, 1] as const; // ease-out-quart

const revealItem = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: smoothEase },
  },
};

const staggerList = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

/* ── FAQ Item ──────────────────────────────────────────────── */

function FaqItem({
  question,
  answer,
  bullets,
  isLast,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: string;
  bullets?: string[];
  isLast: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      variants={revealItem}
      className={`rounded-xl px-1 transition-colors duration-200 ${isOpen ? "bg-slate-50/80" : "hover:bg-slate-50/50"}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-5 text-left sm:py-6"
      >
        <span className="pr-4 text-base font-semibold text-slate-800 sm:text-lg">
          {question}
        </span>
        <span
          className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-all duration-300 ${isOpen ? "rotate-180 bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"}`}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: smoothEase }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-6">
              <p className="mb-3 text-base leading-relaxed text-slate-700">
                {answer}
              </p>
              {bullets && bullets.length > 0 && (
                <ul className="space-y-2.5">
                  {bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                      <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Workflow Row ──────────────────────────────────────────── */

/* ── Interactive Workflow Illustrations ────────────────────── */

function WorkflowStep1() {
  return (
    <motion.div className="overflow-hidden rounded-2xl shadow-lg ring-1 ring-slate-900/[0.04]" whileHover={{ scale: 1.01 }} transition={{ duration: 0.3 }}>
      {/* App chrome — title bar */}
      <div className="flex items-center gap-2 bg-slate-100 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 text-center">
          <div className="mx-auto max-w-[180px] rounded-md bg-white/80 px-3 py-0.5 text-[9px] text-slate-400">bahola.uz/classes/bio-2</div>
        </div>
      </div>
      {/* App header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
            <FileText className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <div className="text-[10px] font-medium text-blue-100">Biologiya · 2-chorak</div>
            <div className="text-sm font-bold text-white">Baholash mezoni yuklash</div>
          </div>
        </div>
        <span className="rounded-full bg-white/25 px-3 py-1 text-[11px] font-bold text-white">PDF</span>
      </div>
      {/* Success state */}
      <div className="bg-emerald-50 px-5 py-2.5 flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
        <span className="text-xs font-semibold text-emerald-700">Fayl muvaffaqiyatli yuklandi va AI tahlil qildi</span>
      </div>
      {/* Question table */}
      <div className="bg-white px-5 pb-5 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Baholash jadvali</span>
          <span className="text-xs font-semibold text-blue-500">Jami: 50 ball</span>
        </div>
        <div className="overflow-hidden rounded-xl bg-slate-50">
          <div className="grid grid-cols-[auto_1fr_auto] gap-0">
            {[
              ["1-savol", "Fotosintez jarayoni va bosqichlari", "10"],
              ["2-savol", "Hujayra tuzilishi — eukariot va prokariot", "15"],
              ["3-savol", "DNK replikatsiyasi mexanizmi", "20"],
              ["4-savol", "Mitozning bosqichlari qiyosiy tahlili", "5"],
            ].map(([q, topic, m], i) => (
              <motion.div key={i} className="contents" whileHover={{ backgroundColor: "rgba(59,130,246,0.04)" }}>
                <div className={`px-4 py-3 transition-colors hover:bg-blue-50/50 ${i > 0 ? "border-t border-white" : ""}`}>
                  <span className="text-[11px] font-bold text-blue-500">{q}</span>
                </div>
                <div className={`px-3 py-3 transition-colors hover:bg-blue-50/50 ${i > 0 ? "border-t border-white" : ""}`}>
                  <span className="text-[11px] text-slate-500">{topic}</span>
                </div>
                <div className={`px-4 py-3 text-right transition-colors hover:bg-blue-50/50 ${i > 0 ? "border-t border-white" : ""}`}>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">{m}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function WorkflowStep2() {
  return (
    <motion.div className="overflow-hidden rounded-2xl shadow-lg ring-1 ring-slate-900/[0.04]" whileHover={{ scale: 1.01 }} transition={{ duration: 0.3 }}>
      {/* App chrome */}
      <div className="flex items-center gap-2 bg-slate-100 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 text-center">
          <div className="mx-auto max-w-[220px] rounded-md bg-white/80 px-3 py-0.5 text-[9px] text-slate-400">bahola.uz/assessments/submit</div>
        </div>
      </div>
      {/* App header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-indigo-500 to-indigo-600 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white">AY</div>
          <div>
            <div className="text-[10px] font-medium text-indigo-100">Biologiya · 2-chorak imtihoni</div>
            <div className="text-sm font-bold text-white">Amir Yusupov</div>
          </div>
        </div>
        <span className="rounded-full bg-emerald-400 px-3 py-1 text-[11px] font-bold text-emerald-900">Yuborildi ✓</span>
      </div>
      {/* Upload info */}
      <div className="bg-indigo-50 px-5 py-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-indigo-600">4 ta rasm yuklandi</span>
        <span className="text-[10px] text-indigo-400">Telefon kamerasi orqali</span>
      </div>
      {/* Pages grid */}
      <div className="bg-white p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Yuborilgan sahifalar</div>
        <div className="grid grid-cols-4 gap-3">
          {[
            { lines: [0.9, 0.7, 0.85, 0.6, 0.75], pg: "1-bet" },
            { lines: [0.75, 0.9, 0.55, 0.8, 0.65], pg: "2-bet" },
            { lines: [0.85, 0.6, 0.9, 0.7, 0.5], pg: "3-bet" },
            { lines: [0.6, 0.8, 0.7, 0.5, 0.85], pg: "4-bet" },
          ].map((page, n) => (
            <motion.div key={n} className="flex flex-col items-center gap-1.5 cursor-pointer" whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
              <div className="w-full rounded-lg bg-slate-50 p-2.5 aspect-[3/4] flex flex-col justify-center gap-1 ring-1 ring-slate-200/60 transition-shadow hover:shadow-md hover:ring-indigo-200">
                {page.lines.map((w, li) => (
                  <div key={li} className="h-1 rounded-full bg-slate-200" style={{ width: `${w * 100}%` }} />
                ))}
              </div>
              <span className="text-[9px] font-semibold text-slate-400">{page.pg}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-3.5 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
          <span className="text-[11px] text-slate-500">Sahifalar avtomatik tartibga solindi</span>
        </div>
      </div>
    </motion.div>
  );
}

function WorkflowStep3() {
  return (
    <motion.div className="overflow-hidden rounded-2xl shadow-lg ring-1 ring-slate-900/[0.04]" whileHover={{ scale: 1.01 }} transition={{ duration: 0.3 }}>
      {/* App chrome */}
      <div className="flex items-center gap-2 bg-slate-800 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 text-center">
          <div className="mx-auto max-w-[180px] rounded-md bg-white/10 px-3 py-0.5 text-[9px] text-slate-500">AI tekshiruv jarayoni</div>
        </div>
      </div>
      {/* App header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-slate-700 to-slate-800 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/30">
            <Sparkles className="h-4.5 w-4.5 text-blue-300" />
          </div>
          <div>
            <div className="text-[10px] font-medium text-slate-400">Biologiya · Amir Yusupov</div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">AI tekshirmoqda</span>
              <span className="flex gap-1">
                {[0,1,2].map(i => (
                  <span key={i} className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" style={{ animationDelay: `${i * 0.3}s` }} />
                ))}
              </span>
            </div>
          </div>
        </div>
        <span className="rounded-full bg-blue-500/20 px-3 py-1 text-[11px] font-semibold text-blue-300">Edexcel</span>
      </div>
      {/* Per-question analysis */}
      <div className="bg-white p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Savolma-savol tahlil</div>
        <div className="space-y-2.5">
          {[
            { q: "1-savol", topic: "Fotosintez", score: "9/10", pct: 90, bg: "bg-emerald-50", label: "text-emerald-700", bar: "bg-emerald-400" },
            { q: "2-savol", topic: "Hujayra tuzilishi", score: "12/15", pct: 80, bg: "bg-blue-50", label: "text-blue-700", bar: "bg-blue-400" },
            { q: "3-savol", topic: "DNK replikatsiyasi", score: "...", pct: 40, bg: "bg-amber-50", label: "text-amber-700", bar: "bg-amber-400" },
          ].map((item, i) => (
            <motion.div key={i} className={`rounded-xl px-4 py-3 cursor-pointer ${item.bg}`} whileHover={{ x: 4, transition: { duration: 0.2 } }}>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-bold ${item.label}`}>{item.q}</span>
                  <span className="text-[10px] text-slate-400">{item.topic}</span>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${item.label} ${item.bg}`}>{item.score}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/60">
                <motion.div
                  className={`h-full rounded-full ${item.bar}`}
                  initial={{ width: "0%" }}
                  whileInView={{ width: `${item.pct}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.2, delay: i * 0.2, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          <span className="text-[11px] text-slate-500">Har bir savol baholash mezoni bilan alohida solishtirilmoqda</span>
        </div>
      </div>
    </motion.div>
  );
}

function WorkflowStep4() {
  return (
    <motion.div className="overflow-hidden rounded-2xl shadow-lg ring-1 ring-slate-900/[0.04]" whileHover={{ scale: 1.01 }} transition={{ duration: 0.3 }}>
      {/* App chrome */}
      <div className="flex items-center gap-2 bg-slate-100 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 text-center">
          <div className="mx-auto max-w-[220px] rounded-md bg-white/80 px-3 py-0.5 text-[9px] text-slate-400">bahola.uz/assessments/results</div>
        </div>
      </div>
      {/* Score header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-4">
        <div>
          <div className="text-[10px] font-medium text-emerald-100">Biologiya · Amir Yusupov</div>
          <div className="flex items-baseline gap-2">
            <span className="font-[family-name:var(--font-display)] text-4xl font-bold text-white">43</span>
            <span className="text-sm font-medium text-emerald-100">/ 50 ball</span>
          </div>
        </div>
        <div className="text-right">
          <motion.div
            className="rounded-2xl bg-white/20 px-4 py-2 text-center cursor-pointer"
            whileHover={{ scale: 1.08 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            <div className="text-2xl font-bold text-white">86%</div>
            <div className="text-[10px] font-semibold text-emerald-100">A&apos;lo daraja</div>
          </motion.div>
        </div>
      </div>
      {/* Breakdown */}
      <div className="bg-white p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Savollar bo&apos;yicha natija</div>
        <div className="space-y-3">
          {[
            { q: "1-savol", topic: "Fotosintez", s: "9/10", pct: 90, bar: "bg-emerald-400" },
            { q: "2-savol", topic: "Hujayra tuzilishi", s: "12/15", pct: 80, bar: "bg-blue-400" },
            { q: "3-savol", topic: "DNK replikatsiyasi", s: "14/20", pct: 70, bar: "bg-amber-400" },
            { q: "4-savol", topic: "Mitoz bosqichlari", s: "8/5", pct: 60, bar: "bg-rose-400" },
          ].map((item, i) => (
            <motion.div
              key={i}
              className="cursor-pointer rounded-lg px-1 py-0.5 transition-colors hover:bg-slate-50"
              whileHover={{ x: 3 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-600">{item.q}</span>
                  <span className="text-[10px] text-slate-400">{item.topic}</span>
                </div>
                <span className="text-xs font-semibold text-slate-700">{item.s}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  className={`h-full rounded-full ${item.bar}`}
                  initial={{ width: "0%" }}
                  whileInView={{ width: `${item.pct}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-emerald-700">Natijalar o&apos;quvchiga yuborildi</span>
          </div>
          <span className="text-[10px] text-emerald-500">2 daqiqa 43 soniya</span>
        </div>
      </div>
    </motion.div>
  );
}

const WorkflowIllustrations = [WorkflowStep1, WorkflowStep2, WorkflowStep3, WorkflowStep4];

function WorkflowRow({
  step,
  index,
}: {
  step: (typeof workflowSteps)[number];
  index: number;
}) {
  const isReversed = index % 2 === 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.55, ease: smoothEase }}
      className={`flex flex-col gap-8 py-10 lg:flex-row lg:items-center lg:gap-16 lg:py-16 ${
        isReversed ? "lg:flex-row-reverse" : ""
      }`}
    >
      {/* Illustration side — 55% */}
      <div className="w-full lg:w-[55%]">
        {(() => { const Comp = WorkflowIllustrations[index]; return Comp ? <Comp /> : null; })()}
      </div>

      {/* Text side — 45% */}
      <div className="w-full lg:w-[45%]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">
          {index + 1}
        </div>
        <h3 className="mt-5 font-[family-name:var(--font-display)] text-2xl font-normal text-slate-900 sm:text-3xl">
          {step.title}
        </h3>
        <p className="mt-4 text-base leading-relaxed text-slate-700 lg:text-lg">
          {step.description}
        </p>
      </div>
    </motion.div>
  );
}

/* ── Component ────────────────────────────────────────────── */

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");
  const [scrolled, setScrolled] = useState(false);
  const [faqOpenIdx, setFaqOpenIdx] = useState<number | null>(null);
  const [featIdx, setFeatIdx] = useState(0);
  const [featDir, setFeatDir] = useState(1);
  const [featPaused, setFeatPaused] = useState(false);
  const featResumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const featSliderRef = useRef<HTMLDivElement>(null);
  const pauseFeat = useCallback(() => {
    if (featResumeRef.current) clearTimeout(featResumeRef.current);
    setFeatPaused(true);
    featResumeRef.current = setTimeout(() => setFeatPaused(false), 6000);
  }, []);

  /* Slider drag → jump to feature row */
  const handleSliderInteraction = useCallback((clientY: number) => {
    const track = featSliderRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const newIdx = Math.min(coreFeatures.length - 1, Math.floor(ratio * coreFeatures.length));
    setFeatDir(newIdx > featIdx ? 1 : -1);
    setFeatIdx(newIdx);
  }, [featIdx]);

  const handleScroll = useCallback(() => {
    setScrolled(window.scrollY > 10);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (featPaused) return;
    const t = setInterval(() => {
      setFeatDir(1);
      setFeatIdx(prev => (prev + 1) % coreFeatures.length);
    }, 3500);
    return () => clearInterval(t);
  }, [featPaused]);

  return (
    <div
      className={`relative bg-white font-[family-name:var(--font-body)] text-slate-600`}
    >
      <style>{`
        @keyframes gradientShift {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
        @keyframes floatY {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-14px); }
        }
        @keyframes floatX {
          0%, 100% { transform: translateX(0px) rotate(0deg); }
          50% { transform: translateX(10px) rotate(8deg); }
        }
      `}</style>
      {/* ── Navbar ── */}
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-white/90 shadow-[0_1px_0_rgb(148_163_184/0.12)] backdrop-blur-xl"
            : "bg-white backdrop-blur-xl"
        }`}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500 text-white">
              <LogoIcon size={22} variant="mono" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-900">
              Bahola
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900"
            >
              Kirish
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-400 hover:shadow-lg hover:shadow-blue-400/40"
            >
              Bepul boshlash
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 md:hidden"
            aria-label="Mobil menyuni ochish"
          >
            {menuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden bg-white shadow-md shadow-slate-900/[0.06] md:hidden"
            >
              <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
                <div className="mt-3 flex gap-2">
                  <Link
                    href="/login"
                    className="flex-1 rounded-lg bg-slate-100 px-3 py-2.5 text-center text-sm font-semibold text-slate-700"
                    onClick={() => setMenuOpen(false)}
                  >
                    Kirish
                  </Link>
                  <Link
                    href="/register"
                    className="flex-1 rounded-lg bg-blue-500 px-3 py-2.5 text-center text-sm font-semibold text-white"
                    onClick={() => setMenuOpen(false)}
                  >
                    Bepul boshlash
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <EidBanner variant="landing" />

      <main>
        {/* ── Hero ── */}
        <section className="relative overflow-hidden">
          {/* Full-width grid pattern extending to all edges */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgb(148 163 184 / 0.28) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          {/* Soft ambient glow top-right — extended to bleed into edge */}
          <div className="pointer-events-none absolute -top-40 right-0 h-[700px] w-[700px] rounded-full bg-blue-400/[0.08] blur-[120px]" />
          {/* Warm glow bottom-left — extended to edge */}
          <div className="pointer-events-none absolute -bottom-32 left-0 h-[500px] w-[500px] rounded-full bg-teal-300/[0.06] blur-[100px]" />
          {/* Additional edge accent — far left vertical gradient */}
          <div className="pointer-events-none absolute left-0 top-0 h-full w-32 bg-gradient-to-r from-blue-50/40 to-transparent" />
          {/* Additional edge accent — far right vertical gradient */}
          <div className="pointer-events-none absolute right-0 top-0 h-full w-32 bg-gradient-to-l from-indigo-50/30 to-transparent" />
          {/* Floating decorative rings */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
            className="pointer-events-none absolute left-[8%] top-[12%] h-24 w-24 rounded-full bg-blue-300/10"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="pointer-events-none absolute right-[6%] bottom-[15%] h-16 w-16 rounded-full bg-indigo-300/10"
          />
          <motion.div
            animate={{ rotate: 360, scale: [1, 1.08, 1] }}
            transition={{ duration: 35, repeat: Infinity, ease: "linear" }}
            className="pointer-events-none absolute left-[20%] bottom-[10%] h-36 w-36 rounded-full bg-teal-200/10"
          />
          <motion.div
            style={{ animation: "floatY 6s ease-in-out infinite" }}
            className="pointer-events-none absolute right-[15%] top-[8%] h-3 w-3 rounded-full bg-blue-400/30"
          />
          <motion.div
            style={{ animation: "floatY 8s ease-in-out infinite 2s" }}
            className="pointer-events-none absolute left-[12%] top-[40%] h-2 w-2 rounded-full bg-indigo-400/25"
          />
          <motion.div
            style={{ animation: "floatX 7s ease-in-out infinite 1s" }}
            className="pointer-events-none absolute right-[25%] bottom-[20%] h-2.5 w-2.5 rounded-full bg-teal-400/30"
          />

          <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:flex-row lg:items-center lg:gap-16 lg:px-8 lg:pb-24 lg:pt-24">
            {/* LEFT — Text (55%) */}
            <motion.div
              initial="hidden"
              animate="show"
              variants={staggerList}
              className="z-10 flex w-full flex-col lg:w-[55%]"
            >
              {/* Badge */}
              <motion.div variants={revealItem}>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-600">
                  AI baholash platformasi
                </span>
              </motion.div>

              {/* Headline */}
              <motion.h1
                variants={revealItem}
                className="mt-6 font-[family-name:var(--font-display)] leading-[1.08] tracking-tight text-slate-900"
                style={{
                  fontSize: "clamp(2.25rem, 5vw, 3.75rem)",
                }}
              >
                O&apos;quvchi ishlarini{" "}
                <span
                  style={{
                    background: "linear-gradient(90deg, #3b82f6, #818cf8, #06b6d4, #3b82f6)",
                    backgroundSize: "200% auto",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    animation: "gradientShift 4s linear infinite",
                  }}
                >
                  aniq va tez
                </span>{" "}
                baholang
              </motion.h1>

              {/* Subtext */}
              <motion.p
                variants={revealItem}
                className="mt-5 max-w-lg text-lg leading-relaxed text-slate-700"
              >
                Qo&apos;lyozma ishlarni AI tekshiradi, imtihon mezonlariga mos
                izoh beradi. O&apos;qituvchi vaqtini tejang.
              </motion.p>

              {/* CTAs */}
              <motion.div
                variants={revealItem}
                className="mt-9 flex flex-col gap-3 sm:flex-row"
              >
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-400 hover:shadow-xl hover:shadow-blue-400/50 hover:scale-[1.02]"
                >
                  Bepul boshlash
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-full bg-slate-100 px-7 py-3.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200"
                >
                  Panelga kirish
                </Link>
              </motion.div>

              {/* Social proof */}
              <motion.div
                variants={revealItem}
                className="mt-10 flex items-center gap-3"
              >
                {/* Teacher avatars */}
                <div className="flex -space-x-2">
                  {[7, 11, 26, 48, 53].map((img) => (
                    <img
                      key={img}
                      src={`https://i.pravatar.cc/40?img=${img}`}
                      alt="Teacher"
                      className="h-8 w-8 rounded-full ring-2 ring-white object-cover"
                    />
                  ))}
                </div>
                <div className="h-4 w-px bg-slate-200" />
                <div className="flex items-center gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <div className="h-4 w-px bg-slate-200" />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-800">
                    O&apos;qituvchilar tanlagan #1 platforma
                  </span>
                  <span className="text-xs text-slate-600">
                    Cambridge · Edexcel · AQA standartlari asosida
                  </span>
                </div>
              </motion.div>
            </motion.div>

            {/* RIGHT — Product interface mockup */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, ease: smoothEase, delay: 0.2 }}
              className="relative z-10 w-full pb-6 lg:w-[50%]"
            >
              {/* Browser window */}
              <div className="overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-900/[0.14]">
                {/* Chrome bar */}
                <div className="flex items-center gap-3 bg-slate-50 px-4 py-3">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                    <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
                    <div className="h-3 w-3 rounded-full bg-[#28c840]" />
                  </div>
                  <div className="flex flex-1 items-center gap-1.5 rounded-md bg-white/70 px-3 py-1.5">
                    <Shield className="h-3 w-3 flex-shrink-0 text-emerald-500" />
                    <span className="truncate text-xs text-slate-400">bahola.uz / baholash / #4821</span>
                  </div>
                </div>

                {/* App content */}
                <div className="flex h-[340px]">
                  {/* Left: document view */}
                  <div className="flex-1 overflow-hidden bg-slate-50/70 p-3.5">
                    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-sm">
                      {/* Doc header */}
                      <div className="flex items-center justify-between bg-slate-50/80 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-xs font-semibold text-slate-600">Amir T. — Biologiya</span>
                        </div>
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.3 }}
                          className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-600"
                        >
                          <motion.span
                            animate={{ opacity: [1, 0.3, 1] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                            className="h-1.5 w-1.5 rounded-full bg-blue-500"
                          />
                          AI tekshirmoqda
                        </motion.span>
                      </div>

                      {/* Questions */}
                      <div className="flex-1 space-y-2.5 overflow-hidden p-3.5">
                        {[
                          { q: "1-savol", lines: [0.88, 0.72, 0.81, 0.55], score: "18/20", cardCls: "bg-emerald-50", labelCls: "text-emerald-600", lineCls: "bg-emerald-200", badgeCls: "bg-emerald-500 text-white", delay: 0.5 },
                          { q: "2-savol", lines: [0.78, 0.90, 0.62, 0.45], score: "14/15", cardCls: "bg-blue-50", labelCls: "text-blue-600", lineCls: "bg-blue-200", badgeCls: "bg-blue-500 text-white", delay: 1.1 },
                          { q: "3-savol", lines: [0.82, 0.60, 0.71], score: "11/15", cardCls: "bg-amber-50", labelCls: "text-amber-600", lineCls: "bg-amber-200", badgeCls: "bg-amber-500 text-white", delay: 1.7 },
                        ].map((item, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: item.delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            className={`rounded-lg p-3 ${item.cardCls}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <p className={`text-[9px] font-bold uppercase tracking-wider ${item.labelCls}`}>{item.q}</p>
                                {item.lines.map((w, j) => (
                                  <div key={j} className={`h-1.5 rounded-full ${item.lineCls}`} style={{ width: `${w * 100}%` }} />
                                ))}
                              </div>
                              <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: item.delay + 0.35, type: "spring", stiffness: 300, damping: 18 }}
                                className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${item.badgeCls}`}
                              >
                                {item.score}
                              </motion.span>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right: score panel */}
                  <div className="flex w-44 flex-col bg-slate-50/60 p-4">
                    <p className="mb-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">Natija</p>

                    {/* Total score */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 2.1, type: "spring", stiffness: 200, damping: 22 }}
                      className="mb-4 rounded-xl bg-emerald-500 p-4 text-center shadow-md shadow-emerald-500/30"
                    >
                      <div className="text-4xl font-bold tabular-nums text-white">43</div>
                      <div className="mt-0.5 text-xs font-medium text-emerald-100">/ 50 ball</div>
                      <div className="mt-2 inline-flex items-center rounded-full bg-white/20 px-2 py-0.5">
                        <span className="text-[10px] font-bold text-white">86% — A&apos;lo</span>
                      </div>
                    </motion.div>

                    {/* Per-question breakdown */}
                    <div className="flex-1 space-y-2.5">
                      {[
                        { label: "1-savol", score: "18/20", cls: "text-emerald-600", delay: 0.85 },
                        { label: "2-savol", score: "14/15", cls: "text-blue-600", delay: 1.45 },
                        { label: "3-savol", score: "11/15", cls: "text-amber-600", delay: 2.05 },
                      ].map((item, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: 6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: item.delay, duration: 0.3 }}
                          className="flex items-center justify-between"
                        >
                          <span className="text-xs text-slate-500">{item.label}</span>
                          <span className={`text-xs font-semibold ${item.cls}`}>{item.score}</span>
                        </motion.div>
                      ))}
                    </div>

                    {/* AI badge */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 2.5 }}
                      className="mt-auto flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-2"
                    >
                      <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                      <span className="text-[10px] font-semibold text-blue-600">AI tekshirdi</span>
                    </motion.div>
                  </div>
                </div>
              </div>

              {/* Speed badge */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 2.8 }}
                className="absolute bottom-0 left-6 flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-lg shadow-slate-900/[0.12]"
              >
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-sm font-semibold text-slate-700">2 daqiqa 43 soniyada baholandi</span>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ── Stats (natural extension of hero) ── */}
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={staggerList}
          className="mx-auto mt-8 w-full max-w-5xl px-4 pb-16 sm:px-6 lg:px-8"
        >
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4 lg:gap-0">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                variants={revealItem}
                className="text-center"
              >
                <p className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-slate-900 sm:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-1.5 text-sm font-medium text-slate-600">
                  {stat.label}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── Features ── */}
        <motion.section
          id="features"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
          variants={staggerList}
          className="relative overflow-hidden bg-slate-50/80 py-16 sm:py-20"
        >
          {/* Full-width decorative background blobs — reaching into edges */}
          <div className="pointer-events-none absolute left-0 top-1/2 h-[600px] w-[500px] -translate-y-1/2 rounded-full bg-blue-100/50 blur-[120px]" />
          <div className="pointer-events-none absolute right-0 top-1/4 h-[500px] w-[450px] rounded-full bg-indigo-100/40 blur-[100px]" />
          {/* Subtle edge lines */}
          <div className="pointer-events-none absolute left-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-blue-200/30 to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-indigo-200/30 to-transparent" />
          {/* Dot pattern that spans full width */}
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgb(148 163 184 / 0.18) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <motion.div
              variants={revealItem}
              className="mb-10 max-w-2xl"
            >
              <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-blue-500">
                IMKONIYATLAR
              </p>
              <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
                Baholash uchun zarur barcha vositalar
              </h2>
            </motion.div>

            {/* Feature list + detail panel */}
            <motion.div variants={revealItem}>
              <div
                className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10"
              >
                {/* Left: stacked feature list with slider + auto-progress indicator */}
                <div className="flex gap-3 lg:w-[38%] lg:flex-shrink-0">
                  {/* Vertical slider track */}
                  <div
                    ref={featSliderRef}
                    className="hidden lg:flex relative w-1.5 flex-shrink-0 cursor-pointer rounded-full bg-slate-200/60 self-stretch"
                    onClick={(e) => handleSliderInteraction(e.clientY)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSliderInteraction(e.clientY);
                      const onMove = (ev: MouseEvent) => handleSliderInteraction(ev.clientY);
                      const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
                      document.addEventListener("mousemove", onMove);
                      document.addEventListener("mouseup", onUp);
                    }}
                    onTouchStart={(e) => {
                      handleSliderInteraction(e.touches[0].clientY);
                      const onMove = (ev: TouchEvent) => handleSliderInteraction(ev.touches[0].clientY);
                      const onUp = () => { document.removeEventListener("touchmove", onMove); document.removeEventListener("touchend", onUp); };
                      document.addEventListener("touchmove", onMove);
                      document.addEventListener("touchend", onUp);
                    }}
                  >
                    <motion.div
                      className="absolute left-0 w-full rounded-full"
                      style={{ backgroundColor: featureAccents[featIdx].barColor }}
                      animate={{
                        top: `${(featIdx / coreFeatures.length) * 100}%`,
                        height: `${100 / coreFeatures.length}%`,
                      }}
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  </div>

                  {/* Feature buttons */}
                  <div className="flex flex-col gap-1 flex-1">
                    {coreFeatures.map((feature, i) => {
                      const Icon = feature.icon;
                      const accent = featureAccents[i];
                      const isActive = i === featIdx;
                      return (
                        <button
                          key={feature.title}
                          type="button"
                          onClick={() => { setFeatDir(i > featIdx ? 1 : -1); setFeatIdx(i); }}
                          className={`group relative cursor-pointer overflow-hidden rounded-xl px-4 py-3.5 text-left transition-all duration-300 focus:outline-none ${isActive ? "bg-white shadow-sm ring-1 ring-slate-900/[0.06]" : "hover:bg-white/60"}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all duration-300 ${isActive ? `${accent.bg} ${accent.text}` : "bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600"}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <span className={`text-sm font-semibold transition-colors duration-300 ${isActive ? "text-slate-900" : "text-slate-500 group-hover:text-slate-700"}`}>
                              {feature.title}
                            </span>
                          </div>
                          {/* Progress bar — resets each time active feature changes */}
                          {isActive && (
                            <motion.div
                              key={featIdx}
                              className="absolute bottom-0 left-0 h-[2px]"
                              style={{ backgroundColor: accent.barColor }}
                              initial={{ width: "0%" }}
                              animate={{ width: "100%" }}
                              transition={{ duration: 3.5, ease: "linear" }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right: animated detail panel */}
                <div className="min-h-[180px] flex-1">
                  <AnimatePresence mode="wait" custom={featDir}>
                    {coreFeatures.map((feature, i) => {
                      if (i !== featIdx) return null;
                      const Icon = feature.icon;
                      const accent = featureAccents[i];
                      return (
                        <motion.div
                          key={feature.title}
                          custom={featDir}
                          variants={{
                            enter: (d: number) => ({ y: d * 16, opacity: 0, scale: 0.98 }),
                            center: { y: 0, opacity: 1, scale: 1, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } },
                            exit: (d: number) => ({ y: d * -16, opacity: 0, scale: 0.98, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] as const } }),
                          }}
                          initial="enter"
                          animate="center"
                          exit="exit"
                          className="rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-900/[0.06] sm:p-10"
                          style={{ boxShadow: accent.shadow }}
                        >
                          <div className={`mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl ${accent.bg} ${accent.text}`}>
                            <Icon className="h-7 w-7" />
                          </div>
                          <h3 className="mb-4 text-2xl font-bold text-slate-900 sm:text-3xl">{feature.title}</h3>
                          <p className="text-base leading-relaxed text-slate-600 sm:text-lg">{feature.description}</p>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.section>

        {/* ── Section divider ── */}
        <div className="relative h-16 overflow-hidden bg-white">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100" />
        </div>

        {/* ── Workflow — Alternating Rows ── */}
        <section id="workflow" className="relative overflow-hidden bg-white py-12 sm:py-16">
          {/* Full-width background pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgb(148 163 184 / 0.15) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
          {/* Edge-reaching gradient blobs */}
          <div className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-teal-50/60 blur-[100px]" />
          <div className="pointer-events-none absolute right-0 top-1/3 h-[400px] w-[400px] rounded-full bg-blue-50/60 blur-[80px]" />
          {/* Soft edge gradients */}
          <div className="pointer-events-none absolute left-0 top-0 h-full w-24 bg-gradient-to-r from-slate-50/60 to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-24 bg-gradient-to-l from-slate-50/60 to-transparent" />
          <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.2 }}
              variants={staggerList}
              className="mb-4 max-w-2xl"
            >
              <motion.p
                variants={revealItem}
                className="mb-3 text-sm font-semibold uppercase tracking-widest text-blue-500"
              >
                JARAYON
              </motion.p>
              <motion.h2
                variants={revealItem}
                className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-slate-900 sm:text-4xl lg:text-5xl"
              >
                Topshirishdan natijagacha — to&apos;rtta qadam
              </motion.h2>
            </motion.div>

            <div>
              {workflowSteps.map((step, index) => (
                <WorkflowRow key={step.title} step={step} index={index} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Section divider ── */}
        <div className="relative h-16 overflow-hidden bg-white">
          <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100" />
          {/* Decorative diamond */}
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <div className="h-2 w-2 rotate-45 bg-slate-300" />
          </div>
        </div>

        {/* ── Pricing ── */}
        <motion.section
          id="pricing"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          variants={staggerList}
          className="relative overflow-hidden bg-slate-50/80 py-16 sm:py-20"
        >
          {/* Full-bleed background decorations — reaching edges */}
          <div className="pointer-events-none absolute right-0 top-0 h-[500px] w-[450px] rounded-full bg-blue-100/40 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-[450px] w-[400px] rounded-full bg-indigo-100/30 blur-[100px]" />
          {/* Subtle full-width dot pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgb(148 163 184 / 0.15) 1px, transparent 1px)",
              backgroundSize: "36px 36px",
            }}
          />
          {/* Edge accent lines */}
          <div className="pointer-events-none absolute left-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-blue-200/25 to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-indigo-200/25 to-transparent" />
          <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <motion.div variants={revealItem} className="mb-10 text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-blue-500">
                NARXLAR
              </p>
              <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
                Ehtiyojingizga mos rejani tanlang
              </h2>
            </motion.div>

            {/* Billing toggle */}
            <motion.div
              variants={revealItem}
              className="mb-12 flex justify-center"
            >
              <LayoutGroup>
                <div className="relative inline-flex items-center gap-1 rounded-full bg-slate-100 p-1.5">
                  <button
                    onClick={() => setBilling("monthly")}
                    className="relative z-10 rounded-full px-6 py-2.5 text-sm font-semibold transition-colors duration-200"
                  >
                    <span className={billing === "monthly" ? "text-slate-900" : "text-slate-500 hover:text-slate-700"}>
                      Oylik
                    </span>
                    {billing === "monthly" && (
                      <motion.div
                        layoutId="billing-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-sm"
                        style={{ zIndex: -1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                  </button>
                  <button
                    onClick={() => setBilling("annual")}
                    className="relative z-10 flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-colors duration-200"
                  >
                    <span className={billing === "annual" ? "text-slate-900" : "text-slate-500 hover:text-slate-700"}>
                      Yillik
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                      -51%
                    </span>
                    {billing === "annual" && (
                      <motion.div
                        layoutId="billing-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-sm"
                        style={{ zIndex: -1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                  </button>
                </div>
              </LayoutGroup>
            </motion.div>

            <motion.div
              variants={staggerList}
              className="grid gap-6 lg:grid-cols-3"
            >
              {plans.map((plan) => {
                const isPlus = plan.featured;
                const isDark = plan.darkFeatured;
                const bgClass = isPlus
                  ? "bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-700/25 ring-1 ring-blue-500/30"
                  : isDark
                  ? "bg-gradient-to-br from-blue-900 to-slate-950 text-white shadow-xl shadow-blue-950/50 ring-1 ring-blue-800/40"
                  : "bg-white shadow-sm shadow-slate-900/[0.04]";
                const mutedText = isPlus ? "text-blue-200" : isDark ? "text-slate-400" : "text-slate-600";
                const checkColor = isPlus ? "text-blue-200" : isDark ? "text-blue-400" : "text-emerald-500";
                const featureText = isPlus ? "text-blue-100" : isDark ? "text-slate-300" : "text-slate-700";
                const discountBadge = isPlus
                  ? "bg-emerald-400/20 text-emerald-300"
                  : isDark
                  ? "bg-blue-400/25 text-blue-200"
                  : "bg-emerald-100 text-emerald-700";
                return (
                  <motion.article
                    key={plan.name}
                    variants={revealItem}
                    className={`relative flex flex-col overflow-hidden rounded-2xl p-8 sm:p-9 ${bgClass}`}
                  >
                    {isPlus && (
                      <motion.div
                        animate={{ opacity: [0.4, 0.7, 0.4] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                        className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-blue-300/30 to-indigo-300/20"
                      />
                    )}

                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-xl font-bold tracking-tight">{plan.name}</h3>
                        <p className={`mt-1 text-sm ${mutedText}`}>{plan.summary}</p>
                      </div>
                      {isPlus && (
                        <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-400 px-3 py-1 text-[11px] font-bold tracking-wide text-amber-900">
                          <Star className="h-3 w-3 fill-amber-900" />
                          Mashhur
                        </span>
                      )}
                      {isDark && (
                        <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-400 px-3 py-1 text-[11px] font-bold tracking-wide text-emerald-900">
                          <Zap className="h-3 w-3 fill-emerald-900" />
                          Tejamkor
                        </span>
                      )}
                    </div>

                    <div className="mt-6 min-h-[4.5rem]">
                      <div className="flex items-end gap-1.5">
                        {plan.cadenceMonthly ? (
                          <AnimatePresence mode="wait">
                            <motion.p
                              key={billing + plan.name}
                              initial={{ opacity: 0, scale: 0.92, y: 6 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.92, y: -6 }}
                              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                              className="font-[family-name:var(--font-display)] text-4xl tracking-tight"
                            >
                              {billing === "monthly" ? plan.monthlyPrice : plan.annualPricePerMonth}
                            </motion.p>
                          </AnimatePresence>
                        ) : (
                          <p className="font-[family-name:var(--font-display)] text-4xl tracking-tight">
                            {plan.monthlyPrice}
                          </p>
                        )}
                        <motion.p
                          key={billing + plan.name + "cadence"}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.28 }}
                          className={`pb-1.5 text-sm font-medium ${mutedText}`}
                        >
                          {plan.cadenceMonthly ? "so'm / oy" : ""}
                        </motion.p>
                        <AnimatePresence>
                          {billing === "annual" && plan.annualDiscount && (
                            <motion.span
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                              className={`mb-1.5 ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${discountBadge}`}
                            >
                              {plan.annualDiscount}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                      <AnimatePresence mode="wait">
                        {billing === "annual" && plan.annualTotalPrice && (
                          <motion.p
                            key="annual-total"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            className={`mt-0.5 text-xs font-medium ${mutedText}`}
                          >
                            Jami {plan.annualTotalPrice} so&apos;m / yil
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>

                    <ul className="mt-6 space-y-3 flex-1">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5 text-sm">
                          <Check className={`mt-0.5 h-4 w-4 flex-shrink-0 ${checkColor}`} />
                          <span className={featureText}>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Link
                      href="/register"
                      className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                        isPlus
                          ? "bg-white text-blue-700 hover:scale-[1.03] hover:brightness-110 hover:shadow-xl hover:shadow-blue-900/20"
                          : isDark
                          ? "bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25 hover:scale-[1.02]"
                          : "bg-blue-500 text-white hover:bg-blue-400 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-400/40"
                      }`}
                    >
                      {plan.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </motion.article>
                );
              })}
            </motion.div>
          </div>
        </motion.section>

        {/* ── Section divider ── */}
        <div className="relative h-16 overflow-hidden bg-white">
          <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100" />
        </div>

        {/* ── FAQ ── */}
        <motion.section
          id="faq"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          variants={staggerList}
          className="relative overflow-hidden bg-white py-20 sm:py-24"
        >
          {/* Edge-reaching gradient blobs */}
          <div className="pointer-events-none absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-blue-50/70 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-indigo-50/50 blur-[100px]" />
          {/* Soft edge fills */}
          <div className="pointer-events-none absolute left-0 top-0 h-full w-20 bg-gradient-to-r from-slate-50/50 to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-20 bg-gradient-to-l from-slate-50/50 to-transparent" />

          <div className="relative mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <motion.div variants={revealItem} className="mb-12 text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-blue-500">
                SAVOLLAR
              </p>
              <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
                Tez-tez beriladigan savollar
              </h2>
            </motion.div>

            <motion.div
              variants={staggerList}
              className="rounded-2xl bg-white p-3 shadow-md shadow-slate-900/[0.06] ring-1 ring-slate-900/[0.04] sm:p-4"
            >
              {faqs.map((faq, i) => (
                <FaqItem
                  key={faq.question}
                  question={faq.question}
                  answer={faq.answer}
                  bullets={faq.bullets}
                  isLast={i === faqs.length - 1}
                  isOpen={faqOpenIdx === i}
                  onToggle={() => setFaqOpenIdx(faqOpenIdx === i ? null : i)}
                />
              ))}
            </motion.div>
          </div>
        </motion.section>
      </main>

      {/* ── Footer ── */}
      <footer className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-indigo-600">
        {/* Radial glow */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.06] blur-[100px]" />

        {/* CTA content */}
        <div className="relative px-6 py-20 text-center sm:py-28">
          <h2 className="font-[family-name:var(--font-display)] text-4xl tracking-tight text-white sm:text-5xl">
            Hoziroq boshlang
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg font-light text-white/80 sm:text-xl">
            O&apos;z sinfingizni yarating va AI yordamida baholashni hoziroq
            boshlang.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-10 py-4 text-lg font-semibold text-blue-700 shadow-lg shadow-blue-900/20 transition-all hover:scale-[1.04] hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-blue-900/30 hover:brightness-105"
            >
              Bepul boshlash
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-full bg-white/15 px-10 py-4 text-lg font-semibold text-white transition-colors hover:bg-white/25"
            >
              Kirish
            </Link>
          </div>
        </div>

        {/* Footer links section */}
        <div className="relative">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {/* Brand column */}
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-white">
                  <LogoIcon size={22} variant="mono" />
                </div>
                <span className="text-base font-bold tracking-tight text-white">
                  Bahola
                </span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
                O&apos;qituvchilar uchun AI baholash platformasi.
                O&apos;quvchi ishlarini xalqaro imtihon standartlari asosida
                aniq va tez baholang.
              </p>
              {/* Social links */}
              <div className="mt-5 flex items-center gap-3">
                <a
                  href="https://t.me/baholabot?start=start"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  aria-label="Telegram bot"
                >
                  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </a>
                <a
                  href="https://t.me/+6QvIYHcIoTY5MmUy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  aria-label="Telegram guruh"
                >
                  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </a>
                <a
                  href="mailto:info@bahola.com"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  aria-label="Email"
                >
                  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Platform links */}
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-white/90">
                Platforma
              </h4>
              <ul className="mt-4 space-y-3">
                <li>
                  <Link href="/login" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Kirish
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Ro&apos;yxatdan o&apos;tish
                  </Link>
                </li>
                <li>
                  <a href="#pricing" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Narxlar
                  </a>
                </li>
                <li>
                  <a href="#features" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Imkoniyatlar
                  </a>
                </li>
              </ul>
            </div>

            {/* Resources links */}
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-white/90">
                Resurslar
              </h4>
              <ul className="mt-4 space-y-3">
                <li>
                  <Link href="/support" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Qo&apos;llanma
                  </Link>
                </li>
                <li>
                  <Link href="/support" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Yordam
                  </Link>
                </li>
                <li>
                  <a
                    href="https://t.me/baholabot?start=start"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-white/55 transition-colors hover:text-white/90"
                  >
                    Bog&apos;lanish
                  </a>
                </li>
                <li>
                  <a
                    href="https://t.me/+6QvIYHcIoTY5MmUy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-white/55 transition-colors hover:text-white/90"
                  >
                    Guruhimiz
                  </a>
                </li>
                <li>
                  <a href="#faq" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Savollar
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal links */}
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-white/90">
                Huquqiy
              </h4>
              <ul className="mt-4 space-y-3">
                <li>
                  <Link href="/privacy" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Maxfiylik siyosati
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="text-sm text-white/55 transition-colors hover:text-white/90">
                    Foydalanish shartlari
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Copyright bar */}
        <div className="relative bg-black/10 px-6 py-5">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-white/40">
              &copy; {new Date().getFullYear()} Bahola. Barcha huquqlar
              himoyalangan.
            </p>
            <p className="text-sm text-white/40">
              AI baholash platformasi
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
