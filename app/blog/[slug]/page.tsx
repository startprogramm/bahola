import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getPostBySlug, getAllSlugs } from "@/lib/blog";
import { LogoIcon } from "@/components/logo";
import { ArrowLeft, Calendar, User } from "lucide-react";
import { BlogPostContent } from "./blog-post-content";

interface Props {
  params: Promise<{ slug: string }>;
}

const THEME_CONFIG: Record<string, { gradient: string; accent: string; badge: string; prose: string; pageBg: string; articleBorder: string }> = {
  blue:   { gradient: "from-blue-500 to-indigo-600",   accent: "text-blue-600",   badge: "bg-blue-50 text-blue-700 border-blue-200",   prose: "prose-a:text-blue-600 prose-li:marker:text-blue-400",   pageBg: "bg-blue-50/40",   articleBorder: "border-blue-100" },
  green:  { gradient: "from-emerald-500 to-teal-600",  accent: "text-emerald-600", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", prose: "prose-a:text-emerald-600 prose-li:marker:text-emerald-400", pageBg: "bg-emerald-50/40", articleBorder: "border-emerald-100" },
  purple: { gradient: "from-violet-500 to-purple-600", accent: "text-violet-600", badge: "bg-violet-50 text-violet-700 border-violet-200",  prose: "prose-a:text-violet-600 prose-li:marker:text-violet-400",  pageBg: "bg-violet-50/40",  articleBorder: "border-violet-100" },
  orange: { gradient: "from-orange-400 to-amber-500",  accent: "text-orange-600", badge: "bg-orange-50 text-orange-700 border-orange-200",  prose: "prose-a:text-orange-600 prose-li:marker:text-orange-400",  pageBg: "bg-orange-50/40",  articleBorder: "border-orange-100" },
  indigo: { gradient: "from-indigo-500 to-blue-700",   accent: "text-indigo-600", badge: "bg-indigo-50 text-indigo-700 border-indigo-200",  prose: "prose-a:text-indigo-600 prose-li:marker:text-indigo-400",  pageBg: "bg-indigo-50/40",  articleBorder: "border-indigo-100" },
  teal:   { gradient: "from-teal-500 to-cyan-600",     accent: "text-teal-600",   badge: "bg-teal-50 text-teal-700 border-teal-200",       prose: "prose-a:text-teal-600 prose-li:marker:text-teal-400",     pageBg: "bg-teal-50/40",   articleBorder: "border-teal-100" },
  rose:   { gradient: "from-rose-500 to-pink-600",     accent: "text-rose-600",   badge: "bg-rose-50 text-rose-700 border-rose-200",       prose: "prose-a:text-rose-600 prose-li:marker:text-rose-400",     pageBg: "bg-rose-50/40",   articleBorder: "border-rose-100" },
  gold:   { gradient: "from-amber-400 to-yellow-500",  accent: "text-amber-600",  badge: "bg-amber-50 text-amber-700 border-amber-200",    prose: "prose-a:text-amber-600 prose-li:marker:text-amber-400",   pageBg: "bg-amber-50/50",  articleBorder: "border-amber-100" },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const cookieStore = await cookies();
  const lang = cookieStore.get("language")?.value || "en";
  const post = getPostBySlug(slug, lang);

  if (!post) {
    return { title: "Post not found — Bahola" };
  }

  return {
    title: `${post.title} — Bahola Blog`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
      ...(post.coverImage ? { images: [post.coverImage] } : {}),
    },
  };
}

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const lang = cookieStore.get("language")?.value || "en";
  const post = getPostBySlug(slug, lang);

  if (!post) notFound();

  const backLabel = lang === "uz" ? "Blogga qaytish" : lang === "ru" ? "Назад к блогу" : "Back to blog";
  const loginLabel = lang === "uz" ? "Kirish" : lang === "ru" ? "Войти" : "Log in";
  const ctaLabel = lang === "uz" ? "Bepul boshlash" : lang === "ru" ? "Начать бесплатно" : "Get started free";

  const theme = THEME_CONFIG[post.theme || "blue"] ?? THEME_CONFIG.blue;

  return (
    <div className={`min-h-screen ${theme.pageBg} font-[family-name:var(--font-body)] text-slate-600`}>
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white shadow-[0_1px_0_rgb(148_163_184/0.12)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500 text-white">
              <LogoIcon size={22} variant="mono" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-900 font-[family-name:var(--font-heading)]">Bahola</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900">
              {loginLabel}
            </Link>
            <Link href="/register" className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-400 hover:shadow-lg hover:shadow-blue-400/40">
              {ctaLabel}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero banner */}
      <div className="relative w-full overflow-hidden" style={{ minHeight: "280px" }}>
        {post.coverImage ? (
          <>
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              className="object-cover"
              priority
              sizes="100vw"
            />
            {/* Dark overlay for text readability */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/45 to-black/75" />
          </>
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${theme.gradient}`} />
        )}

        {/* Hero content */}
        <div className="relative mx-auto max-w-3xl px-4 pt-10 pb-12 sm:px-6 lg:px-8">
          <Link
            href="/blog"
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>

          <div className="mb-4 flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${theme.badge}`}>
              Bahola Blog
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl leading-tight drop-shadow-sm font-[family-name:var(--font-heading)]">
            {post.title}
          </h1>

          <div className="mt-4 flex items-center gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {new Date(post.date).toLocaleDateString(
                lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-US",
                { year: "numeric", month: "long", day: "numeric" }
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {post.author}
            </span>
          </div>
        </div>
      </div>

      {/* Article */}
      <div className="mx-auto max-w-3xl px-4 pt-10 pb-24 sm:px-6 lg:px-8">
        <article className="rounded-2xl bg-white shadow-sm shadow-slate-200/80 px-6 py-10 sm:px-10">
          <BlogPostContent content={post.content} theme={post.theme} />
        </article>
      </div>

      {/* CTA strip */}
      <div className={`bg-gradient-to-r ${theme.gradient} py-12`}>
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-3 font-[family-name:var(--font-heading)]">
            {lang === "uz" ? "Bugun boshlang — bepul" : lang === "ru" ? "Начните сегодня — бесплатно" : "Try it free — no credit card needed"}
          </h2>
          <p className="text-white/80 mb-6 text-sm">
            {lang === "uz" ? "O'qituvchilar uchun tekin. Sinfingizni 5 daqiqada yarating." : lang === "ru" ? "Бесплатно для учителей. Создайте класс за 5 минут." : "Free for teachers. Set up your class in 5 minutes."}
          </p>
          <Link
            href="/register"
            className="inline-flex rounded-full bg-white px-8 py-3 text-sm font-bold text-slate-900 shadow-lg transition-all hover:shadow-xl hover:scale-105"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white/70 py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500 text-white">
              <LogoIcon size={16} variant="mono" />
            </div>
            <span className="text-sm font-bold text-slate-700 font-[family-name:var(--font-heading)]">Bahola</span>
          </Link>
          <p className="text-xs text-slate-400">&copy; {new Date().getFullYear()} Bahola</p>
        </div>
      </footer>
    </div>
  );
}
