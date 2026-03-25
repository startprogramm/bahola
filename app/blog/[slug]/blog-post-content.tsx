"use client";

import ReactMarkdown from "react-markdown";
import Image from "next/image";

const PROSE_THEME: Record<string, string> = {
  blue:   "prose-a:text-blue-600 prose-li:marker:text-blue-400 prose-blockquote:border-blue-400",
  green:  "prose-a:text-emerald-600 prose-li:marker:text-emerald-400 prose-blockquote:border-emerald-400",
  purple: "prose-a:text-violet-600 prose-li:marker:text-violet-400 prose-blockquote:border-violet-400",
  orange: "prose-a:text-orange-600 prose-li:marker:text-orange-400 prose-blockquote:border-orange-400",
  indigo: "prose-a:text-indigo-600 prose-li:marker:text-indigo-400 prose-blockquote:border-indigo-400",
  teal:   "prose-a:text-teal-600 prose-li:marker:text-teal-400 prose-blockquote:border-teal-400",
  rose:   "prose-a:text-rose-600 prose-li:marker:text-rose-400 prose-blockquote:border-rose-400",
  gold:   "prose-a:text-amber-600 prose-li:marker:text-amber-400 prose-blockquote:border-amber-400",
};

interface BlogPostContentProps {
  content: string;
  theme?: string;
}

export function BlogPostContent({ content, theme }: BlogPostContentProps) {
  const themeClass = PROSE_THEME[theme || "blue"] ?? PROSE_THEME.blue;
  return (
    <div className={`prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-headings:font-[family-name:var(--font-heading)] prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-8 prose-p:leading-[1.75] prose-p:text-base sm:prose-p:text-lg prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900 prose-hr:border-slate-200 prose-img:rounded-xl prose-img:shadow-lg prose-blockquote:bg-slate-50 prose-blockquote:rounded-r-xl prose-blockquote:py-1 ${themeClass}`}>
      <ReactMarkdown
        components={{
          img: ({ src, alt }) => {
            if (!src) return null;
            return (
              <span className="block my-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={alt || ""}
                  className="rounded-xl shadow-lg w-full"
                  loading="lazy"
                />
                {alt && (
                  <span className="block text-center text-xs text-slate-400 mt-2 italic">{alt}</span>
                )}
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
