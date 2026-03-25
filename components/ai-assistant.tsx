"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, Send, Loader2, X, User as UserIcon, Plus, MessageSquare, ChevronLeft, Trash2, ArrowDown, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/lib/i18n/language-context";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence, useMotionValue, animate, useDragControls } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useSubscriptionData } from "@/hooks/use-subscription";
import { useSession } from "next-auth/react";

// ── Chat storage helpers ──

// User-scoped prefix — set on component mount to isolate chat data per user
let _userKeyPrefix = "";

interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
}

type Message = { role: "user" | "ai"; content: string };

const CHATS_INDEX_KEY = "ai-chats-index";
const CHAT_PREFIX = "ai-chat-";
const ACTIVE_CHAT_KEY = "ai-active-chat";

function getChatIndex(): ChatMeta[] {
  try {
    return JSON.parse(localStorage.getItem(_userKeyPrefix + CHATS_INDEX_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveChatIndex(index: ChatMeta[]) {
  localStorage.setItem(_userKeyPrefix + CHATS_INDEX_KEY, JSON.stringify(index));
}

function getChatMessages(chatId: string): Message[] {
  try {
    return JSON.parse(localStorage.getItem(_userKeyPrefix + CHAT_PREFIX + chatId) || "[]");
  } catch {
    return [];
  }
}

function saveChatMessages(chatId: string, messages: Message[]) {
  localStorage.setItem(_userKeyPrefix + CHAT_PREFIX + chatId, JSON.stringify(messages));
}

function deleteChatStorage(chatId: string) {
  localStorage.removeItem(_userKeyPrefix + CHAT_PREFIX + chatId);
}

function generateChatId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getChatLimit(subscription: string | undefined): number {
  switch (subscription) {
    case "PRO":
    case "MAX":
      return 50;
    case "PLUS":
      return 20;
    default:
      return 5;
  }
}

// Migrate old single-chat format to multi-chat
function migrateOldMessages(): string | null {
  const old = localStorage.getItem("ai-assistant-messages");
  if (!old) return null;

  try {
    const messages: Message[] = JSON.parse(old);
    if (!Array.isArray(messages) || messages.length === 0) {
      localStorage.removeItem("ai-assistant-messages");
      return null;
    }

    const id = generateChatId();
    const firstUserMsg = messages.find((m) => m.role === "user");
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 40) : "Chat";

    const meta: ChatMeta = {
      id,
      title,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };

    saveChatMessages(id, messages);
    saveChatIndex([meta]);
    localStorage.setItem(_userKeyPrefix + ACTIVE_CHAT_KEY, id);
    localStorage.removeItem("ai-assistant-messages");
    return id;
  } catch {
    localStorage.removeItem("ai-assistant-messages");
    return null;
  }
}

// ── Component ──

export function AIAssistant({ autoOpen = false }: { autoOpen?: boolean }) {
  const pathname = usePathname();
  const { t, language } = useLanguage();
  const { data: session } = useSession();
  const { data: subData } = useSubscriptionData();
  const [open, setOpen] = useState(autoOpen);
  const [showChatList, setShowChatList] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatIndex, setChatIndex] = useState<ChatMeta[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Resizable chat window ──
  const [chatSize, setChatSize] = useState({ w: 400, h: 460 });
  const [isMaximized, setIsMaximized] = useState(false);
  const preSizeRef = useRef({ w: 400, h: 460 });
  const CHAT_MIN_W = 320;
  const CHAT_MIN_H = 300;
  const CHAT_MAX_W = isMaximized ? 1200 : 700;
  const CHAT_MAX_H = isMaximized ? 1000 : 800;
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ mx: 0, my: 0, w: 400, h: 460 });
  const dragControls = useDragControls();

  const chatLimit = useMemo(() => getChatLimit(subData?.subscription), [subData?.subscription]);

  // Persistent motion values for smooth, non-wiggling drag
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Reactive state for window-relative orientation
  const [isLeftHalf, setIsLeftHalf] = useState(false);
  const [isTopHalf, setIsTopHalf] = useState(false);

  const [dragged, setDragged] = useState(false);

  // ── Init: mount, load chats, position ──
  useEffect(() => {
    setMounted(true);

    // Scope chat storage per user to prevent cross-user data leaks
    const userId = session?.user?.id;
    if (userId) _userKeyPrefix = `u:${userId}:`;

    // Migrate old format if needed
    const migratedId = migrateOldMessages();

    // Load chat index
    const index = getChatIndex();
    setChatIndex(index);

    // Load active chat
    const savedActive = migratedId || localStorage.getItem(_userKeyPrefix + ACTIVE_CHAT_KEY);
    if (savedActive && index.some((c) => c.id === savedActive)) {
      setActiveChatId(savedActive);
      setMessages(getChatMessages(savedActive));
    } else if (index.length > 0) {
      const latest = index[0];
      setActiveChatId(latest.id);
      setMessages(getChatMessages(latest.id));
      localStorage.setItem(_userKeyPrefix + ACTIVE_CHAT_KEY, latest.id);
    }

    // Load saved position as percentage of viewport
    const savedPos = localStorage.getItem("ai-assistant-pos");
    let pctX = 0.95;
    let pctY = 0.92;

    if (savedPos) {
      try {
        const parsed = JSON.parse(savedPos);
        if (typeof parsed.pctX === "number") {
          pctX = Math.max(0.05, Math.min(0.95, parsed.pctX));
          pctY = Math.max(0.05, Math.min(0.95, parsed.pctY));
        } else if (typeof parsed.px === "number") {
          pctX = Math.max(0.05, Math.min(0.95, parsed.px / window.innerWidth));
          pctY = Math.max(0.05, Math.min(0.95, parsed.py / window.innerHeight));
        }
      } catch {}
    }

    const initialX = pctX * window.innerWidth;
    const initialY = pctY * window.innerHeight;
    x.set(initialX);
    y.set(initialY);
    setIsLeftHalf(initialX < window.innerWidth / 2);
    setIsTopHalf(initialY < window.innerHeight / 2);

    // Load saved chat size
    try {
      const savedSize = JSON.parse(localStorage.getItem("ai-chat-size") || "{}");
      if (savedSize.w && savedSize.h) {
        setChatSize({ w: Math.max(320, Math.min(700, savedSize.w)), h: Math.max(300, Math.min(800, savedSize.h)) });
      }
    } catch {}

    // Sidebar pin state
    const savedPinned = localStorage.getItem("sidebar-pinned");
    setIsPinned(savedPinned === "true");

    const handlePinChange = (e: any) => {
      setIsPinned(e.detail);
    };

    window.addEventListener("sidebar-pin-change", handlePinChange);

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      let curPctX = 0.95;
      let curPctY = 0.92;
      try {
        const pos = JSON.parse(localStorage.getItem("ai-assistant-pos") || "{}");
        if (typeof pos.pctX === "number") { curPctX = pos.pctX; curPctY = pos.pctY; }
      } catch {}
      const newX = Math.max(92, Math.min(w - 64, curPctX * w));
      const newY = Math.max(56, Math.min(h - 64, curPctY * h));
      x.set(newX);
      y.set(newY);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("sidebar-pin-change", handlePinChange);
      window.removeEventListener("resize", handleResize);
    };
  }, [x, y, session?.user?.id]);

  // Sync orientation during drag
  useEffect(() => {
    const unsubX = x.on("change", (val) => setIsLeftHalf(val < window.innerWidth / 2));
    const unsubY = y.on("change", (val) => setIsTopHalf(val < window.innerHeight / 2));
    return () => { unsubX(); unsubY(); };
  }, [x, y]);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    if (activeChatId && messages.length > 0) {
      saveChatMessages(activeChatId, messages);
      // Update lastMessageAt in index
      setChatIndex((prev) => {
        const next = prev.map((c) =>
          c.id === activeChatId ? { ...c, lastMessageAt: Date.now() } : c
        );
        saveChatIndex(next);
        return next;
      });
    }
  }, [messages, activeChatId]);

  // Track whether user is near the bottom of the chat scroll
  const [isNearBottom, setIsNearBottom] = useState(true);

  const checkIfNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    setIsNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }, []);

  // Only auto-scroll when the chat first opens or user sends a new message (not during streaming)
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const msgCount = messages.length;
    // Scroll to bottom when: opening chat, or a new user message was just added (count increased by 2: user + empty AI)
    if (msgCount !== prevMsgCountRef.current && msgCount >= 2) {
      const lastTwo = messages.slice(-2);
      const userJustSent = lastTwo.length === 2 && lastTwo[0].role === "user" && lastTwo[1].role === "ai" && lastTwo[1].content === "";
      if (userJustSent) {
        el.scrollTop = el.scrollHeight;
        setIsNearBottom(true);
      }
    }
    prevMsgCountRef.current = msgCount;
  }, [messages]);

  // Scroll to bottom when chat opens
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsNearBottom(true);
    }
  }, [open]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      setIsNearBottom(true);
    }
  }, []);

  const [winSize, setWinSize] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const update = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Chat management ──

  const createNewChat = useCallback(() => {
    const index = getChatIndex();

    // Enforce limit: remove oldest chats beyond limit
    if (index.length >= chatLimit) {
      const sorted = [...index].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      const toRemove = sorted.slice(chatLimit - 1); // keep chatLimit-1 to make room for new
      for (const chat of toRemove) {
        deleteChatStorage(chat.id);
      }
      const kept = sorted.slice(0, chatLimit - 1);
      saveChatIndex(kept);
      setChatIndex(kept);
    }

    const id = generateChatId();
    const meta: ChatMeta = {
      id,
      title: language === "uz" ? "Yangi suhbat" : language === "ru" ? "Новый чат" : "New chat",
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };

    const updated = [meta, ...getChatIndex()];
    saveChatIndex(updated);
    setChatIndex(updated);
    setActiveChatId(id);
    setMessages([]);
    localStorage.setItem(_userKeyPrefix + ACTIVE_CHAT_KEY, id);
    setShowChatList(false);
  }, [chatLimit, language]);

  const switchToChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setMessages(getChatMessages(chatId));
    localStorage.setItem(_userKeyPrefix + ACTIVE_CHAT_KEY, chatId);
    setShowChatList(false);
  }, []);

  const deleteChat = useCallback((chatId: string) => {
    deleteChatStorage(chatId);
    const updated = getChatIndex().filter((c) => c.id !== chatId);
    saveChatIndex(updated);
    setChatIndex(updated);

    if (activeChatId === chatId) {
      if (updated.length > 0) {
        setActiveChatId(updated[0].id);
        setMessages(getChatMessages(updated[0].id));
        localStorage.setItem(_userKeyPrefix + ACTIVE_CHAT_KEY, updated[0].id);
      } else {
        setActiveChatId(null);
        setMessages([]);
        localStorage.removeItem(_userKeyPrefix + ACTIVE_CHAT_KEY);
      }
    }
  }, [activeChatId]);

  // ── Message helpers ──

  const appendToLastAiMessage = useCallback((delta: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const lastIndex = next.length - 1;
      if (next[lastIndex].role !== "ai") {
        next.push({ role: "ai", content: delta });
        return next;
      }
      next[lastIndex] = { ...next[lastIndex], content: `${next[lastIndex].content}${delta}` };
      return next;
    });
  }, []);

  const setLastAiMessage = useCallback((content: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return [{ role: "ai", content }];
      const next = [...prev];
      const lastIndex = next.length - 1;
      if (next[lastIndex].role !== "ai") {
        next.push({ role: "ai", content });
        return next;
      }
      next[lastIndex] = { ...next[lastIndex], content };
      return next;
    });
  }, []);

  // ── Resize handling (global listeners to avoid hover-trigger bug) ──

  // Store direction at drag start so it doesn't flip mid-resize
  const resizeDirRef = useRef({ leftHalf: false, topHalf: false });

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    resizeStartRef.current = { mx: e.clientX, my: e.clientY, w: chatSize.w, h: chatSize.h };
    resizeDirRef.current = { leftHalf: isLeftHalf, topHalf: isTopHalf };

    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      const dx = ev.clientX - resizeStartRef.current.mx;
      const dy = ev.clientY - resizeStartRef.current.my;
      const wDelta = resizeDirRef.current.leftHalf ? dx : -dx;
      const hDelta = resizeDirRef.current.topHalf ? dy : -dy;
      const newW = Math.max(CHAT_MIN_W, Math.min(CHAT_MAX_W, resizeStartRef.current.w + wDelta));
      const newH = Math.max(CHAT_MIN_H, Math.min(CHAT_MAX_H, resizeStartRef.current.h + hDelta));
      setChatSize({ w: newW, h: newH });
    };

    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Save after state has settled
      setChatSize((cur) => {
        localStorage.setItem("ai-chat-size", JSON.stringify(cur));
        return cur;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [chatSize, isLeftHalf, isTopHalf]);

  // ── Send message ──

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    const userMsg = input.trim();

    // Auto-create a chat if none exists
    let currentChatId = activeChatId;
    if (!currentChatId) {
      const id = generateChatId();
      const meta: ChatMeta = {
        id,
        title: userMsg.slice(0, 40),
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
      };
      const updated = [meta, ...chatIndex];
      saveChatIndex(updated);
      setChatIndex(updated);
      setActiveChatId(id);
      localStorage.setItem(_userKeyPrefix + ACTIVE_CHAT_KEY, id);
      currentChatId = id;
    }

    // Update title from first message if it's a default title
    const currentMeta = chatIndex.find((c) => c.id === currentChatId);
    if (currentMeta && messages.length === 0) {
      const newTitle = userMsg.slice(0, 40);
      setChatIndex((prev) => {
        const next = prev.map((c) => (c.id === currentChatId ? { ...c, title: newTitle } : c));
        saveChatIndex(next);
        return next;
      });
    }

    const historySnapshot = messages;
    setMessages((prev) => [...prev, { role: "user", content: userMsg }, { role: "ai", content: "" }]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: historySnapshot,
          context: { pathname },
          language,
          stream: true,
        }),
      });

      if (!response.ok) {
        let message = "Error connecting to AI.";
        try {
          const err = await response.json();
          message = err?.error || message;
        } catch {}
        throw new Error(message);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!response.body || !contentType.includes("text/event-stream")) {
        const data = await response.json();
        setLastAiMessage(data.reply || "No response from AI.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processChunk = (chunk: string) => {
        const line = chunk.split("\n").find((item) => item.startsWith("data: "));
        if (!line) return;
        const payload = line.slice(6).trim();
        if (!payload) return;

        try {
          const event = JSON.parse(payload) as { type?: string; text?: string; message?: string };
          if (event.type === "delta" && typeof event.text === "string") {
            appendToLastAiMessage(event.text);
            return;
          }
          if (event.type === "error") {
            throw new Error(event.message || "Error connecting to AI.");
          }
        } catch (error) {
          if (error instanceof Error) throw error;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) processChunk(chunk);
      }
      if (buffer.trim()) processChunk(buffer);
    } catch (error) {
      const fallback = error instanceof Error ? error.message : "Error connecting to AI.";
      setMessages((prev) => {
        if (prev.length === 0) return [{ role: "ai", content: fallback }];
        const next = [...prev];
        const lastIndex = next.length - 1;
        if (next[lastIndex].role === "ai" && !next[lastIndex].content.trim()) {
          next[lastIndex] = { ...next[lastIndex], content: fallback };
          return next;
        }
        next.push({ role: "ai", content: fallback });
        return next;
      });
    } finally {
      setIsSending(false);
    }
  };

  // ── Visibility ──

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setChatSize(preSizeRef.current);
      setIsMaximized(false);
      localStorage.setItem("ai-chat-size", JSON.stringify(preSizeRef.current));
    } else {
      preSizeRef.current = chatSize;
      const maxW = Math.min(window.innerWidth - 40, 1200);
      const maxH = Math.min(window.innerHeight - 80, 1000);
      setChatSize({ w: maxW, h: maxH });
      setIsMaximized(true);
    }
  }, [isMaximized, chatSize]);

  const hideOnPaths = pathname === "/settings"
    || pathname.endsWith("/submit")
    || pathname.includes("/assessments/new")
    || pathname.endsWith("/edit");
  if (!mounted || hideOnPaths) return null;

  const winW = winSize.w;
  const winH = winSize.h;
  const sidebarWidth = isPinned ? 280 : 72;

  const sortedChats = [...chatIndex].sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  // ── Render ──

  return (
    <div className="fixed inset-0 pointer-events-none z-50">
      <motion.div
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragElastic={0}
        onDragStart={() => setDragged(true)}
        onDragEnd={() => {
          setTimeout(() => setDragged(false), 50);
          const pctX = x.get() / window.innerWidth;
          const pctY = y.get() / window.innerHeight;
          localStorage.setItem("ai-assistant-pos", JSON.stringify({ pctX, pctY }));
        }}
        style={{ x, y, touchAction: "none" }}
        dragConstraints={{
          left: 20,
          top: 56,
          right: winW - 64,
          bottom: winH - 64,
        }}
        className="absolute pointer-events-auto"
      >
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: isTopHalf ? -20 : 20, x: isLeftHalf ? -20 : 20 }}
              animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: isTopHalf ? -20 : 20, x: isLeftHalf ? -20 : 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              style={{ transformOrigin: `${isTopHalf ? "top" : "bottom"} ${isLeftHalf ? "left" : "right"}`, width: chatSize.w, height: chatSize.h }}
              className={cn(
                "absolute bg-background rounded-2xl overflow-hidden shadow-2xl border border-primary/20 flex flex-col",
                isTopHalf ? "top-13" : "bottom-13",
                isLeftHalf ? "left-0" : "right-0"
              )}
            >
              {/* Header — also acts as drag handle */}
              <div
                onPointerDown={(e) => { dragControls.start(e); }}
                className="bg-primary p-3 text-primary-foreground flex items-center justify-between cursor-grab active:cursor-grabbing"
                style={{ touchAction: "none" }}
              >
                {showChatList ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowChatList(false)}
                      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="text-sm font-bold">
                        {language === "uz" ? "Suhbatlar" : language === "ru" ? "Чаты" : "Chats"}
                      </span>
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] opacity-70">{chatIndex.length}/{chatLimit}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white hover:bg-white/20 rounded-full"
                        onClick={() => setOpen(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="bg-white/20 p-1 rounded-lg">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <span className="font-bold text-sm">{t("aiAssistant")}</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white hover:bg-white/20 rounded-full"
                        title={language === "uz" ? "Suhbatlar" : language === "ru" ? "Чаты" : "Chat history"}
                        onClick={(e) => { e.stopPropagation(); setShowChatList(true); }}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white hover:bg-white/20 rounded-full"
                        title={language === "uz" ? "Yangi suhbat" : language === "ru" ? "Новый чат" : "New chat"}
                        onClick={(e) => { e.stopPropagation(); createNewChat(); }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white hover:bg-white/20 rounded-full"
                        title={isMaximized ? (language === "uz" ? "Kichraytirish" : language === "ru" ? "Уменьшить" : "Minimize") : (language === "uz" ? "Kattalashtirish" : language === "ru" ? "Увеличить" : "Maximize")}
                        onClick={(e) => { e.stopPropagation(); toggleMaximize(); }}
                      >
                        {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white hover:bg-white/20 rounded-full"
                        onClick={() => setOpen(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {showChatList ? (
                /* ── Chat list view ── */
                <div className="overflow-y-auto bg-background custom-scrollbar flex-1">
                  {/* New chat button */}
                  <button
                    type="button"
                    onClick={createNewChat}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-primary hover:bg-primary/5 transition-colors border-b"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="font-medium">
                      {language === "uz" ? "Yangi suhbat" : language === "ru" ? "Новый чат" : "New chat"}
                    </span>
                  </button>

                  {sortedChats.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-40" />
                      <p className="text-sm text-muted-foreground">
                        {language === "uz" ? "Suhbatlar yo'q" : language === "ru" ? "Нет чатов" : "No chats yet"}
                      </p>
                    </div>
                  ) : (
                    sortedChats.map((chat) => (
                      <div
                        key={chat.id}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors group",
                          chat.id === activeChatId ? "bg-primary/10" : "hover:bg-muted/50"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => switchToChat(chat.id)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className="text-sm font-medium truncate">{chat.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(chat.lastMessageAt).toLocaleDateString()}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChat(chat.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                /* ── Chat messages view ── */
                <>
                  <div className="relative flex-1">
                  <div ref={scrollRef} onScroll={checkIfNearBottom} className="absolute inset-0 overflow-y-auto p-4 space-y-4 bg-background custom-scrollbar">
                    {messages.length === 0 && (
                      <div className="text-center py-8 px-4">
                        <div className="bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-primary">
                          <Sparkles className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium">{t("welcomeBack")}!</p>
                        <p className="text-xs text-muted-foreground mt-1">{t("askAnythingAboutResults")}</p>
                      </div>
                    )}
                    {messages.map((msg, i) => (
                      <div key={i} className={cn("flex items-start gap-2", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
                        <div className={cn("w-7 h-7 rounded-full flex items-center justify-center border-0 shrink-0", msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                          {msg.role === "user" ? <UserIcon className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                        </div>
                        <div className={cn("max-w-[80%] px-3 py-2 rounded-2xl text-sm", msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none shadow-sm" : "bg-muted rounded-tl-none")}>
                          <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.content}</ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ))}
                    {isSending && (
                      <div className="flex items-start gap-2">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center border-0 shrink-0"><Sparkles className="h-4 w-4" /></div>
                        <div className="bg-muted px-3 py-2 rounded-2xl rounded-tl-none"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
                      </div>
                    )}
                  </div>

                  {/* Scroll to bottom button */}
                  {!isNearBottom && (
                    <button
                      type="button"
                      onClick={scrollToBottom}
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground rounded-full p-1.5 shadow-md hover:scale-110 transition-transform z-10"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  )}
                  </div>

                  <div className="p-3 border-t bg-muted/30">
                    <div className="flex gap-2">
                      <Input
                        placeholder={t("typeYourQuestion")}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        disabled={isSending}
                        className="bg-background"
                      />
                      <Button size="icon" onClick={handleSend} disabled={!input.trim() || isSending}><Send className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </>
              )}

              {/* Resize handle — positioned in the corner opposite the anchor */}
              <div
                onPointerDown={onResizePointerDown}
                className={cn(
                  "absolute w-5 h-5 z-20 touch-none",
                  isTopHalf && isLeftHalf && "bottom-0 right-0 cursor-se-resize",
                  isTopHalf && !isLeftHalf && "bottom-0 left-0 cursor-sw-resize",
                  !isTopHalf && isLeftHalf && "top-0 right-0 cursor-ne-resize",
                  !isTopHalf && !isLeftHalf && "top-0 left-0 cursor-nw-resize",
                )}
              >
                <svg
                  viewBox="0 0 10 10"
                  className={cn(
                    "w-3 h-3 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors m-0.5",
                    isTopHalf && isLeftHalf && "",
                    isTopHalf && !isLeftHalf && "scale-x-[-1]",
                    !isTopHalf && isLeftHalf && "scale-y-[-1]",
                    !isTopHalf && !isLeftHalf && "scale-[-1]",
                  )}
                >
                  <path d="M9 1L1 9M9 4.5L4.5 9M9 8L8 9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                </svg>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => !dragged && setOpen(!open)}
          onPointerDown={(e) => dragControls.start(e)}
          className={cn(
            "h-11 w-11 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all bg-primary text-primary-foreground cursor-grab active:cursor-grabbing relative z-10 flex items-center justify-center focus:outline-none",
            open && "rotate-90"
          )}
          style={{ WebkitTapHighlightColor: "transparent", touchAction: "none" }}
        >
          {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </button>
      </motion.div>
    </div>
  );
}
