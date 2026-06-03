import { TopNav } from "@/components/TopNav";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Tier = "starter" | "diligence" | "platform_pilot";

// Academic tier is shown separately (not selectable for paid flow)
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

const TIERS: {
  id: Tier;
  name: string;
  price: string;
  subtitle: string;
  features: string[];
  highlight?: boolean;
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$1,500",
    subtitle: "Single document audit",
    features: [
      "Up to 50 molecular claims extracted",
      "Full PDB validation against RCSB",
      "HTML + PDF audit report",
      "Verdict summary with evidence links",
      "3-day turnaround",
    ],
  },
  {
    id: "diligence",
    name: "Diligence",
    price: "$5,000",
    subtitle: "Deep due diligence package",
    features: [
      "Up to 5 documents per engagement",
      "200+ claims across all documents",
      "Cross-document claim comparison",
      "Human expert review layer",
      "Priority 48-hour turnaround",
      "Monitoring feed for 30 days",
    ],
    highlight: true,
  },
  {
    id: "platform_pilot",
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
];

export default function Pricing() {
  const [selectedTier, setSelectedTier] = useState<Tier>("diligence");
  const [form, setForm] = useState({
    contactName: "",
    contactEmail: "",
    organization: "",
    documentDescription: "",
    additionalNotes: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = trpc.auditRequests.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Request received — we'll be in touch within one business day.");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contactName || !form.contactEmail || !form.documentDescription) {
      toast.error("Please fill in all required fields.");
      return;
    }
    submitMutation.mutate({
      tier: selectedTier,
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
            Every claim in your biotech document validated against the RCSB Protein Data Bank and peer-reviewed literature. Trusted by due diligence professionals and scientific investors.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-full">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z"/></svg>
              Free for universities
            </div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-4 py-2 rounded-full">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              30-day free trial for everyone else
            </div>
          </div>
        </div>
      </div>

      {/* Pricing cards */}
      <div className="container py-12 max-w-6xl">
        {/* Academic tier banner */}
        <div className="mb-10 rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 p-6 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z"/></svg>
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

        {/* Free trial callout */}
        <div className="mb-8 rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 flex items-center gap-4">
          <svg className="w-5 h-5 text-violet-500 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
          <p className="text-sm text-violet-800">
            <span className="font-semibold">30-day free trial included</span> — every new account gets 3 free audits over 30 days. No credit card required. Sign in above to start.
          </p>
        </div>

        <h2 className="text-lg font-bold text-slate-900 mb-6">Commercial plans</h2>
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              onClick={() => setSelectedTier(tier.id)}
              className={`relative rounded-2xl border-2 p-6 cursor-pointer transition-all ${
                tier.highlight
                  ? "border-slate-900 bg-slate-900 text-white shadow-xl"
                  : selectedTier === tier.id
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
              <ul className="space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <svg
                      className={`w-4 h-4 mt-0.5 shrink-0 ${tier.highlight ? "text-blue-400" : "text-green-600"}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className={tier.highlight ? "text-slate-200" : "text-slate-600"}>{f}</span>
                  </li>
                ))}
              </ul>
              {selectedTier === tier.id && !tier.highlight && (
                <div className="mt-4 text-xs font-semibold text-blue-700">Selected ✓</div>
              )}
            </div>
          ))}
        </div>

        {/* Contact form */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
            {submitted ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">✅</div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Request received</h3>
                <p className="text-slate-500 text-sm max-w-sm mx-auto">
                  We'll review your submission and reach out within one business day to discuss your audit requirements.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-bold text-slate-900 mb-1">Request an audit</h2>
                  <p className="text-sm text-slate-500">
                    Selected tier: <span className="font-semibold text-slate-700">{TIERS.find((t) => t.id === selectedTier)?.name} — {TIERS.find((t) => t.id === selectedTier)?.price}</span>
                  </p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Organization
                    </label>
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
                      Document description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={form.documentDescription}
                      onChange={(e) => setForm({ ...form, documentDescription: e.target.value })}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="Describe the document(s) you need audited — e.g., 'A biotech company's investor deck claiming novel protein-ligand binding data for a cancer target, citing PDB structures 1ABC and 2DEF…'"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Additional notes
                    </label>
                    <textarea
                      rows={2}
                      value={form.additionalNotes}
                      onChange={(e) => setForm({ ...form, additionalNotes: e.target.value })}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="Timeline requirements, specific concerns, or questions…"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-slate-900 hover:bg-slate-700 text-white"
                    disabled={submitMutation.isPending}
                  >
                    {submitMutation.isPending ? "Submitting…" : "Submit audit request"}
                  </Button>
                  <p className="text-xs text-center text-slate-400">
                    We respond within one business day. No commitment required.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
