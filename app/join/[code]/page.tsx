"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Loader2, School } from "lucide-react";
import { LogoIcon, LogoText } from "@/components/logo";

export default function JoinPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;
  const { data: session, status } = useSession();

  const [classInfo, setClassInfo] = useState<{ name: string; teacher: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Once session is known and user is logged in, auto-join
  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") return; // show login/register buttons

    // Authenticated — join the class
    const join = async () => {
      setJoining(true);
      try {
        const res = await fetch("/api/classes/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();

        if (res.ok && data.class?.id) {
          router.replace(`/classes/${data.class.id}`);
        } else if (res.status === 400 && data.error?.includes("already enrolled")) {
          // Already a member — find the class and redirect
          const searchRes = await fetch(`/api/classes/by-code?code=${code}`);
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            router.replace(`/classes/${searchData.id}`);
          } else {
            router.replace("/classes");
          }
        } else {
          setError(data.error || "Invalid class code");
          setJoining(false);
        }
      } catch {
        setError("Something went wrong. Please try again.");
        setJoining(false);
      }
    };

    void join();
  }, [status, code, router]);

  // Loading session
  if (status === "loading" || (status === "authenticated" && !error)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 mb-6">
            <LogoIcon className="h-8 w-8" />
            <LogoText className="h-5" />
          </div>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">
            {joining ? "Joining class..." : "Loading..."}
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 max-w-sm w-full text-center">
          <div className="flex items-center gap-2 mb-6">
            <LogoIcon className="h-8 w-8" />
            <LogoText className="h-5" />
          </div>
          <div className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
          <Link
            href="/classes"
            className="text-primary underline text-sm"
          >
            Go to your classes
          </Link>
        </div>
      </div>
    );
  }

  // Unauthenticated — show login/register options
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-6 max-w-sm w-full text-center">
        <div className="flex items-center gap-2 mb-2">
          <LogoIcon className="h-8 w-8" />
          <LogoText className="h-5" />
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="bg-primary/10 rounded-full p-3">
            <School className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold">You&apos;ve been invited to join a class</h1>
          <p className="text-muted-foreground text-sm">
            Sign in or create an account to join with code{" "}
            <span className="font-mono font-bold text-foreground">{code}</span>
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full">
          <Link
            href={`/login?code=${code}`}
            className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium text-center hover:bg-primary/90 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href={`/register?code=${code}`}
            className="w-full border border-border rounded-lg py-2.5 text-sm font-medium text-center hover:bg-muted transition-colors"
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}
