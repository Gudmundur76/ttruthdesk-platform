import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TopNav } from "@/components/TopNav";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

export default function Submit() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [fileText, setFileText] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submitText = trpc.documents.submitText.useMutation({
    onSuccess: (data) => {
      toast.success("Document submitted — analysis running");
      navigate(`/audit/${data.documentId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  // ── PubMed fetch state ───────────────────────────────────────────────────────────────────
  const [pmQuery, setPmQuery] = useState("");
  const [pmFetched, setPmFetched] = useState<{ title: string; text: string; citation: string } | null>(null);

  const fetchPubmed = trpc.documents.fetchFromPubmed.useMutation({
    onSuccess: (data) => {
      setPmFetched(data);
      toast.success("Paper fetched — review and submit below");
    },
    onError: (err) => toast.error(err.message),
  });

  const submitPubmed = trpc.documents.submitText.useMutation({
    onSuccess: (data) => {
      toast.success("Document submitted — analysis running");
      navigate(`/audit/${data.documentId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handlePubmedFetch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!pmQuery.trim()) return;
      setPmFetched(null);
      fetchPubmed.mutate({ query: pmQuery.trim() });
    },
    [pmQuery, fetchPubmed]
  );

  const handlePubmedSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!pmFetched) return;
      submitPubmed.mutate({ title: pmFetched.title, text: pmFetched.text });
    },
    [pmFetched, submitPubmed]
  );

  const uploadDoc = trpc.storage.uploadDocument.useMutation();
  const submitFile = trpc.documents.submitFile.useMutation({
    onSuccess: (data) => {
      toast.success("Document submitted — analysis running");
      navigate(`/audit/${data.documentId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      setFileBase64(base64);
      // Extract text from file
      if (file.type === "text/plain") {
        try {
          const txt = atob(base64);
          setFileText(txt);
        } catch {
          // Malformed base64 — fall back to server-side extraction
          setFileText(`[File: ${file.name} — text will be extracted server-side]`);
        }
      } else {
        // For PDFs and other types, use raw base64 text extraction hint
        setFileText(`[File: ${file.name} — text will be extracted server-side]`);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    submitText.mutate({ title: title.trim(), text: text.trim() });
  };

  const handleFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !fileBase64) return;
    setUploading(true);
    try {
      const { key, url } = await uploadDoc.mutateAsync({
        fileName,
        contentType: "application/octet-stream",
        base64Content: fileBase64,
      });
      await submitFile.mutateAsync({
        title: title.trim(),
        fileName,
        storageKey: key,
        storageUrl: url,
        rawText: fileText || `[Uploaded file: ${fileName}]`,
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading) return null;
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <TopNav />
        <div className="container py-24 text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Sign in to submit documents</h2>
          <p className="text-slate-500 mb-6">Create a free account to start auditing molecular claims.</p>
          <Button asChild>
            <a href={getLoginUrl()}>Sign in →</a>
          </Button>
        </div>
      </div>
    );
  }

  const isSubmitting = submitText.isPending || submitFile.isPending || uploading;

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container py-12 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Submit Document for Audit</h1>
          <p className="text-slate-500 text-sm">
            Upload or paste your biotech document. We'll extract and verify all molecular claims against the Protein Data Bank.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
          <div className="mb-5">
            <Label htmlFor="title" className="text-sm font-medium text-slate-700">
              Document title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="title"
              className="mt-1.5"
              placeholder="e.g. Series A Pitch Deck — ProteinCo"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <Tabs defaultValue="pubmed">
            <TabsList className="mb-5 w-full">
              <TabsTrigger value="pubmed" className="flex-1">PubMed / DOI</TabsTrigger>
              <TabsTrigger value="paste" className="flex-1">Paste Text</TabsTrigger>
              <TabsTrigger value="upload" className="flex-1">Upload File</TabsTrigger>
            </TabsList>

            {/* ── PubMed / DOI tab ─────────────────────────────────────────────────────────────────── */}
            <TabsContent value="pubmed">
              <form onSubmit={handlePubmedFetch} className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-slate-700">PubMed ID, DOI, or PubMed URL</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      value={pmQuery}
                      onChange={(e) => { setPmQuery(e.target.value); setPmFetched(null); }}
                      placeholder="e.g. 37234567 · 10.1038/s41586-023-06415-8 · pubmed.ncbi.nlm.nih.gov/37234567"
                      className="flex-1 font-mono text-sm"
                    />
                    <Button
                      type="submit"
                      disabled={!pmQuery.trim() || fetchPubmed.isPending}
                      variant="outline"
                      className="shrink-0"
                    >
                      {fetchPubmed.isPending ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Fetching…
                        </span>
                      ) : "Fetch Paper"}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">Fetches the abstract and methods section from PubMed or Europe PMC. Open-access papers only.</p>
                </div>
              </form>

              {pmFetched && (
                <form onSubmit={handlePubmedSubmit} className="mt-5 space-y-4">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Paper retrieved</p>
                    <p className="text-sm font-semibold text-slate-900 leading-snug mb-1">{pmFetched.title}</p>
                    {pmFetched.citation && (
                      <p className="text-xs text-slate-500 font-mono">{pmFetched.citation}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Document title (editable)</Label>
                    <Input
                      value={pmFetched.title}
                      onChange={(e) => setPmFetched({ ...pmFetched, title: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Fetched text (editable)</Label>
                    <Textarea
                      value={pmFetched.text}
                      onChange={(e) => setPmFetched({ ...pmFetched, text: e.target.value })}
                      rows={10}
                      className="mt-1.5 font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={submitPubmed.isPending}
                    className="w-full bg-slate-900 hover:bg-slate-800"
                  >
                    {submitPubmed.isPending ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Submitting…
                      </span>
                    ) : "Submit for Analysis →"}
                  </Button>
                </form>
              )}
            </TabsContent>

            <TabsContent value="paste">
              <form onSubmit={handleTextSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="text" className="text-sm font-medium text-slate-700">
                    Document text <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="text"
                    className="mt-1.5 min-h-[220px] font-mono text-sm"
                    placeholder="Paste the full text of your biotech document here. Include any PDB IDs, protein names, experimental methods, resolution values, and organism information."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <p className="text-xs text-slate-400 mt-1.5">{text.length.toLocaleString()} characters</p>
                </div>
                <Button
                  type="submit"
                  disabled={!title.trim() || !text.trim() || isSubmitting}
                  className="w-full bg-slate-900 hover:bg-slate-800"
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Submitting…
                    </span>
                  ) : (
                    "Submit for Analysis →"
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="upload">
              <form onSubmit={handleFileSubmit} className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-slate-700">Document file</Label>
                  <div
                    className="mt-1.5 border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors"
                    onClick={() => fileRef.current?.click()}
                  >
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      accept=".txt,.pdf,.md,.doc,.docx"
                      onChange={handleFileChange}
                    />
                    {fileName ? (
                      <div>
                        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mx-auto mb-2">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e40af" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-slate-700">{fileName}</p>
                        <p className="text-xs text-slate-400 mt-1">Click to change file</p>
                      </div>
                    ) : (
                      <div>
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-2">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-slate-600">Click to upload</p>
                        <p className="text-xs text-slate-400 mt-1">TXT, PDF, MD, DOC, DOCX</p>
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={!title.trim() || !fileBase64 || isSubmitting}
                  className="w-full bg-slate-900 hover:bg-slate-800"
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Uploading…
                    </span>
                  ) : (
                    "Upload & Analyse →"
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        {/* Info box */}
        <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold text-blue-700 mb-1">What happens next</p>
          <ol className="text-xs text-blue-600 space-y-1 list-decimal list-inside">
            <li>LLM extracts all verifiable molecular claims from your document</li>
            <li>Each claim is checked against the RCSB Protein Data Bank APIs</li>
            <li>A scoped verdict is assigned with rationale and evidence links</li>
            <li>An HTML + PDF audit report is generated and stored securely</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
