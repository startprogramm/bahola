"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Loader2, XCircle, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/language-context";
import confetti from "canvas-confetti";

type Status = "loading" | "COMPLETED" | "PREPARING" | "PENDING" | "CANCELLED" | "timeout";

function ShopReturnContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get("order_id");
  const [status, setStatus] = useState<Status>("loading");
  const [plan, setPlan] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const attempts = useRef(0);

  useEffect(() => {
    if (!orderId) {
      setStatus("CANCELLED");
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/status`);
        if (!res.ok) {
          setStatus("CANCELLED");
          return;
        }
        const data = await res.json();
        setPlan(data.plan);

        if (data.status === "COMPLETED") {
          setStatus("COMPLETED");
          clearInterval(pollRef.current);
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        } else if (data.status === "CANCELLED") {
          setStatus("CANCELLED");
          clearInterval(pollRef.current);
        } else {
          setStatus(data.status);
          attempts.current++;
          if (attempts.current >= 15) {
            setStatus("timeout");
            clearInterval(pollRef.current);
          }
        }
      } catch {
        attempts.current++;
        if (attempts.current >= 15) {
          setStatus("timeout");
          clearInterval(pollRef.current);
        }
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => clearInterval(pollRef.current);
  }, [orderId]);

  return (
    <div className="max-w-md mx-auto flex items-center justify-center min-h-[60vh] p-4">
      <Card className="w-full">
        <CardContent className="py-10 text-center space-y-4">
          {status === "loading" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
              <p className="text-lg font-medium">{t("checkingPayment")}</p>
            </>
          )}

          {status === "COMPLETED" && (
            <>
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <h2 className="text-2xl font-bold">{t("paymentSuccess")}</h2>
              <p className="text-muted-foreground">
                {t("planActivated")} — {plan}
              </p>
              <Button onClick={() => router.push("/classes")} className="mt-4">
                {t("dashboard")}
              </Button>
            </>
          )}

          {(status === "PREPARING" || status === "PENDING") && (
            <>
              <Clock className="h-12 w-12 animate-pulse mx-auto text-yellow-500" />
              <p className="text-lg font-medium">{t("paymentProcessing")}</p>
              <p className="text-sm text-muted-foreground">{t("pleaseWait")}</p>
              <Button variant="outline" onClick={() => router.push("/shop")} className="mt-4">
                {t("back")}
              </Button>
            </>
          )}

          {status === "CANCELLED" && (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto" />
              <h2 className="text-2xl font-bold">{t("paymentFailed")}</h2>
              <p className="text-muted-foreground">{t("paymentCancelled")}</p>
              <Button variant="outline" onClick={() => router.push("/shop")} className="mt-4">
                {t("tryAgain")}
              </Button>
            </>
          )}

          {status === "timeout" && (
            <>
              <Clock className="h-16 w-16 text-yellow-500 mx-auto" />
              <h2 className="text-2xl font-bold">{t("paymentProcessing")}</h2>
              <p className="text-muted-foreground">{t("paymentDelayed")}</p>
              <Button variant="outline" onClick={() => router.push("/classes")} className="mt-4">
                {t("dashboard")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ShopReturnPage() {
  return (
    <Suspense fallback={
      <div className="max-w-md mx-auto flex items-center justify-center min-h-[60vh] p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    }>
      <ShopReturnContent />
    </Suspense>
  );
}
