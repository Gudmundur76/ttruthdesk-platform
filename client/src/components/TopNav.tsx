/**
 * TopNav.tsx — Admin-only minimal header
 * ttruthdesk.claims is an internal tool. No public marketing links.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { openSignInDialog } from "@/const";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const ADMIN_NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/monitoring", label: "Monitoring" },
  { href: "/admin/corpus", label: "Corpus" },
  { href: "/admin/swarm", label: "Swarm" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/trust", label: "Trust" },
  { href: "/docs/api", label: "API" },
];

export function TopNav() {
  const { user, isAuthenticated } = useAuth();
  const [location] = useLocation();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: () => toast.error("Logout failed"),
  });

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: "rgba(13, 11, 18, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="container flex h-12 items-center justify-between">
        {/* Logo / wordmark */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 group"
          style={{ textDecoration: "none" }}
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
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
            >
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
            </svg>
          </div>
          <span
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              fontSize: 14,
              color: "#f0eeff",
            }}
          >
            Truth Desk{" "}
            <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>
              admin
            </span>
          </span>
        </Link>

        {/* Admin nav links — only shown when authenticated */}
        {isAuthenticated && (
          <nav className="hidden md:flex items-center gap-1">
            {ADMIN_NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm transition-colors",
                  location === href
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}

        {/* Auth controls */}
        <div className="flex items-center gap-2">
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full focus:outline-none">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs bg-purple-700 text-white">
                      {(user.name ?? user.email ?? "A").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">
                  {user.email ?? user.name}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  className="text-red-400 focus:text-red-400"
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              onClick={() => openSignInDialog()}
              className="px-3 py-1.5 rounded-md text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
