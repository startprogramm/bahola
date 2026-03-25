"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Send,
  Paperclip,
  MoreVertical,
  MessageSquare,
  Pin,
  Trash2,
  Pencil,
  Loader2,
  X,
  Check,
  FileText,
  Image as ImageIcon,
  Download,
  ClipboardList,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { cachedFetch, invalidateCache } from "@/lib/fetch-cache";
import { getInitials, formatDateTime, normalizeImageUrl } from "@/lib/utils";

interface Author {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
}

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: Author;
}

interface StreamPost {
  id: string;
  content: string;
  attachments: string | null;
  pinned: boolean;
  createdAt: string;
  author: Author;
  comments: Comment[];
  _count: {
    comments: number;
  };
}

interface ClassStreamProps {
  classId: string;
  isTeacher: boolean;
}

export function ClassStream({ classId, isTeacher }: ClassStreamProps) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [posts, setPosts] = useState<StreamPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [newPost, setNewPost] = useState("");
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [commentingOn, setCommentingOn] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [hasNewUpdates, setHasNewUpdates] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const suppressBannerUntil = useRef(0);

  // Full refresh: fetch from server, update posts, clear banner, re-cache
  const refreshStream = useCallback(async () => {
    try {
      invalidateCache(`/api/classes/${classId}/stream`);
      const res = await fetch(`/api/classes/${classId}/stream`);
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
        setHasNewUpdates(false);
      }
    } catch {
      // Ignore — keep current posts
    }
  }, [classId]);

  // Initial fetch + poll for external changes
  useEffect(() => {
    fetchPosts();

    // Poll every 15s — show banner if external changes detected
    const pollInterval = setInterval(() => {
      pollForChanges();
    }, 15000);

    return () => clearInterval(pollInterval);
  }, [classId]);

  // Re-cache on page visibility (tab switch back, re-entry)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshStream();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refreshStream]);

  // Poll without replacing posts — detect if server has changes and show banner
  const pollForChanges = async () => {
    try {
      const res = await fetch(`/api/classes/${classId}/stream`);
      if (res.ok) {
        const data = await res.json();
        const serverPosts: StreamPost[] = data.posts || [];
        const currentPosts = postsRef.current;
        // Compare post IDs and counts to detect external changes
        const currentKey = currentPosts.map(p => `${p.id}:${p._count.comments}`).join(",");
        const serverKey = serverPosts.map(p => `${p.id}:${p._count.comments}`).join(",");
        if (currentKey !== serverKey) {
          if (Date.now() < suppressBannerUntil.current) {
            // This user just mutated — silently sync instead of showing banner
            setPosts(serverPosts);
          } else {
            setHasNewUpdates(true);
          }
        }
      }
    } catch {
      // Silently ignore polling errors
    }
  };

  const fetchPosts = async () => {
    try {
      const data = await cachedFetch(`/api/classes/${classId}/stream`);
      if (data) {
        setPosts(data.posts || []);
      }
    } catch (error) {
      console.error("Error fetching stream:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePost = async () => {
    if (!newPost.trim() && attachments.length === 0) return;

    setPosting(true);
    try {
      const formData = new FormData();
      formData.append("content", newPost);
      attachments.forEach((file) => {
        formData.append("attachments", file);
      });

      const res = await fetch(`/api/classes/${classId}/stream`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setPosts([data.post, ...posts]);
        setNewPost("");
        setAttachments([]);
        suppressBannerUntil.current = Date.now() + 20000;
        invalidateCache(`/api/classes/${classId}/stream`);
        sessionStorage.removeItem(`class-detail-${classId}`);
        toast({
          title: language === "uz" ? "Xabar joylandi" : language === "ru" ? "Сообщение опубликовано" : "Posted",
          description: language === "uz" ? "Xabaringiz muvaffaqiyatli joylandi" : language === "ru" ? "Сообщение успешно опубликовано" : "Your message has been posted",
        });
      } else {
        throw new Error("Failed to post");
      }
    } catch (error) {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: language === "uz" ? "Xabarni joylab bo'lmadi" : language === "ru" ? "Не удалось опубликовать" : "Failed to post message",
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  };

  const handleComment = async (postId: string) => {
    const content = commentInputs[postId];
    if (!content?.trim()) return;

    setCommentingOn(postId);
    try {
      const res = await fetch(`/api/stream/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        const data = await res.json();
        setPosts(posts.map(post => {
          if (post.id === postId) {
            return {
              ...post,
              comments: [...post.comments, data.comment],
              _count: { comments: post._count.comments + 1 },
            };
          }
          return post;
        }));
        setCommentInputs({ ...commentInputs, [postId]: "" });
        setExpandedComments(prev => new Set(prev).add(postId));
        suppressBannerUntil.current = Date.now() + 20000;
        invalidateCache(`/api/classes/${classId}/stream`);
        sessionStorage.removeItem(`class-detail-${classId}`);
      }
    } catch (error) {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: language === "uz" ? "Izoh qo'shib bo'lmadi" : language === "ru" ? "Не удалось добавить комментарий" : "Failed to add comment",
        variant: "destructive",
      });
    } finally {
      setCommentingOn(null);
    }
  };

  const toggleComments = (postId: string) => {
    setExpandedComments(prev => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const handleTogglePin = async (postId: string, currentlyPinned: boolean) => {
    try {
      const res = await fetch(`/api/stream/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !currentlyPinned }),
      });

      if (res.ok) {
        setPosts(posts.map(post =>
          post.id === postId ? { ...post, pinned: !currentlyPinned } : post
        ).sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }));
        suppressBannerUntil.current = Date.now() + 20000;
        toast({
          title: currentlyPinned ? t("unpinned") : t("pinned"),
          description: currentlyPinned
            ? (language === "uz" ? "Xabar olib tashlandi" : language === "ru" ? "Сообщение откреплено" : "Post unpinned")
            : (language === "uz" ? "Xabar yuqoriga qo'yildi" : language === "ru" ? "Сообщение закреплено" : "Post pinned to top"),
        });
      }
    } catch (error) {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: language === "uz" ? "Amaliyotni bajarib bo'lmadi" : language === "ru" ? "Операция не выполнена" : "Operation failed",
        variant: "destructive",
      });
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      const res = await fetch(`/api/stream/${postId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setPosts(posts.filter(post => post.id !== postId));
        setDeletingPostId(null);
        suppressBannerUntil.current = Date.now() + 20000;
        invalidateCache(`/api/classes/${classId}/stream`);
        sessionStorage.removeItem(`class-detail-${classId}`);
        toast({
          title: t("deleted"),
          description: language === "uz" ? "Xabar o'chirildi" : language === "ru" ? "Сообщение удалено" : "Post deleted",
        });
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed: ${res.status}`);
      }
    } catch (error) {
      setDeletingPostId(null);
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: language === "uz" ? "O'chirib bo'lmadi" : language === "ru" ? "Не удалось удалить" : "Failed to delete",
        variant: "destructive",
      });
    }
  };

  const startEditing = (post: StreamPost) => {
    setEditingPostId(post.id);
    setEditContent(post.content);
  };

  const cancelEditing = () => {
    setEditingPostId(null);
    setEditContent("");
  };

  const handleEditPost = async (postId: string) => {
    if (!editContent.trim()) return;

    setSavingEdit(true);
    try {
      const res = await fetch(`/api/stream/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });

      if (res.ok) {
        const data = await res.json();
        setPosts(posts.map(post =>
          post.id === postId ? { ...post, content: data.post.content } : post
        ));
        setEditingPostId(null);
        setEditContent("");
        suppressBannerUntil.current = Date.now() + 20000;
        invalidateCache(`/api/classes/${classId}/stream`);
        toast({
          title: language === "uz" ? "Saqlandi" : language === "ru" ? "Сохранено" : "Saved",
          description: language === "uz" ? "Xabar tahrirlandi" : language === "ru" ? "Сообщение отредактировано" : "Post updated",
        });
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to edit");
      }
    } catch (error) {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: language === "uz" ? "Tahrirlash amalga oshmadi" : language === "ru" ? "Не удалось отредактировать" : "Failed to edit post",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return <StreamSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Post Composer - Minimal style */}
      <div className="space-y-2">
        <div className="flex gap-2 sm:gap-3">
          <div className="flex-1 relative" data-guide="stream-compose">
            <textarea
              placeholder={t("writeMessage")}
              value={newPost}
              onChange={(e) => {
                setNewPost(e.target.value);
                // Auto-expand
                e.target.style.height = "auto";
                e.target.style.height = Math.max(44, e.target.scrollHeight) + "px";
              }}
              className="w-full min-h-[44px] max-h-[200px] px-3 sm:px-4 py-2.5 pr-20 sm:pr-28 rounded-full border bg-muted/50 text-sm resize-none focus:outline-none focus:border-border shadow-sm transition-all"
              rows={1}
            />
            <div className="absolute right-1 sm:right-2 inset-y-0 flex items-start pt-1.5 gap-0.5 sm:gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground hover:bg-transparent"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Paperclip className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground hover:bg-transparent"
                onClick={handlePost}
                disabled={(!newPost.trim() && attachments.length === 0) || posting}
              >
                {posting ? (
                  <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Selected Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-muted rounded-full text-xs sm:text-sm"
              >
                {file.type.startsWith("image/") ? (
                  <ImageIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
                ) : (
                  <FileText className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
                )}
                <span className="truncate max-w-[100px] sm:max-w-[150px]">{file.name}</span>
                <button
                  onClick={() => removeAttachment(index)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stream Updated Banner */}
      {hasNewUpdates && (
        <button
          onClick={refreshStream}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/15 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {language === "uz" ? "Yangi xabarlar bor. Yangilash uchun bosing" : language === "ru" ? "Есть новые сообщения. Нажмите, чтобы обновить" : "Stream updated. Tap to refresh"}
        </button>
      )}

      {/* Posts List */}
      {posts.length === 0 ? (
        <div className="py-12 text-center">
          <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
        </div>
      ) : (
        <div className="space-y-4" ref={scrollRef}>
          {posts.map((post) => (
            <Card key={post.id} className={post.pinned ? "border-primary/50" : ""}>
              <CardContent className="pt-4">
                {/* Post Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <Avatar className="h-8 w-8 sm:h-10 sm:w-10">
                      <AvatarImage src={normalizeImageUrl(post.author.avatar) || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-xs sm:text-sm">
                        {getInitials(post.author.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <span className="font-medium text-sm sm:text-base">
                          {(post.author as any).role === "DIRECTOR" ? "Direktor" : post.author.name}
                        </span>
                        {post.pinned && (
                          <Pin className="h-3 w-3 text-primary" />
                        )}
                      </div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground">
                        {formatDateTime(post.createdAt)}
                      </p>
                    </div>
                  </div>
                  {(isTeacher || post.author.id === session?.user?.id) && (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="h-7 w-7 sm:h-8 sm:w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isTeacher && (
                          <DropdownMenuItem onSelect={() => handleTogglePin(post.id, post.pinned)}>
                            <Pin className="h-4 w-4 mr-2" />
                            {post.pinned ? t("unpin") : t("pin")}
                          </DropdownMenuItem>
                        )}
                        {post.author.id === session?.user?.id && (
                          <DropdownMenuItem onSelect={() => startEditing(post)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            {t("edit")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => setDeletingPostId(post.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Delete Confirmation */}
                {deletingPostId === post.id && (
                  <div className="mb-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                    <p className="text-sm mb-2">
                      {language === "uz" ? "Bu xabarni o'chirishni xohlaysizmi?" : language === "ru" ? "Вы уверены, что хотите удалить это сообщение?" : "Are you sure you want to delete this post?"}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => handleDeletePost(post.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        {t("delete")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setDeletingPostId(null)}
                      >
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Post Content */}
                {editingPostId === post.id ? (
                  <div className="mb-4">
                    <textarea
                      value={editContent}
                      onChange={(e) => {
                        setEditContent(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = Math.max(60, e.target.scrollHeight) + "px";
                      }}
                      className="w-full min-h-[60px] max-h-[300px] px-3 py-2 rounded-lg border bg-muted/50 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          cancelEditing();
                        }
                      }}
                    />
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleEditPost(post.id)}
                        disabled={!editContent.trim() || savingEdit}
                      >
                        {savingEdit ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5 mr-1" />
                        )}
                        {t("save")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={cancelEditing}
                        disabled={savingEdit}
                      >
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  post.content && (
                    <p className="text-sm whitespace-pre-wrap mb-4">{post.content}</p>
                  )
                )}

                {/* Attachments */}
                {post.attachments && (() => {
                  try {
                    const attachments = JSON.parse(post.attachments) as any[];
                    if (attachments.length === 0) return null;
                    return (
                      <div className="mb-4 space-y-2">
                        {attachments.map((attachment, index) => {
                          if (attachment.type === "assessment") {
                            return (
                              <Link
                                key={index}
                                href={isTeacher ? `/assessments/${attachment.id}` : `/assessments/${attachment.id}/feedback`}
                                className="flex items-center gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
                              >
                                <div className="h-10 w-10 rounded bg-primary/20 flex items-center justify-center">
                                  <ClipboardList className="h-5 w-5 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  {Date.now() - new Date(post.createdAt).getTime() < 24 * 60 * 60 * 1000 && (
                                    <p className="text-xs text-primary font-medium uppercase tracking-wider mb-0.5">
                                      {language === "uz" ? "Yangi topshiriq" : language === "ru" ? "Новое задание" : "New Assessment"}
                                    </p>
                                  )}
                                  <p className="text-sm font-semibold truncate">{attachment.title}</p>
                                </div>
                                <ChevronRight className="h-4 w-4 text-primary/50" />
                              </Link>
                            );
                          }

                          return (
                            <a
                              key={index}
                              href={normalizeImageUrl(attachment.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                            >
                              {attachment.type.startsWith("image/") ? (
                                <div className="relative">
                                  <img
                                    src={normalizeImageUrl(attachment.url)}
                                    alt={attachment.name}
                                    width={64}
                                    height={64}
                                    className="h-16 w-16 object-cover rounded"
                                  />
                                </div>
                              ) : (
                                <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center">
                                  <FileText className="h-5 w-5 text-primary" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{attachment.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : ""}
                                </p>
                              </div>
                              <Download className="h-4 w-4 text-muted-foreground" />
                            </a>
                          );
                        })}
                      </div>
                    );
                  } catch {
                    return null;
                  }
                })()}

                {/* Comments Section */}
                <div className="border-t border-border pt-3">
                  <button
                    onClick={() => toggleComments(post.id)}
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <MessageSquare className="h-4 w-4" />
                    {post._count.comments > 0
                      ? `${post._count.comments} ${language === "uz" ? "izoh" : language === "ru" ? "комментариев" : "comments"}`
                      : (language === "uz" ? "Izoh qoldirish" : language === "ru" ? "Комментировать" : "Comment")}
                  </button>

                  {expandedComments.has(post.id) && (
                    <div className="mt-3 space-y-3">
                      {/* Existing Comments */}
                      {post.comments.map((comment) => (
                        <div key={comment.id} className="flex gap-2 pl-2 border-l-2 border-muted">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={normalizeImageUrl(comment.author.avatar) || undefined} />
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {getInitials(comment.author.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {(comment.author as any).role === "DIRECTOR" ? "Direktor" : comment.author.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDateTime(comment.createdAt)}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{comment.content}</p>
                          </div>
                        </div>
                      ))}

                      {/* Comment Input */}
                      <div className="flex gap-1.5 sm:gap-2 items-center mt-2">
                        <Avatar className="h-6 w-6 sm:h-7 sm:w-7">
                          <AvatarImage src={normalizeImageUrl(session?.user?.avatar) || undefined} />
                          <AvatarFallback className="text-[10px] sm:text-xs bg-primary/10 text-primary">
                            {getInitials(session?.user?.name || "U")}
                          </AvatarFallback>
                        </Avatar>
                        <input
                          type="text"
                          placeholder={language === "uz" ? "Izoh yozing..." : language === "ru" ? "Напишите комментарий..." : "Write a comment..."}
                          value={commentInputs[post.id] || ""}
                          onChange={(e) => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleComment(post.id);
                            }
                          }}
                          className="flex-1 text-xs sm:text-sm bg-muted rounded-full px-3 sm:px-4 py-1.5 sm:py-2 focus:outline-none focus:border-border"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 sm:h-8 sm:w-8"
                          onClick={() => handleComment(post.id)}
                          disabled={!commentInputs[post.id]?.trim() || commentingOn === post.id}
                        >
                          {commentingOn === post.id ? (
                            <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StreamSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="pt-4">
            <div className="flex gap-3 mb-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
