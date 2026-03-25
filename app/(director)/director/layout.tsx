import { Suspense } from "react";
import { ThemeBackground } from "@/components/theme-background";
import { LanguageSync } from "@/components/language-sync";
import { DirectorSidebar } from "@/components/director/DirectorSidebar";
import { Loader2 } from "lucide-react";

export default function DirectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-director-layout className="flex h-screen bg-background overflow-hidden relative">
      <ThemeBackground />
      <LanguageSync />
      <DirectorSidebar />
      <div data-director-main className="flex-1 flex flex-col overflow-auto min-h-0">
        <Suspense fallback={
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }>
          {children}
        </Suspense>
      </div>
    </div>
  );
}
