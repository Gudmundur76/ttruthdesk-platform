import { TopNav } from "@/components/TopNav";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

type Tier = "starter" | "diligence" | "platform";

const ACADEMIC_TIER = {
  name: "Academic",
  price: "Free",
  subtitle: "For universities & research institutes",
  features: [
    "Unlimited document audits",
    "Full PDB validation suite",
    "HTML audit reports",
    "Access to public claims registry",
    "Auto-detected by .edu / .ac.uk / .ac.nz and 80+ academic domains",
    "No credit card required",
  ],
};

const TIER_META: Record<Tier, { name: string; price: string; subtitle: string; features: string[]; highlight?: boolean }> = {
  starter: {
    name: "Starter",
    price: "$1,500",
    subtitle: "5 full-depth audits",
    features: [
      "5 document audits",
      "Up to 50 molecular claims per document",
      "Full PDB validation against RCSB",
      "HTML + PDF audit report",
      "Verdict summary with evidence links",
    ],
  },
  diligence: {
    name: "Diligence",
    price: "$5,000",
    subtitle: "25 audits — deep due diligence",
    features: [
      "25 document audits",
      "200+ claims across all documents",
      "Cross-document claim comparison",
      "Human expert review layer",
      "Priority 48-hour turnaround",
      "Monitoring feed for 30 days",
    ],
    highlight: true,
  },
  platform: {
    name: "Platform Pilot",
    price: "Custom",
    subtitle: "Enterprise integration",
    features: [
      "Unlimited documents",
      "API access for automated ingestion",
      "Continuous monitoring (PubMed, bioRxiv, patents)",
      "Custom claim type configuration",
      "Dedicated analyst support",
      "SLA-backed turnaround",
    ],
  },
};

export default function Pricing() {
  const { user, isAuthenticated } = useAuth();
  const [selectedTier, setSelectedTier] = useState<Tier>("diligence");
  const [form, setForm] = useState({
    contactName: "",
    contactEmail: "",
    organization: "",
    documentDescription: "",
    additionalNotes: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [paypalLoading, setPaypalLoading] = useState(false);

  const { data: subscription } = trpc.checkout.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const createOrderMutation = trpc.checkout.createOrder.useMutation();
  const submitMutation = trpc.auditRequests.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Request received — we'll be in touch within one business day.");
    },
    onError: (e) => toast.error(e.message),
  });

  const handlePayPalCheckout = async (tier: Tier) => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    setPaypalLoading(true);
    try {
      const origin = window.location.origin;
      const result = await createOrderMutation.mutateAsync({
        planTier: tier,
        returnUrl: `${origin}/checkout/success?tier=${tier}`,
        cancelUrl: `${origin}/pricing`,
      });
      window.open(result.approveUrl, "_blank");
      toast.info("PayPal checkout opened in a new tab. Complete payment there, then return here.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Checkout failed";
      if (msg.includes("credentials not configured")) {
        toast.error("PayPal is not yet configured. Please contact us to complete your purchase.");
      } else {
        toast.error(msg);
      }
    } finally {
      setPaypalLoading(false);
    }
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contactName || !form.contactEmail || !form.documentDescription) {
      toast.error("Please fill in all required fields.");
      return;
    }
    submitMutation.mutate({
      tier: "platform_pilot",
      contactName: form.contactName,
      contactEmail: form.contactEmail,
      organization: form.organization || undefined,
      documentDescription: form.documentDescription,
      additionalNotes: form.additionalNotes || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      {/* Hero */}
      <div className="border-b border-border bg-white">
        <div className="container py-16 max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full mb-4 uppercase tracking-wide">
            Audit Pricing
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
            Evidence-backed molecular audits
          </h1>
          <p className="text-slate-500 text-base max-w-xl mx-auto mb-6">
            Every claim in your biotech document validated against the RCSB Protein Data Bank and peer-reviewed literature.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-full">
              Free for universities
            </div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-4 py-2 rounded-full">
              Secure PayPal checkout
            </div>
          </div>
        </div>
      </div>

      <div className="container py-12 max-w-6xl">

        {/* Active subscription banner */}
        {subscription && (
          <div className="mb-8 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-4 flex items-center gap-4">
            <svg className="w-5 h-5 text-emerald-600 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
            <p className="text-sm text-emerald-800">
              <span className="font-semibold">Active {TIER_META[subscription.planTier]?.name ?? subscription.planTier} plan</span>
              {" — "}
              {subscription.remaining === -1
                ? "Unlimited audits remaining"
                : `${subscription.remaining} audit${subscription.remaining !== 1 ? "s" : ""} remaining`}
            </p>
          </div>
        )}

        {/* Academic tier banner */}
        <div className="mb-10 rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 p-6 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold text-emerald-700 uppercase tracking-wide">Academic Plan — Always Free</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">{ACADEMIC_TIER.name} · <span className="text-emerald-600">{ACADEMIC_TIER.price}</span></h2>
            <p className="text-sm text-slate-500 mb-3">{ACADEMIC_TIER.subtitle}</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {ACADEMIC_TIER.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                  <svg className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="shrink-0 text-center">
            <p className="text-xs text-slate-500 mb-2">Sign in with your university email</p>
            <Button
              variant="outline"
              className="border-emerald-400 text-emerald-700 hover:bg-emerald-50 font-semibold"
              onClick={() => toast.info("Click \"Sign in\" in the top navigation and enter your university email address.")}
            >
              Get academic access →
            </Button>
          </div>
        </div>

        {/* Commercial plan cards */}
        <h2 className="text-lg font-bold text-slate-900 mb-6">Commercial plans</h2>
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {(["starter", "diligence", "platform"] as Tier[]).map((tierId) => {
            const tier = TIER_META[tierId];
            const isSelected = selectedTier === tierId;
            const isPlatform = tierId === "platform";
            return (
              <div
                key={tierId}
                onClick={() => setSelectedTier(tierId)}
                className={`relative rounded-2xl border-2 p-6 cursor-pointer transition-all flex flex-col ${
                  tier.highlight
                    ? "border-slate-900 bg-slate-900 text-white shadow-xl"
                    : isSelected
                    ? "border-blue-600 bg-blue-50"
                    : "border-border bg-white hover:border-slate-300"
                }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                      Most Popular
                    </span>
                  </div>
                )}
                <div className="mb-4">
                  <h2 className={`text-lg font-bold mb-0.5 ${tier.highlight ? "text-white" : "text-slate-900"}`}>
                    {tier.name}
                  </h2>
                  <p className={`text-xs ${tier.highlight ? "text-slate-300" : "text-slate-500"}`}>{tier.subtitle}</p>
                </div>
                <div className={`text-3xl font-bold mb-5 ${tier.highlight ? "text-white" : "text-slate-900"}`}>
                  {tier.price}
                </div>
                <ul className="space-y-2.5 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <svg
                        className={`w-4 h-4 mt-0.5 shrink-0 ${tier.highlight ? "text-blue-400" : "text-green-600"}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                      <span className={tier.highlight ? "text-slate-200" : "text-slate-600"}>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA button */}
                {!isPlatform && (
                  <div className="mt-6">
                    <Button
                      className={`w-full font-semibold ${
                        tier.highlight
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-slate-900 hover:bg-slate-800 text-white"
                      }`}
                      disabled={paypalLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePayPalCheckout(tierId);
                      }}
                    >
                      {paypalLoading && selectedTier === tierId ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          Opening PayPal…
                        </span>
                      ) : (
                        <>Pay with PayPal →</>
                      )}
                    </Button>
                    <p className={`text-xs text-center mt-2 ${tier.highlight ? "text-slate-400" : "text-slate-400"}`}>
                      Secure checkout via PayPal
                    </p>
                  </div>
                )}
                {isPlatform && (
                  <div className="mt-6">
                    <Button
                      variant="outline"
                      className="w-full font-semibold border-slate-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        document.getElementById("platform-contact")?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      Contact us →
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Platform contact form */}
        <div id="platform-contact" className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
            {submitted ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">✅</div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Request received</h3>
                <p className="text-slate-500 text-sm max-w-sm mx-auto">
                  We'll review your submission and reach out within one business day.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-bold text-slate-900 mb-1">Platform Pilot — Request access</h2>
                  <p className="text-sm text-slate-500">Tell us about your use case and we'll follow up within one business day.</p>
                </div>
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Full name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={form.contactName}
                        onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Dr. Jane Smith"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={form.contactEmail}
                        onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="jane@example.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Organization</label>
                    <input
                      type="text"
                      value={form.organization}
                      onChange={(e) => setForm({ ...form, organization: e.target.value })}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="VC firm, biotech company, or research institution"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Use case description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={form.documentDescription}
                      onChange={(e) => setForm({ ...form, documentDescription: e.target.value })}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="Describe your use case, volume, and integration needs…"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold"
                    disabled={submitMutation.isPending}
                  >
                    {submitMutation.isPending ? "Sending…" : "Submit request →"}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
