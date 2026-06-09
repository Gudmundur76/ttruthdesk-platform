import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  FileText,
  Upload,
  Activity,
  TrendingUp,
  Bell,
  Zap,
  BarChart3,
  ArrowLeftRight,
  Webhook,
  GitBranch,
  Download,
  Network,
  Key,
  Moon,
  Database,
  ShieldCheck,
  Telescope,
  RefreshCw,
  Search,
  Rocket,
  Radar,
  Code2,
  Layers,
  BookMarked,
  Terminal,
} from "lucide-react";
import {
  CSSProperties,
  Suspense,
  useEffect,
  useRef,
  useState,
  lazy,
} from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

// CopilotKit: lazy-loaded to prevent 3.5MB chunk from blocking first paint
const CopilotSidebar = lazy(() =>
  import("@copilotkit/react-ui").then(m => ({ default: m.CopilotSidebar }))
);
const CopilotRenderers = lazy(() => import("@/components/CopilotRenderers"));
const ExampleQueryCarousel = lazy(() =>
  import("@/components/ExampleQueryCarousel").then(m => ({
    default: m.ExampleQueryCarousel,
  }))
);

const menuItems = [
  { icon: LayoutDashboard, label: "My Audits", path: "/dashboard" },
  { icon: Upload, label: "New Audit", path: "/submit" },
  { icon: Search, label: "Semantic Search", path: "/search" },
  { icon: BookMarked, label: "Saved Research", path: "/saved-research" },
  { icon: Activity, label: "Monitoring", path: "/monitoring" },
  { icon: FileText, label: "Registry", path: "/registry" },
  { icon: TrendingUp, label: "Predictions", path: "/admin/predictions" },
  { icon: Bell, label: "Alert Webhooks", path: "/settings/alerts" },
  { icon: Bell, label: "Notifications", path: "/settings/notifications" },
  { icon: Zap, label: "Coordinator", path: "/admin/coordinator" },
  { icon: BarChart3, label: "Analytics", path: "/admin/analytics" },
  { icon: Webhook, label: "Webhook Log", path: "/admin/webhooks" },
  { icon: ArrowLeftRight, label: "Compare Audits", path: "/compare" },
  { icon: GitBranch, label: "Provenance", path: "/provenance/1" },
  { icon: Download, label: "Export Data", path: "/export" },
  { icon: Network, label: "Co-occurrence", path: "/cooccurrence" },
  { icon: Key, label: "API Keys", path: "/settings/api-keys" },
  { icon: Telescope, label: "Frontier Engine", path: "/admin/frontier" },
  { icon: RefreshCw, label: "Autonomous Loop", path: "/admin/loop" },
  { icon: Moon, label: "Dream State", path: "/admin/dream" },
  { icon: ShieldCheck, label: "Override Audit", path: "/admin/overrides" },
  { icon: Database, label: "Source Whitelist", path: "/admin/sources" },
  { icon: Rocket, label: "Deployments", path: "/admin/deployments" },
  { icon: Radar, label: "Auto-Discovery", path: "/admin/discovery" },
  { icon: Code2, label: "Embed Generator", path: "/admin/embed" },
  { icon: Layers, label: "Vertical Mgmt", path: "/admin/vertical-mgmt" },
  { icon: Terminal, label: "Harness", path: "/admin/harness" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to
              launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate">
                    Navigation
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>

      {/* CopilotKit: lazy-loaded — no Suspense fallback needed (these are invisible/overlay components) */}
      <Suspense fallback={null}>
        <CopilotRenderers />
        <ExampleQueryCarousel />
        {/* CopilotKit: AI assistant sidebar */}
        <CopilotSidebar
          instructions="You are the Truth Desk AI — a scientific evidence engine. For ANY question, call translateAndSearch first to decompose it into verifiable claims and search PubMed. Never say 'out of scope' or 'no molecular claims found'. Always return cited evidence with PMIDs. Everyday questions like 'can I make biotech products from salmon sludge?' are valid — translate them into claims and search the evidence."
          defaultOpen={false}
          labels={{
            title: "Truth Desk AI",
            initial:
              'Ask me anything about biotech, proteins, or scientific claims — in plain language. I\'ll search peer-reviewed literature and return cited evidence. Try: "can I create biotech products from salmon sludge?" or "does astaxanthin reduce inflammation?"',
          }}
        />
      </Suspense>
    </>
  );
}
