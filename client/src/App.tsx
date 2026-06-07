import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Submit from "./pages/Submit";
import Dashboard from "./pages/Dashboard";
import AuditReport from "./pages/AuditReport";
import MonitoringFeed from "./pages/MonitoringFeed";
import Pricing from "./pages/Pricing";
import Registry from "@/pages/Registry";
import PublicReport from "@/pages/PublicReport";
import Verticals from "@/pages/Verticals";
import WikiPage from "@/pages/WikiPage";
import Wiki from "@/pages/Wiki";
import WikiSlugPage from "@/pages/WikiSlugPage";
import ClaimPage from "@/pages/ClaimPage";
import Admin from "@/pages/Admin";
import PredictionCalibration from "@/pages/PredictionCalibration";
import AlertSettings from "@/pages/AlertSettings";
import NotificationSettings from "@/pages/NotificationSettings";
import Trust from "@/pages/Trust";
import ApiDocs from "@/pages/ApiDocs";
import CoordinatorDashboard from "@/pages/CoordinatorDashboard";
import VerticalDetail from "@/pages/VerticalDetail";
import ContradictionViewer from "@/pages/ContradictionViewer";
import AuditComparison from "@/pages/AuditComparison";
import Search from "@/pages/Search";
import EvidenceTimeline from "@/pages/EvidenceTimeline";
import AdminAnalytics from "@/pages/AdminAnalytics";
import VerticalLeaderboard from "@/pages/VerticalLeaderboard";
import WebhookDeliveryLog from "@/pages/WebhookDeliveryLog";
import ClaimProvenance from "@/pages/ClaimProvenance";
import ExportData from "@/pages/ExportData";
import CooccurrenceGraph from "@/pages/CooccurrenceGraph";
import ApiKeys from "@/pages/ApiKeys";
import Frontier from "@/pages/Frontier";
import SelfPromptDashboard from "@/pages/SelfPromptDashboard";
import InversePromptDashboard from "@/pages/InversePromptDashboard";
import AutonomousLoopDashboard from "@/pages/AutonomousLoopDashboard";
import OverridesDashboard from "@/pages/OverridesDashboard";
import DreamDashboard from "@/pages/DreamDashboard";
import SourceWhitelist from "@/pages/SourceWhitelist";
import CheckoutSuccess from "@/pages/CheckoutSuccess";

// Lazy-load the heavy graph page (react-force-graph-2d is ~300kb)
const Graph = lazy(() => import("@/pages/Graph"));

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/submit" component={Submit} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/audit/:id" component={AuditReport} />
      <Route path="/monitoring" component={MonitoringFeed} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/registry" component={Registry} />
      <Route path="/reports/:id" component={PublicReport} />
      <Route path="/graph">
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#888" }}>Loading graph...</div>}>
          <Graph />
        </Suspense>
      </Route>
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
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/compare" component={AuditComparison} />
      <Route path="/trust" component={Trust} />
      <Route path="/docs/api" component={ApiDocs} />
      <Route path="/404" component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
