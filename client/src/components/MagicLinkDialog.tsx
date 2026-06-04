import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MagicLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "email" | "sent";

export function MagicLinkDialog({ open, onOpenChange }: MagicLinkDialogProps) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [loading, setLoading] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clean up any pending reset timer on unmount to prevent setState-after-unmount
  useEffect(() => {
    return () => {
      clearTimeout(resetTimerRef.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error("Request failed");
      setStep("sent");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose(open: boolean) {
    if (!open) {
      // Reset state when dialog closes
      resetTimerRef.current = setTimeout(() => {
        setEmail("");
        setStep("email");
        setLoading(false);
      }, 300);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        style={{
          background: "rgba(13,11,18,0.97)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          maxWidth: 420,
          padding: "32px 28px",
        }}
      >
        {step === "email" ? (
          <>
            <DialogHeader style={{ marginBottom: 20 }}>
              <DialogTitle
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#fff",
                  fontFamily: "'Space Grotesk', sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                Sign in to Truth Desk
              </DialogTitle>
              <DialogDescription style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginTop: 6 }}>
                Enter your email and we'll send you a secure sign-in link. No password required.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                disabled={loading}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  borderRadius: 8,
                  height: 44,
                  fontSize: 14,
                }}
              />
              <Button
                type="submit"
                disabled={loading || !email.trim()}
                style={{
                  background: "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
                  color: "#fff",
                  borderRadius: 8,
                  height: 44,
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: "0 0 18px rgba(192,38,211,0.35)",
                  border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.7 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {loading ? "Sending…" : "Send sign-in link →"}
              </Button>
            </form>
            <p style={{ marginTop: 16, fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
              Link expires in 15 minutes · Single use · No password stored
            </p>
          </>
        ) : (
          <>
            <DialogHeader style={{ marginBottom: 20 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                  fontSize: 22,
                }}
              >
                ✉️
              </div>
              <DialogTitle
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#fff",
                  fontFamily: "'Space Grotesk', sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                Check your email
              </DialogTitle>
              <DialogDescription style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginTop: 6 }}>
                We sent a sign-in link to <strong style={{ color: "rgba(255,255,255,0.75)" }}>{email}</strong>.
                Click the link in the email to sign in — it expires in 15 minutes.
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => setStep("email")}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.7)",
                borderRadius: 8,
                height: 40,
                fontSize: 13,
                marginTop: 4,
              }}
            >
              Use a different email
            </Button>
            <p style={{ marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
              Didn't receive it? Check your spam folder or try again in a few minutes.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
