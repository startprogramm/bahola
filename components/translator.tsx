"use client";

import { useState, useCallback } from "react";
import { Languages, Loader2, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface TranslatorProps {
  text?: string;
  variant?: "icon" | "button" | "inline";
  className?: string;
}

export function Translator({ text, variant = "icon", className = "" }: TranslatorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState(text || "");
  const [translatedText, setTranslatedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const translateToUzbek = useCallback(async (textToTranslate: string) => {
    if (!textToTranslate.trim()) {
      toast({
        title: "No text to translate",
        description: "Please enter some text to translate",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToTranslate, targetLanguage: "uzbek" }),
      });

      if (!response.ok) {
        throw new Error("Translation failed");
      }

      const data = await response.json();
      setTranslatedText(data.translatedText);
    } catch (error) {
      toast({
        title: "Translation failed",
        description: "Could not translate the text. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied!",
        description: "Translation copied to clipboard",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && text) {
      setInputText(text);
      translateToUzbek(text);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button
            variant="outline"
            size="icon"
            className={className}
            title="Translate to Uzbek"
          >
            <Languages className="h-4 w-4" />
          </Button>
        ) : variant === "inline" ? (
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-primary hover:underline text-sm ${className}`}
          >
            <Languages className="h-3.5 w-3.5" />
            O'zbekchaga tarjima
          </button>
        ) : (
          <Button variant="outline" size="sm" className={className}>
            <Languages className="h-4 w-4 mr-2" />
            O'zbekchaga tarjima
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="h-5 w-5" />
            O'zbekchaga tarjima qilish / Translate to Uzbek
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-auto">
          {/* Input Text */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Original Text (English)</label>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Enter text to translate..."
              rows={6}
              className="resize-none"
            />
          </div>

          {/* Translate Button */}
          <div className="flex justify-center">
            <Button
              onClick={() => translateToUzbek(inputText)}
              disabled={loading || !inputText.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Tarjima qilinmoqda...
                </>
              ) : (
                <>
                  <Languages className="h-4 w-4 mr-2" />
                  Tarjima qilish
                </>
              )}
            </Button>
          </div>

          {/* Translated Text */}
          {translatedText && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Tarjima (O'zbek tili)</label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Nusxalandi
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Nusxalash
                    </>
                  )}
                </Button>
              </div>
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg whitespace-pre-wrap text-sm">
                {translatedText}
              </div>
            </div>
          )}

          {/* Help Text */}
          <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
            <p className="font-medium mb-1">Foydalanish bo'yicha ko'rsatmalar:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Matnni yuqoridagi maydonga kiriting yoki nusxalang</li>
              <li>"Tarjima qilish" tugmasini bosing</li>
              <li>Tarjima qilingan matnni nusxalash uchun "Nusxalash" tugmasini bosing</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Floating translator button for pages
export function FloatingTranslator() {
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Translator variant="icon" className="h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-shadow" />
    </div>
  );
}

// Inline translator for specific text
export function TranslateButton({ text, className = "" }: { text: string; className?: string }) {
  return <Translator text={text} variant="button" className={className} />;
}
