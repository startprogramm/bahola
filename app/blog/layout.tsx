import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog — Bahola",
  description:
    "Tips, guides, and updates from the Bahola team on AI-powered grading, education technology, and classroom productivity.",
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
