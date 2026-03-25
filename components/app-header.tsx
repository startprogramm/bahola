"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { clearUserCache } from "@/lib/clear-user-cache";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  LogOut,
  Plus,
  Users,
  UserPlus,
  Menu,
  HelpCircle,
  Moon,
  Sun,
} from "lucide-react";

const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";
import { LogoIcon, LogoText } from "@/components/logo";
import { CreditsDisplay } from "@/components/dashboard/credits-display";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getInitials, getUserAvatarColor, normalizeImageUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";
import { useTheme } from "@/lib/theme-provider";
import { useToast } from "@/hooks/use-toast";
import { updateCachedTheme } from "@/hooks/use-sound-effects";

export function AppHeader() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const { toast } = useToast();
  const { resolvedTheme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [classCode, setClassCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-pinned");
    setSidebarPinned(saved === "true");
  }, []);

  useEffect(() => { setThemeMounted(true); }, []);

  // Close menus when clicking outside
  const handleClickOutside = useCallback((event: MouseEvent) => {
    const target = event.target as Node;

    // Check plus menu
    if (plusMenuOpen) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(target) &&
        plusButtonRef.current && !plusButtonRef.current.contains(target)) {
        setPlusMenuOpen(false);
      }
    }

    // Check profile menu
    if (profileMenuOpen) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(target) &&
        profileButtonRef.current && !profileButtonRef.current.contains(target)) {
        setProfileMenuOpen(false);
      }
    }
  }, [plusMenuOpen, profileMenuOpen]);

  // Only attach listeners when a menu is open
  useEffect(() => {
    if (!plusMenuOpen && !profileMenuOpen) return;

    document.addEventListener("click", handleClickOutside, true);

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlusMenuOpen(false);
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("click", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [plusMenuOpen, profileMenuOpen, handleClickOutside]);

  const toggleSidebarPin = () => {
    // On mobile, toggle the mobile sidebar overlay
    if (window.innerWidth < 768) {
      window.dispatchEvent(new CustomEvent("sidebar-mobile-toggle"));
      return;
    }
    // On desktop, pin/unpin sidebar
    const newState = !sidebarPinned;
    setSidebarPinned(newState);
    localStorage.setItem("sidebar-pinned", String(newState));
    document.cookie = `sidebar-pinned=${newState}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    window.dispatchEvent(new CustomEvent("sidebar-pin-change", { detail: newState }));
  };

  // Hide header in split-screen submission view
  const isSubmissionDetailPage = /\/assessments\/[^/]+\/(submissions\/[^/]+|feedback)/.test(pathname);
  if (!session || isSubmissionDetailPage) return null;

  const handleJoinClass = async () => {
    setJoinError("");
    if (!classCode.trim()) {
      setJoinError(t("enterAClassCode") || "Enter a class code");
      return;
    }

    setJoining(true);
    try {
      const response = await fetch("/api/classes/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: classCode.toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to join class");
      }

      toast({
        title: t("joinedSuccessfully"),
        description: `${t("youHaveJoined")} ${data.class.name}`,
      });

      setJoinDialogOpen(false);
      setClassCode("");
      setJoinError("");
      router.push(`/classes/${data.class.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Something went wrong";
      setJoinError(msg);
      toast({
        title: t("failedToJoin"),
        description: msg,
        variant: "destructive",
      });
    } finally {
      setJoining(false);
    }
  };

  const handlePlusClick = () => {
    setPlusMenuOpen(prev => !prev);
    setProfileMenuOpen(false);
  };

  const handleProfileClick = () => {
    setProfileMenuOpen(prev => !prev);
    setPlusMenuOpen(false);
  };

  const firstName = session.user?.name?.split(" ")[0] || "User";
  const userAvatarColor = getUserAvatarColor(session.user?.name || "User");

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-muted text-foreground flex items-center justify-between px-2 md:px-4">
        {/* Left side - Menu button and Logo */}
        <div className="flex items-center">
          {/* Hamburger menu to pin/unpin sidebar */}
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full"
            onClick={toggleSidebarPin}
          >
            <Menu className="h-7 w-7" />
          </Button>

          {/* Logo - icon close to text */}
          <Link href="/classes" className="no-underline flex items-center ml-4">
            <div className="flex items-center justify-center w-8 h-8 shrink-0 text-primary translate-y-[-1px]">
              <LogoIcon size={28} />
            </div>
            <LogoText className="text-xl ml-2" />
          </Link>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          {/* Credits display */}
          <CreditsDisplay />

          {/* Create/Join Class Button - Hidden on maktab */}
          {!isMaktab && (
          <div className="relative">
            <button
              ref={plusButtonRef}
              type="button"
              data-guide="plus-button"
              className="h-10 w-10 rounded-full flex items-center justify-center text-foreground hover:bg-accent active:scale-95 transition-all duration-150"
              onClick={handlePlusClick}
            >
              <Plus className={`h-5 w-5 transition-transform duration-200 ${plusMenuOpen ? "rotate-45" : ""}`} />
            </button>

            {plusMenuOpen && (
              <div
                ref={plusMenuRef}
                className="absolute right-0 top-12 z-[60] w-48 overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2 whitespace-nowrap px-4 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    router.push("/classes/new");
                  }}
                >
                  <Users className="h-4 w-4" />
                  {t("createClass")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 whitespace-nowrap px-4 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    setJoinDialogOpen(true);
                  }}
                >
                  <UserPlus className="h-4 w-4" />
                  {t("joinClass")}
                </button>
              </div>
            )}
          </div>
          )}

          {/* User Profile - Custom dropdown */}
          <div className="relative">
            <button
              ref={profileButtonRef}
              type="button"
              className="relative h-10 w-10 rounded-full focus:outline-none"
              onClick={handleProfileClick}
            >
              <Avatar className="h-10 w-10">
                <AvatarImage
                  src={normalizeImageUrl(session.user?.avatar) || undefined}
                  alt={session.user?.name || ""}
                />
                <AvatarFallback
                  className="text-white font-medium"
                  style={{ backgroundColor: userAvatarColor }}
                >
                  {getInitials(session.user?.name || "U")}
                </AvatarFallback>
              </Avatar>
            </button>

            {profileMenuOpen && (
              <div
                ref={profileMenuRef}
                className="absolute right-0 top-12 z-[60] w-[320px] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl"
              >
                {/* Header with email */}
                <div className="border-b border-border px-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    {session.user?.email}
                  </span>
                </div>

                {/* Profile section */}
                <div className="flex flex-col items-center py-6 px-4">
                  <div className="relative mb-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage
                        src={normalizeImageUrl(session.user?.avatar) || undefined}
                        alt={session.user?.name || ""}
                      />
                      <AvatarFallback
                        className="text-white font-medium text-2xl"
                        style={{ backgroundColor: userAvatarColor }}
                      >
                        {getInitials(session.user?.name || "U")}
                      </AvatarFallback>
                    </Avatar>
                  </div>

                  <h2 className="text-xl font-normal mb-4">
                    {t("welcomeBack")}, {firstName}!
                  </h2>

                  <Button
                    variant="outline"
                    className="rounded-full px-6 mb-2"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      router.push("/settings");
                    }}
                  >
                    {t("manageAccount") || "Manage your account"}
                  </Button>
                </div>

                {/* Theme & Support & Logout */}
                <div className="border-t border-border">
                  {themeMounted && (
                    <button
                      type="button"
                      className="w-full py-3 text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground flex items-center justify-center gap-2"
                      onClick={() => {
                        const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
                        setTheme(nextTheme);
                        updateCachedTheme(nextTheme as Parameters<typeof updateCachedTheme>[0]);
                        window.dispatchEvent(new CustomEvent("theme-change", { detail: nextTheme }));
                      }}
                    >
                      {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                      {resolvedTheme === "dark" ? (t("lightMode") || "Light Mode") : (t("darkMode") || "Dark Mode")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full py-3 text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground flex items-center justify-center gap-2"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      window.open("https://t.me/teztekshirbot", "_blank");
                    }}
                  >
                    <HelpCircle className="h-4 w-4" />
                    {t("support")}
                  </button>
                  <button
                    type="button"
                    className="w-full py-3 text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground flex items-center justify-center gap-2"
                    onClick={async () => {
                      setProfileMenuOpen(false);
                      clearUserCache();
                      await signOut({ redirect: false });
                      window.location.href = "/login";
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    {t("logout")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Join Class Dialog */}
      <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("joinClass")}</DialogTitle>
            <DialogDescription>
              {t("enterClassCode")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="classCodeHeader">{t("classCode")}</Label>
              <Input
                id="classCodeHeader"
                placeholder="ABC123"
                value={classCode}
                onChange={(e) => { setClassCode(e.target.value.toUpperCase()); setJoinError(""); }}
                maxLength={6}
                className="text-center text-xl tracking-widest font-mono"
                onKeyDown={(e) => { if (e.key === "Enter") handleJoinClass(); }}
              />
              {joinError && (
                <p className="text-sm text-destructive font-medium">{joinError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setJoinDialogOpen(false); setJoinError(""); }}>
              {t("cancel")}
            </Button>
            <Button onClick={handleJoinClass} disabled={joining}>
              {joining ? t("loading") : t("joinClass")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
