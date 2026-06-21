/**
 * Pricing.tsx — Phase 133
 * ─────────────────────────────────────────────────────────────────────────────
 * Public pricing page for citation.manus.space / citation.is.
 * Three tiers: Starter ($1,500), Diligence ($5,000), Platform Pilot ($12,000/yr).
 * Includes a "Request Access" form that calls billing.requestAccess tRPC mutation.
 * No authentication required — this is a public marketing page.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Tier definitions ─────────────────────────────────────────────────────────
const TIERS = [
  {
    id: "starter" as const,
    name: "Starter",
    price: "$1,500",
    unit: "per audit",
    tagline: "Single-document fact-check",
    color: "#7c3aed",
    highlight: false,
    features: [
      "Up to 200 claims extracted",
      "PDB / UniProt / PubMed verification",
      "Verdict + confidence score per claim",
      "Downloadable PDF audit report",
      "48-hour turnaround",
    ],
    cta: "Request Starter Audit",
  },
  {
    id: "diligence" as const,
    name: "Diligence",
    price: "$5,000",
    unit: "per audit",
    tagline: "Deep due-diligence package",
    color: "#c026d3",
    highlight: true,
    features: [
      "Unlimited claims per document",
      "All Starter features",
      "Misrepresentation classification",
      "Citation provenance chain",
      "Composite Truth Score",
      "Expert review flag + notes",
      "24-hour turnaround",
    ],
    cta: "Request Diligence Audit",
  },
  {
    id: "platform_pilot" as const,
    name: "Platform Pilot",
    price: "$12,000",
    unit: "per year",
    tagline: "Continuous monitoring + API access",
    color: "#0ea5e9",
    highlight: false,
    features: [
      "Unlimited audits",
      "All Diligence features",
      "REST API + tRPC access",
      "Autonomous monitoring feed",
      "Webhook delivery on new verdicts",
      "Dedicated Slack channel",
      "SLA: 4-hour response",
    ],
    cta: "Request Platform Access",
  },
] as const;

type TierId = (typeof TIERS)[number]["id"];

// ─── Component ────────────────────────────────────────────────────────────────
export default function Pricing() {
  const [selectedTier, setSelectedTier] = useState<TierId | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [useCase, setUseCase] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const requestAccess = trpc.billing.requestAccess.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Request received — we'll be in touch within 1 business day.");
    },
    onError: err => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTier) {
      toast.error("Please select a tier first.");
      return;
    }
    requestAccess.mutate({
      name: name.trim(),
      email: email.trim(),
      organisation: organisation.trim(),
      tier: selectedTier,
      useCase: useCase.trim() || undefined,
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0d0b12 0%, #0f0a1a 100%)",
        color: "#f0eeff",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="container py-4 flex items-center justify-between">
          <a
            href="/"
            style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                background: "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
              </svg>
            </div>
            <span style={{ fontWeight: 600, fontSize: 14, color: "#f0eeff" }}>
              Truth Desk
            </span>
          </a>
          <a
            href="/docs/api"
            style={{ fontSize: 13, color: "#9ca3af", textDecoration: "none" }}
          >
            API Docs
          </a>
        </div>
      </div>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="container py-16 text-center">
        <div
          style={{
            display: "inline-block",
            padding: "4px 12px",
            borderRadius: 20,
            background: "rgba(192, 38, 211, 0.15)",
            border: "1px solid rgba(192, 38, 211, 0.3)",
            fontSize: 12,
            color: "#c026d3",
            marginBottom: 16,
            fontWeight: 500,
          }}
        >
          Scientific Claim Verification
        </div>
        <h1
          style={{
            fontSize: "clamp(28px, 5vw, 48px)",
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: 16,
            background: "linear-gradient(135deg, #f0eeff 0%, #c084fc 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Audit your biotech claims<br />before they audit you
        </h1>
        <p style={{ fontSize: 16, color: "#9ca3af", maxWidth: 520, margin: "0 auto 48px" }}>
          Every claim in your paper, patent, or investor report — verified against
          PDB, UniProt, PubMed, and 12 other primary databases. Machine-speed,
          human-grade accuracy.
        </p>

        {/* ── Tier cards ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
            maxWidth: 900,
            margin: "0 auto 64px",
          }}
        >
          {TIERS.map(tier => (
            <button
              key={tier.id}
              onClick={() => {
                setSelectedTier(tier.id);
                document.getElementById("request-form")?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                background: selectedTier === tier.id
                  ? `rgba(${tier.highlight ? "192,38,211" : "124,58,237"},0.18)`
                  : "rgba(255,255,255,0.04)",
                border: selectedTier === tier.id
                  ? `2px solid ${tier.color}`
                  : tier.highlight
                    ? `2px solid rgba(192,38,211,0.4)`
                    : "2px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                padding: "28px 24px",
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.2s",
                position: "relative",
              }}
            >
              {tier.highlight && (
                <div
                  style={{
                    position: "absolute",
                    top: -11,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "linear-gradient(90deg, #c026d3, #7c3aed)",
                    borderRadius: 20,
                    padding: "3px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "white",
                    whiteSpace: "nowrap",
                  }}
                >
                  Most Popular
                </div>
              )}
              <div style={{ marginBottom: 4, fontSize: 13, color: tier.color, fontWeight: 600 }}>
                {tier.name}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#f0eeff", marginBottom: 2 }}>
                {tier.price}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
                {tier.unit}
              </div>
              <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 16 }}>
                {tier.tagline}
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {tier.features.map(f => (
                  <li
                    key={f}
                    style={{
                      fontSize: 13,
                      color: "#d1d5db",
                      paddingBottom: 6,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: tier.color, marginTop: 1, flexShrink: 0 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <div
                style={{
                  marginTop: 20,
                  padding: "8px 16px",
                  borderRadius: 8,
                  background: selectedTier === tier.id ? tier.color : "rgba(255,255,255,0.06)",
                  color: selectedTier === tier.id ? "white" : "#9ca3af",
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: "center",
                  transition: "all 0.2s",
                }}
              >
                {selectedTier === tier.id ? "Selected ✓" : tier.cta}
              </div>
            </button>
          ))}
        </div>

        {/* ── Request Access Form ─────────────────────────────────────────── */}
        <div
          id="request-form"
          style={{
            maxWidth: 520,
            margin: "0 auto",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: "32px 28px",
            textAlign: "left",
          }}
        >
          {submitted ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                Request received
              </h3>
              <p style={{ fontSize: 14, color: "#9ca3af" }}>
                We'll be in touch within 1 business day to discuss your audit.
              </p>
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
                Request Access
              </h2>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
                {selectedTier
                  ? `Selected: ${TIERS.find(t => t.id === selectedTier)?.name} — ${TIERS.find(t => t.id === selectedTier)?.price} ${TIERS.find(t => t.id === selectedTier)?.unit}`
                  : "Select a tier above, then fill in your details."}
              </p>
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <Label htmlFor="pr-name" style={{ fontSize: 13, color: "#d1d5db" }}>
                    Full name *
                  </Label>
                  <Input
                    id="pr-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    minLength={2}
                    placeholder="Dr. Jane Smith"
                    style={{ marginTop: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f0eeff" }}
                  />
                </div>
                <div>
                  <Label htmlFor="pr-email" style={{ fontSize: 13, color: "#d1d5db" }}>
                    Work email *
                  </Label>
                  <Input
                    id="pr-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="jane@biotech.com"
                    style={{ marginTop: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f0eeff" }}
                  />
                </div>
                <div>
                  <Label htmlFor="pr-org" style={{ fontSize: 13, color: "#d1d5db" }}>
                    Organisation *
                  </Label>
                  <Input
                    id="pr-org"
                    value={organisation}
                    onChange={e => setOrganisation(e.target.value)}
                    required
                    minLength={2}
                    placeholder="Acme Biotech Ltd"
                    style={{ marginTop: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f0eeff" }}
                  />
                </div>
                <div>
                  <Label htmlFor="pr-usecase" style={{ fontSize: 13, color: "#d1d5db" }}>
                    What do you need verified? (optional)
                  </Label>
                  <Textarea
                    id="pr-usecase"
                    value={useCase}
                    onChange={e => setUseCase(e.target.value)}
                    rows={3}
                    placeholder="e.g. Investor deck claims about our Phase II trial results, ~40 claims"
                    style={{ marginTop: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f0eeff", resize: "vertical" }}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={requestAccess.isPending || !selectedTier}
                  style={{
                    background: "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
                    border: "none",
                    color: "white",
                    fontWeight: 600,
                    padding: "10px 20px",
                    borderRadius: 8,
                    cursor: requestAccess.isPending || !selectedTier ? "not-allowed" : "pointer",
                    opacity: !selectedTier ? 0.5 : 1,
                  }}
                >
                  {requestAccess.isPending ? "Sending…" : "Send Request"}
                </Button>
              </form>
            </>
          )}
        </div>

        {/* ── Trust signals ───────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 64,
            paddingTop: 40,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 32,
          }}
        >
          {[
            { label: "Claims verified", value: "2,700+" },
            { label: "Primary databases", value: "12" },
            { label: "Avg. confidence score", value: "0.87" },
            { label: "Turnaround", value: "24–48 h" },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#c084fc" }}>{value}</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
