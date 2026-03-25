"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function JoinClassPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");

  useEffect(() => {
    const join = async () => {
      if (!code) {
        router.replace("/classes");
        return;
      }

      try {
        const res = await fetch("/api/classes/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();

        if (res.ok && data.class?.id) {
          router.replace(`/classes/${data.class.id}`);
        } else {
          // Already enrolled or error - just go to classes
          router.replace("/classes");
        }
      } catch {
        router.replace("/classes");
      }
    };

    void join();
  }, [code, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-gray-500 text-sm">Joining class...</p>
      </div>
    </div>
  );
}
