import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

// ─── Critical path: loaded eagerly (tiny, needed for first paint) ─────────────
import Home from "./pages/Home";
import NotFound from "@/pages/NotFound";

// ─── Full-page spinner shown while any lazy chunk loads ───────────────────────
function PageLoader() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "#0d0b12", color: "#888", fontSize: 14,
    }}>
      Loading…
    </div>
  );
}

// ─── Lazy-loaded pages (each becomes its own async chunk) ─────────────────────
const Submit               = lazy(() => import("@/pages/Submit"));
const Dashboard            = lazy(() => import("@/pages/Dashboard"));
const AuditReport          = lazy(() => import("@/pages/AuditReport"));
const MonitoringFeed       = lazy(() => import("@/pages/MonitoringFeed"));
const Pricing              = lazy(() => import("@/pages/Pricing"));
const Registry             = lazy(() => import("@/pages/Registry"));
const PublicReport         = lazy(() => import("@/pages/PublicReport"));
const Graph                = lazy(() => import("@/pages/Graph"));
const Verticals            = lazy(() => import("@/pages/Verticals"));
const VerticalDetail       = lazy(() => import("@/pages/VerticalDetail"));
const ContradictionViewer  = lazy(() => import("@/pages/ContradictionViewer"));
const Wiki                 = lazy(() => import("@/pages/Wiki"));
const WikiSlugPage         = lazy(() => import("@/pages/WikiSlugPage"));
const WikiPage             = lazy(() => import("@/pages/WikiPage"));
const ClaimPage            = lazy(() => import("@/pages/ClaimPage"));
const ClaimProvenance      = lazy(() => import("@/pages/ClaimProvenance"));
const ExportData           = lazy(() => import("@/pages/ExportData"));
const CooccurrenceGraph    = lazy(() => import("@/pages/CooccurrenceGraph"));
const Admin                = lazy(() => import("@/pages/Admin"));
const PredictionCalibration= lazy(() => import("@/pages/PredictionCalibration"));
const CoordinatorDashboard = lazy(() => import("@/pages/CoordinatorDashboard"));
const AdminAnalytics       = lazy(() => import("@/pages/AdminAnalytics"));
const AlertSettings        = lazy(() => import("@/pages/AlertSettings"));
const NotificationSettings = lazy(() => import("@/pages/NotificationSettings"));
const ApiKeys              = lazy(() => import("@/pages/ApiKeys"));
const Search               = lazy(() => import("@/pages/Search"));
const EvidenceTimeline     = lazy(() => import("@/pages/EvidenceTimeline"));
const VerticalLeaderboard  = lazy(() => import("@/pages/VerticalLeaderboard"));
const WebhookDeliveryLog   = lazy(() => import("@/pages/WebhookDeliveryLog"));
const Frontier             = lazy(() => import("@/pages/Frontier"));
const SelfPromptDashboard  = lazy(() => import("@/pages/SelfPromptDashboard"));
const InversePromptDashboard = lazy(() => import("@/pages/InversePromptDashboard"));
const AutonomousLoopDashboard = lazy(() => import("@/pages/AutonomousLoopDashboard"));
const OverridesDashboard   = lazy(() => import("@/pages/OverridesDashboard"));
const DreamDashboard       = lazy(() => import("@/pages/DreamDashboard"));
const SourceWhitelist      = lazy(() => import("@/pages/SourceWhitelist"));
const CheckoutSuccess      = lazy(() => import("@/pages/CheckoutSuccess"));
const AdminCrons           = lazy(() => import("@/pages/AdminCrons"));
const AdminVerticals       = lazy(() => import("@/pages/AdminVerticals"));
const DeploymentDashboard  = lazy(() => import("@/pages/admin/DeploymentDashboard"));
const DiscoveryPanel       = lazy(() => import("@/pages/admin/DiscoveryPanel"));
const EmbedGenerator       = lazy(() => import("@/pages/admin/EmbedGenerator"));
const VerticalManagement   = lazy(() => import("@/pages/admin/VerticalManagement"));
const AuditComparison      = lazy(() => import("@/pages/AuditComparison"));
const Trust                = lazy(() => import("@/pages/Trust"));
const ApiDocs              = lazy(() => import("@/pages/ApiDocs"));
const SavedResearch        = lazy(() => import("@/pages/SavedResearch"));

// ─── CopilotKit: lazy-loaded so it never blocks first paint ──────────────────
const CopilotKitProvider = lazy(() =>
  import("@copilotkit/react-core").then((m) => ({ default: m.CopilotKit }))
);

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/submit" component={Submit} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/audit/:id" component={AuditReport} />
        <Route path="/monitoring" component={MonitoringFeed} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/registry" component={Registry} />
        <Route path="/reports/:id" component={PublicReport} />
        <Route path="/graph" component={Graph} />
        <Route path="/verticals" component={Verticals} />
        <Route path="/verticals/:domainKey" component={VerticalDetail} />
        <Route path="/contradictions/:relationId" component={ContradictionViewer} />
        <Route path="/wiki" component={Wiki} />
        <Route path="/wiki/:slug" component={WikiSlugPage} />
        <Route path="/wiki/:entityType/:entitySlug" component={WikiPage} />
        <Route path="/claim/:id" component={ClaimPage} />
        <Route path="/provenance/:claimId" component={ClaimProvenance} />
        <Route path="/export" component={ExportData} />
        <Route path="/cooccurrence" component={CooccurrenceGraph} />
        <Route path="/admin" component={Admin} />
        <Route path="/admin/predictions" component={PredictionCalibration} />
        <Route path="/admin/coordinator" component={CoordinatorDashboard} />
        <Route path="/admin/analytics" component={AdminAnalytics} />
        <Route path="/settings/alerts" component={AlertSettings} />
        <Route path="/settings/notifications" component={NotificationSettings} />
        <Route path="/settings/api-keys" component={ApiKeys} />
        <Route path="/search" component={Search} />
        <Route path="/timeline" component={EvidenceTimeline} />
        <Route path="/leaderboard" component={VerticalLeaderboard} />
        <Route path="/admin/webhooks" component={WebhookDeliveryLog} />
        <Route path="/admin/frontier" component={Frontier} />
        <Route path="/admin/self-prompt" component={SelfPromptDashboard} />
        <Route path="/admin/inverse-prompt" component={InversePromptDashboard} />
        <Route path="/admin/loop" component={AutonomousLoopDashboard} />
        <Route path="/admin/overrides" component={OverridesDashboard} />
        <Route path="/admin/dream" component={DreamDashboard} />
        <Route path="/admin/sources" component={SourceWhitelist} />
        <Route path="/admin/crons" component={AdminCrons} />
        <Route path="/admin/verticals" component={AdminVerticals} />
        <Route path="/admin/deployments" component={DeploymentDashboard} />
        <Route path="/admin/discovery" component={DiscoveryPanel} />
        <Route path="/admin/embed" component={EmbedGenerator} />
        <Route path="/admin/vertical-mgmt" component={VerticalManagement} />
        <Route path="/checkout/success" component={CheckoutSuccess} />
        <Route path="/compare" component={AuditComparison} />
        <Route path="/trust" component={Trust} />
        <Route path="/docs/api" component={ApiDocs} />
        <Route path="/saved-research" component={SavedResearch} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          {/* CopilotKit is lazy — never blocks first paint */}
          <Suspense fallback={null}>
            <CopilotKitProvider runtimeUrl="/api/copilot" credentials="include">
              <Router />
            </CopilotKitProvider>
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
