import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
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
import Graph from "@/pages/Graph";
import Verticals from "@/pages/Verticals";

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
      <Route path="/graph" component={Graph} />
      <Route path="/verticals" component={Verticals} />
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
