import { Shield, Database, FileCheck, Lock, Globe, AlertTriangle, CheckCircle, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const Section = ({ id, icon: Icon, title, children }: { id: string; icon: React.ElementType; title: string; children: React.ReactNode }) => (
  <section id={id} className="py-12 border-b border-border last:border-0">
    <div className="flex items-center gap-3 mb-6">
      <div className="p-2 rounded-lg bg-primary/10">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <h2 className="text-2xl font-bold text-foreground">{title}</h2>
    </div>
    {children}
  </section>
);

const DataSourceCard = ({ name, url, description, type }: { name: string; url: string; description: string; type: string }) => (
  <div className="border border-border rounded-lg p-4 hover:border-primary/50 transition-colors">
    <div className="flex items-start justify-between gap-2 mb-2">
      <h4 className="font-semibold text-foreground">{name}</h4>
      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">{type}</span>
    </div>
    <p className="text-sm text-muted-foreground mb-3">{description}</p>
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      API Documentation <ExternalLink className="w-3 h-3" />
    </a>
  </div>
);

const ComplianceItem = ({ status, label, detail }: { status: "compliant" | "partial" | "na"; label: string; detail: string }) => {
  const colors = {
    compliant: "text-green-500",
    partial: "text-amber-500",
    na: "text-muted-foreground",
  };
  const icons = {
    compliant: <CheckCircle className="w-4 h-4 text-green-500" />,
    partial: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    na: <CheckCircle className="w-4 h-4 text-muted-foreground" />,
  };
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className="mt-0.5">{icons[status]}</div>
      <div>
        <p className={`font-medium text-sm ${colors[status]}`}>{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
      </div>
    </div>
  );
};

const Accordion = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="font-medium text-foreground">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="p-4 pt-0 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
};

export default function Trust() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Link href="/" className="hover:text-foreground transition-colors">Truth Desk</Link>
            <span>/</span>
            <span>Trust & Transparency</span>
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-4">Trust & Transparency</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Every claim Truth Desk verifies is grounded in authoritative, open-access scientific databases — never scraped from publisher websites, never hallucinated from training data. This page documents exactly how we work.
          </p>
          <div className="flex flex-wrap gap-3 mt-6">
            <a href="#methodology" className="text-sm px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:text-primary transition-colors">Methodology</a>
            <a href="#data-sources" className="text-sm px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:text-primary transition-colors">Data Sources</a>
            <a href="#no-scraping" className="text-sm px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:text-primary transition-colors">No Scraping</a>
            <a href="#privacy" className="text-sm px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:text-primary transition-colors">Privacy</a>
            <a href="#eu-ai-act" className="text-sm px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:text-primary transition-colors">EU AI Act</a>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Methodology */}
        <Section id="methodology" icon={FileCheck} title="Verification Methodology">
          <p className="text-muted-foreground mb-6">
            Truth Desk uses a multi-stage pipeline to verify scientific claims. Unlike general-purpose AI search engines that synthesise web content and attach URLs as citations, Truth Desk extracts structured claims and validates each one against authoritative primary databases.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-0 mb-8">
            {[
              { step: "1", label: "Extract", desc: "LLM identifies discrete scientific claims from the document text, each with a claim type (structural, quantitative, methodological, organism)" },
              { step: "2", label: "Validate", desc: "Each claim is routed to the right authoritative source: RCSB PDB, UniProt, PubChem, ClinicalTrials.gov, Europe PMC, OpenFDA, USDA FoodData Central, NCBI Taxonomy, and more. No web scraping." },
              { step: "3", label: "Score", desc: "A confidence score (0–1 float) and confidence flags are assigned per claim based on evidence quality, source count, and method reliability." },
              { step: "4", label: "Report", desc: "A structured audit report is generated with every claim, its verdict, evidence links, rationale, and a machine-readable claims.json." },
            ].map((item, i) => (
              <div key={i} className="relative">
                <div className="border border-border rounded-lg p-4 h-full bg-card/30">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center mb-3">{item.step}</div>
                  <h4 className="font-semibold text-foreground mb-2">{item.label}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
                {i < 3 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 w-6 h-px bg-border z-10" />
                )}
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <Accordion title="How are verdict categories assigned?">
              <p className="mb-2">Truth Desk assigns one of seven verdicts to each claim:</p>
              <ul className="space-y-1.5 ml-4">
                <li><strong className="text-foreground">Supported</strong> — Direct evidence found in a primary database entry (e.g., PDB structure matches claimed resolution, ClinicalTrials.gov confirms RCT count, PubChem confirms compound identity).</li>
                <li><strong className="text-foreground">Contradicted</strong> — Primary database evidence directly contradicts the claim.</li>
                <li><strong className="text-foreground">Partially Supported</strong> — Some evidence supports the claim but key details differ.</li>
                <li><strong className="text-foreground">Ambiguous</strong> — Evidence exists but is inconclusive or conflicting across sources.</li>
                <li><strong className="text-foreground">Insufficient Evidence</strong> — No relevant primary database entry found.</li>
                <li><strong className="text-foreground">Out of Scope</strong> — Claim type is outside the current vertical's validation capability.</li>
                <li><strong className="text-foreground">Needs Expert Review</strong> — Claim requires domain expert judgment beyond automated validation.</li>
              </ul>
            </Accordion>
            <Accordion title="What is the confidence score?">
              <p>The confidence score (0.0–1.0) reflects the quality and completeness of the evidence found. It is computed from: number of corroborating sources, specificity of the database match (exact PDB ID or NCT number vs. keyword match), source authority weight (Swiss-Prot reviewed entry vs. unreviewed), and whether a human reviewer has confirmed the verdict. A score above 0.8 indicates strong primary database support.</p>
            </Accordion>
            <Accordion title="Can humans override automated verdicts?">
              <p>Yes. Every claim has a human review workflow. Domain experts can override the automated verdict, correct entity mappings, add notes, and mark the claim as reviewed. Overrides are logged with a timestamp and reviewer ID. The audit trail is preserved and visible in the report.</p>
            </Accordion>
          </div>
        </Section>

        {/* Data Sources */}
        <Section id="data-sources" icon={Database} title="Data Sources">
          <p className="text-muted-foreground mb-6">
            Truth Desk sources all evidence from official, open-access scientific APIs. We never scrape publisher websites, bypass paywalls, or access content without permission. Every data source below has a publicly documented API that we use within its stated terms of service.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <DataSourceCard
              name="RCSB Protein Data Bank"
              url="https://data.rcsb.org/"
              description="Primary source for structural biology claim validation. Used for resolution, method, organism, entity, and ligand verification. All structural biology claims are validated against PDB entries."
              type="Structural Biology"
            />
            <DataSourceCard
              name="PubMed E-utilities"
              url="https://www.ncbi.nlm.nih.gov/books/NBK25501/"
              description="NCBI's official API for PubMed literature search and abstract retrieval. Used for paper ingestion, PMID lookup, and evidence cross-referencing."
              type="Literature"
            />
            <DataSourceCard
              name="Europe PMC REST API"
              url="https://europepmc.org/RestfulWebService"
              description="Full-text retrieval for open-access papers via PMC. Used as fallback when PubMed abstract is insufficient and full Methods/Results sections are needed."
              type="Full-Text"
            />
            <DataSourceCard
              name="PubChem REST API"
              url="https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest"
              description="NCBI's chemical compound database. Used for compound identity verification across chemistry and nutrition verticals — CID lookup, synonyms, and molecular properties."
              type="Chemistry"
            />
            <DataSourceCard
              name="bioRxiv / medRxiv API"
              url="https://api.biorxiv.org/"
              description="Preprint server API for early-access research. Used in the discovery loop to ingest recent preprints before formal peer review."
              type="Preprints"
            />
            <DataSourceCard
              name="UniProt REST API"
              url="https://www.uniprot.org/help/api"
              description="Protein sequence and function database. Used for protein identity verification across structural biology and nutrition verticals. Swiss-Prot reviewed entries carry higher confidence weight."
              type="Protein Function"
            />
            <DataSourceCard
              name="ClinicalTrials.gov API"
              url="https://clinicaltrials.gov/data-api/api"
              description="US National Library of Medicine's registry of clinical trials. Used to verify RCT counts, study designs, and registered outcomes for nutrition and sports science claims."
              type="Clinical Trials"
            />
            <DataSourceCard
              name="OpenFDA API"
              url="https://open.fda.gov/apis/"
              description="FDA adverse event reporting system (FAERS). Used to surface safety signals for supplement and compound claims — high event counts lower confidence on safety claims."
              type="Pharmacovigilance"
            />
            <DataSourceCard
              name="USDA FoodData Central"
              url="https://fdc.nal.usda.gov/api-guide.html"
              description="USDA's nutritional composition database. Used to verify macronutrient, amino acid, and micronutrient content claims for food and supplement verticals."
              type="Nutrition"
            />
            <DataSourceCard
              name="NCBI Taxonomy API"
              url="https://www.ncbi.nlm.nih.gov/books/NBK25500/"
              description="NCBI's biological taxonomy database. Used for genus-level microbial strain validation in the gut microbiome vertical."
              type="Taxonomy"
            />
          </div>
          <div className="bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">Rate limits respected:</strong> All API calls are made within the documented rate limits of each service. Truth Desk does not use scraping, headless browsers, or any technique to bypass access controls. API keys are used where required, and all usage complies with each service's terms of use.
          </div>
        </Section>

        {/* No Scraping Manifesto */}
        <Section id="no-scraping" icon={Shield} title="The No-Scraping Manifesto">
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 mb-6">
            <p className="text-foreground font-medium text-lg mb-2">Truth Desk does not scrape the web.</p>
            <p className="text-muted-foreground">
              This is not a policy decision — it is an architectural one. Truth Desk is built to validate scientific claims against primary databases, not to index the web. The data sources listed above are all we need, and all of them provide official APIs.
            </p>
          </div>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Practice</th>
                  <th className="text-center py-3 px-4 text-muted-foreground font-medium">General AI Search</th>
                  <th className="text-center py-3 px-4 text-muted-foreground font-medium">Truth Desk</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Scrapes publisher websites", "Yes (bypasses robots.txt)", "Never"],
                  ["Accesses paywalled content", "Yes (stealth crawlers)", "Never"],
                  ["Uses official APIs only", "No", "Always"],
                  ["Respects rate limits", "Often violated", "Always"],
                  ["Reproduces copyrighted text", "Yes (in answers)", "No (links to source)"],
                  ["Legal exposure", "13+ active lawsuits", "None — API-only access"],
                  ["EU AI Act compliance", "Unconfirmed", "Compliant (see below)"],
                ].map(([practice, general, td], i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/20">
                    <td className="py-3 px-4 text-foreground">{practice}</td>
                    <td className="py-3 px-4 text-center text-red-400 text-xs">{general}</td>
                    <td className="py-3 px-4 text-center text-green-400 text-xs font-medium">{td}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-muted-foreground text-sm">
            When a general-purpose AI search engine attaches a publisher URL to an answer, it has typically already scraped that page — often without permission, often bypassing access controls. Truth Desk never visits publisher websites. Our evidence trail goes directly from claim to database entry (PDB ID, PubMed PMID, PubChem CID) — not through a web scrape.
          </p>
        </Section>

        {/* Privacy */}
        <Section id="privacy" icon={Lock} title="Privacy by Architecture">
          <p className="text-muted-foreground mb-6">
            Truth Desk does not collect browsing history, does not track user behaviour across sessions, and does not share data with advertising platforms. This is not a privacy policy commitment — it is the architectural consequence of being a vertical verification tool rather than a surveillance browser.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {[
              { title: "No browser product", desc: "Truth Desk is a document verification platform. We do not ship a browser, browser extension, or any client-side tracking code beyond standard session management." },
              { title: "No ad platform integration", desc: "We do not integrate with Google Ads, Meta Pixel, or any advertising platform. No user data is shared with third-party ad networks." },
              { title: "Email-only authentication", desc: "Authentication uses magic links sent to your email. No phone number required. No SMS verification. No SIM-swap risk." },
              { title: "Document data", desc: "Documents you submit are processed to extract and verify claims. Processed results (claims, verdicts, reports) are stored and may be made public if you choose to publish them. Raw document text is stored for audit purposes." },
              { title: "API-only data access", desc: "All external data fetching uses official APIs. No user browsing data is collected as a side effect of our data sourcing." },
              { title: "Session cookies only", desc: "We use a single signed session cookie for authentication. No tracking cookies, no third-party cookies, no fingerprinting." },
            ].map((item, i) => (
              <div key={i} className="border border-border rounded-lg p-4">
                <h4 className="font-semibold text-foreground mb-1 text-sm">{item.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* EU AI Act */}
        <Section id="eu-ai-act" icon={Globe} title="EU AI Act Compliance Statement">
          <p className="text-muted-foreground mb-2">
            The EU AI Act applies from August 2026. Truth Desk is designed with compliance in mind. This statement documents our current position against the key requirements.
          </p>
          <p className="text-xs text-muted-foreground mb-6 italic">Last reviewed: June 2026. This statement will be updated as the regulatory landscape evolves.</p>

          <div className="border border-border rounded-lg overflow-hidden mb-6">
            <div className="bg-muted/30 px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground text-sm">Risk Classification</h3>
            </div>
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="px-2 py-1 rounded bg-amber-500/10 text-amber-500 text-xs font-bold shrink-0 mt-0.5">LIMITED RISK</div>
                <p className="text-sm text-muted-foreground">
                  Truth Desk is classified as a <strong className="text-foreground">Limited Risk AI system</strong> under the EU AI Act. It is not used for biometric identification, critical infrastructure, employment decisions, or any high-risk application listed in Annex III. It is a scientific claim verification tool used by researchers and due diligence professionals.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-0 border border-border rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground text-sm">Compliance Checklist</h3>
            </div>
            <div className="p-4">
              <ComplianceItem status="compliant" label="Transparency obligation (Art. 52)" detail="Users are clearly informed they are interacting with an AI system. Every audit report shows the LLM provider, quality tier, and processing timestamp." />
              <ComplianceItem status="compliant" label="Human oversight" detail="Every claim has a human review workflow. Domain experts can override automated verdicts. The system is designed to assist, not replace, expert judgment." />
              <ComplianceItem status="compliant" label="Data quality and provenance" detail="All training and validation data comes from official open-access APIs. Data sources are documented on this page. No unlicensed data is used." />
              <ComplianceItem status="compliant" label="No prohibited practices (Art. 5)" detail="Truth Desk does not use subliminal manipulation, exploit vulnerabilities, perform social scoring, or conduct real-time biometric surveillance." />
              <ComplianceItem status="compliant" label="Accuracy and robustness" detail="Confidence scores and confidence flags are provided per claim. Uncertainty is surfaced explicitly rather than hidden. The system acknowledges when evidence is insufficient." />
              <ComplianceItem status="partial" label="Technical documentation (Art. 11)" detail="Internal technical documentation exists. Formal EU AI Act-compliant documentation package is in preparation for August 2026." />
              <ComplianceItem status="partial" label="Conformity assessment" detail="Self-assessment completed. Third-party conformity assessment not yet initiated (required only for high-risk systems; Truth Desk is limited risk)." />
            </div>
          </div>

          <div className="mt-6 bg-muted/30 rounded-lg p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">Questions about compliance?</strong> Contact us at{" "}
            <a href="mailto:trust@truthdesk.io" className="text-primary hover:underline">trust@truthdesk.io</a>. We are committed to transparency and will respond to compliance enquiries within 5 business days.
          </div>
        </Section>

        {/* Footer nav */}
        <div className="py-8 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">← Back to Truth Desk</Link>
          <Link href="/docs/api" className="hover:text-foreground transition-colors">API Documentation →</Link>
          <Link href="/registry" className="hover:text-foreground transition-colors">Public Claims Registry →</Link>
        </div>
      </div>
    </div>
  );
}
