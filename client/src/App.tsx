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
import ClaimPage from "@/pages/ClaimPage";
import Admin from "@/pages/Admin";
import PredictionCalibration from "@/pages/PredictionCalibration";
import AlertSettings from "@/pages/AlertSettings";
import Trust from "@/pages/Trust";
import ApiDocs from "@/pages/ApiDocs";
import CoordinatorDashboard from "@/pages/CoordinatorDashboard";

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
      <Route path="/wiki/:entityType/:entitySlug" component={WikiPage} />
      <Route path="/claim/:id" component={ClaimPage} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/predictions" component={PredictionCalibration} />
      <Route path="/admin/coordinator" component={CoordinatorDashboard} />
      <Route path="/settings/alerts" component={AlertSettings} />
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
