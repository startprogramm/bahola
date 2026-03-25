import { NextRequest, NextResponse } from "next/server";
import { getAllPosts } from "@/lib/blog";

export async function GET(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get("lang") || "en";
  const posts = getAllPosts(lang);
  return NextResponse.json(posts);
}
