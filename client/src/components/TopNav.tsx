import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
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

const NAV_LINKS = [
  { href: "/registry", label: "Registry", public: true },
  { href: "/graph", label: "Graph", public: true },
  { href: "/dashboard", label: "Dashboard", public: false },
  { href: "/monitoring", label: "Monitoring", public: false },
  { href: "/pricing", label: "Request Audit", public: true },
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
    <header className="sticky top-0 z-50 border-b border-border bg-white/90 backdrop-blur-sm">
      <div className="container flex h-14 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-900 to-blue-800 flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
            </svg>
          </div>
          <span className="font-semibold text-sm text-slate-900 tracking-tight">
            Protein Truth Desk
          </span>
        </Link>

        {/* Nav links — public links always visible, auth-only links gated */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.filter((l) => l.public || isAuthenticated).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                location === link.href || location.startsWith(link.href + "/")
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Auth */}
        <div className="flex items-center gap-2">
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full hover:bg-slate-100 p-1 pr-3 transition-colors">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-slate-200 text-slate-700 text-xs font-semibold">
                      {(user.name ?? user.email ?? "U").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium text-slate-700 hidden sm:block">
                    {user.name ?? user.email}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">Dashboard</Link>
                </DropdownMenuItem>
                {user.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin">Admin</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={() => logout.mutate()}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" asChild>
              <a href={getLoginUrl()}>Sign in</a>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
