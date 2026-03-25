import Link from "next/link";
import Image from "next/image";
import { getAllPosts } from "@/lib/blog";
import { cookies } from "next/headers";
import { LogoIcon } from "@/components/logo";
import { ArrowRight, Calendar, User } from "lucide-react";

const THEME_GRADIENTS: Record<string, string> = {
  blue: "from-blue-500 to-indigo-600",
  green: "from-emerald-500 to-teal-600",
  purple: "from-violet-500 to-purple-600",
  orange: "from-orange-400 to-amber-500",
  indigo: "from-indigo-500 to-blue-700",
  teal: "from-teal-500 to-cyan-600",
  rose: "from-rose-500 to-pink-600",
  gold: "from-amber-400 to-yellow-500",
};

export default async function BlogListPage() {
  const cookieStore = await cookies();
  const lang = cookieStore.get("language")?.value || "en";
  const posts = getAllPosts(lang);

  const labels = {
    en: { title: "Blog", subtitle: "Tips, guides, and updates on AI-powered grading and education technology.", readMore: "Read more", login: "Log in", getStarted: "Get started free" },
    uz: { title: "Blog", subtitle: "Sun'iy intellekt yordamida baholash va ta'lim texnologiyalari haqida maslahatlar, qo'llanmalar va yangiliklar.", readMore: "Batafsil", login: "Kirish", getStarted: "Bepul boshlash" },
    ru: { title: "Блог", subtitle: "Советы, руководства и новости об ИИ-оценивании и образовательных технологиях.", readMore: "Читать далее", login: "Войти", getStarted: "Начать бесплатно" },
  };
  const t = labels[lang as keyof typeof labels] || labels.en;

  return (
    <div className="min-h-screen bg-blue-50/40 font-[family-name:var(--font-body)] text-slate-600">
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white/90 shadow-[0_1px_0_rgb(148_163_184/0.12)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500 text-white">
              <LogoIcon size={22} variant="mono" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-900 font-[family-name:var(--font-heading)]">Bahola</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900">
              {t.login}
            </Link>
            <Link href="/register" className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/25">
              {t.getStarted}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — branded gradient */}
      <section className="bg-gradient-to-b from-blue-50 to-white">
        <div className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-1 rounded-full bg-blue-500" />
            <span className="text-sm font-semibold text-blue-600 uppercase tracking-wider">Bahola</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl font-[family-name:var(--font-heading)]">{t.title}</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-500">{t.subtitle}</p>
        </div>
      </section>

      {/* Post list */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
        {posts.length === 0 ? (
          <p className="text-slate-400">No posts yet. Check back soon.</p>
        ) : (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => {
              const gradient = THEME_GRADIENTS[post.theme || "blue"] ?? THEME_GRADIENTS.blue;
              return (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group flex flex-col rounded-2xl bg-white overflow-hidden shadow-sm shadow-slate-200/80 transition-all hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-0.5"
                >
                  {/* Cover image or gradient placeholder */}
                  <div className="relative h-44 w-full overflow-hidden">
                    {post.coverImage ? (
                      <Image
                        src={post.coverImage}
                        alt={post.title}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    ) : (
                      <div className={`h-full w-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 text-white backdrop-blur-sm">
                          <LogoIcon size={30} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col flex-1 p-6">
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(post.date).toLocaleDateString(lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-US", { year: "numeric", month: "long", day: "numeric" })}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {post.author}
                      </span>
                    </div>
                    <h2 className="mt-3 text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug font-[family-name:var(--font-heading)]">
                      {post.title}
                    </h2>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{post.excerpt}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-500 group-hover:gap-2 transition-all">
                      {t.readMore} <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8">
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
