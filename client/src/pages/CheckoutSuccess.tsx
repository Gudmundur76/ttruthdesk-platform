/**
 * CheckoutSuccess.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Route: /checkout/success
 *
 * PayPal redirects here after the user approves payment on the PayPal site.
 * The URL contains ?token=<orderId>&PayerID=<payerId>&tier=<planTier>.
 *
 * This page:
 *  1. Reads the orderId from the URL query string.
 *  2. Calls trpc.checkout.captureOrder to finalise the payment.
 *  3. Shows a success / error state.
 *  4. Redirects to /dashboard after 4 seconds on success.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CheckCircle2, XCircle } from "lucide-react";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();

  // Parse query params from the current URL
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("token") ?? params.get("orderId") ?? "";
  const tier = params.get("tier") ?? "";

  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [planLabel, setPlanLabel] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const capturedRef = useRef(false);

  const captureOrder = trpc.checkout.captureOrder.useMutation({
    onSuccess: (data) => {
      setPlanLabel(data.planTier);
      setStatus("success");
      // Auto-redirect after 4 s
      setTimeout(() => navigate("/dashboard"), 4000);
    },
    onError: (e) => {
      setErrorMsg(e.message);
      setStatus("error");
    },
  });

  useEffect(() => {
    if (!orderId || capturedRef.current) return;
    capturedRef.current = true;
    captureOrder.mutate({ orderId });
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        {status === "pending" && (
          <>
            <Spinner className="h-10 w-10 mx-auto text-primary" />
            <h1 className="text-xl font-semibold text-foreground">Activating your plan…</h1>
            <p className="text-sm text-muted-foreground">
              Confirming payment with PayPal. This takes just a moment.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 className="h-14 w-14 mx-auto text-green-500" />
            <h1 className="text-2xl font-bold text-foreground">Payment confirmed</h1>
            <p className="text-muted-foreground">
              Your <span className="font-semibold capitalize">{planLabel || tier}</span> plan is
              now active. Redirecting to your dashboard…
            </p>
            <Button onClick={() => navigate("/dashboard")} className="w-full">
              Go to Dashboard
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="h-14 w-14 mx-auto text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">Payment capture failed</h1>
            <p className="text-sm text-muted-foreground mb-2">{errorMsg}</p>
            <p className="text-sm text-muted-foreground">
              If you were charged, please contact us and quote your PayPal order ID:{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{orderId}</code>
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => navigate("/pricing")}>
                Back to Pricing
              </Button>
              <Button onClick={() => navigate("/dashboard")}>Go to Dashboard</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
