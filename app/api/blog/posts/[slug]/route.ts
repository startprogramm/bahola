import { NextRequest, NextResponse } from "next/server";
import { getPostBySlug } from "@/lib/blog";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const lang = request.nextUrl.searchParams.get("lang") || "en";
  const post = getPostBySlug(slug, lang);

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  return NextResponse.json(post);
}
