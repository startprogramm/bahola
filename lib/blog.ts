import fs from "fs";
import path from "path";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

export interface BlogPostMeta {
  title: string;
  date: string;
  author: string;
  language: string;
  slug: string;
  excerpt: string;
  coverImage?: string;
  theme?: string;
}

export interface BlogPost extends BlogPostMeta {
  content: string;
}

/** Parse simple YAML frontmatter from markdown string */
function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  }
  return { meta, content: match[2].trim() };
}

/** Get all blog post filenames */
function getBlogFiles(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
}

/** Read and parse a single blog post file */
function readPostFile(filename: string): BlogPost | null {
  const filepath = path.join(BLOG_DIR, filename);
  if (!fs.existsSync(filepath)) return null;

  const raw = fs.readFileSync(filepath, "utf-8");
  const { meta, content } = parseFrontmatter(raw);

  return {
    title: meta.title || "",
    date: meta.date || "",
    author: meta.author || "",
    language: meta.language || "en",
    slug: meta.slug || filename.replace(/\.\w+\.md$/, ""),
    excerpt: meta.excerpt || "",
    coverImage: meta.coverImage || undefined,
    theme: meta.theme || undefined,
    content,
  };
}

/**
 * Get all blog posts for a given language, sorted by date descending.
 * Falls back to English if no post exists in the requested language.
 */
export function getAllPosts(language: string = "en"): BlogPostMeta[] {
  const files = getBlogFiles();
  const postsBySlug = new Map<string, BlogPostMeta>();

  // First pass: collect posts matching the requested language
  for (const file of files) {
    const post = readPostFile(file);
    if (!post) continue;
    if (post.language === language) {
      postsBySlug.set(post.slug, {
        title: post.title,
        date: post.date,
        author: post.author,
        language: post.language,
        slug: post.slug,
        excerpt: post.excerpt,
        coverImage: post.coverImage,
        theme: post.theme,
      });
    }
  }

  // Second pass: fill in English fallbacks for missing slugs
  if (language !== "en") {
    for (const file of files) {
      const post = readPostFile(file);
      if (!post || post.language !== "en") continue;
      if (!postsBySlug.has(post.slug)) {
        postsBySlug.set(post.slug, {
          title: post.title,
          date: post.date,
          author: post.author,
          language: post.language,
          slug: post.slug,
          excerpt: post.excerpt,
          coverImage: post.coverImage,
          theme: post.theme,
        });
      }
    }
  }

  return Array.from(postsBySlug.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Get a single blog post by slug, preferring the given language.
 * Falls back to English if not available in the requested language.
 */
export function getPostBySlug(slug: string, language: string = "en"): BlogPost | null {
  // Try requested language first
  const langFile = `${slug}.${language}.md`;
  const post = readPostFile(langFile);
  if (post) return post;

  // Fallback to English
  if (language !== "en") {
    const enFile = `${slug}.en.md`;
    return readPostFile(enFile);
  }

  return null;
}

/** Get all unique slugs (for static generation) */
export function getAllSlugs(): string[] {
  const files = getBlogFiles();
  const slugs = new Set<string>();
  for (const file of files) {
    const slug = file.replace(/\.\w+\.md$/, "");
    slugs.add(slug);
  }
  return Array.from(slugs);
}
