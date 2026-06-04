import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useState } from "react";
import { MagicLinkDialog } from "@/components/MagicLinkDialog";
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
  { href: "/search", label: "Search", public: true },
  { href: "/timeline", label: "Timeline", public: true },
  { href: "/leaderboard", label: "Leaderboard", public: true },
  { href: "/verticals", label: "Verticals", public: true },
  { href: "/registry", label: "Registry", public: true },
  { href: "/graph", label: "Graph", public: true },
  { href: "/trust", label: "Trust", public: true },
  { href: "/docs/api", label: "API", public: true },
  { href: "/dashboard", label: "Dashboard", public: false },
  { href: "/monitoring", label: "Monitoring", public: false },
  { href: "/pricing", label: "Request Audit", public: true },
];

export function TopNav() {
  const { user, isAuthenticated } = useAuth();
  const [location] = useLocation();
  const [showSignIn, setShowSignIn] = useState(false);
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
        background: "rgba(13, 11, 18, 0.72)",
        backdropFilter: "blur(18px) saturate(1.4)",
        WebkitBackdropFilter: "blur(18px) saturate(1.4)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 1px 0 0 rgba(255,255,255,0.04)",
      }}
    >
      <div className="container flex h-14 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group" style={{ textDecoration: "none" }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 14px rgba(192,38,211,0.45)",
              transition: "box-shadow 0.2s, transform 0.2s",
            }}
            className="group-hover:scale-105"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
            </svg>
          </div>
          <span
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              fontSize: 15,
              color: "#f0eeff",
              letterSpacing: "-0.01em",
            }}
          >
            Truth Desk
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-0.5">
          {NAV_LINKS.filter((l) => l.public || isAuthenticated).map((link) => {
            const isActive =
              location === link.href || location.startsWith(link.href + "/");
            const isAccent = link.href === "/pricing";
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "6px 13px",
                  borderRadius: 7,
                  fontSize: 13.5,
                  fontWeight: 500,
                  fontFamily: "'Inter', sans-serif",
                  textDecoration: "none",
                  transition: "background 0.15s, color 0.15s",
                  ...(isAccent
                    ? {
                        background: "linear-gradient(135deg, rgba(192,38,211,0.18) 0%, rgba(124,58,237,0.18) 100%)",
                        color: "#e879f9",
                        border: "1px solid rgba(192,38,211,0.25)",
                      }
                    : isActive
                    ? {
                        background: "rgba(255,255,255,0.08)",
                        color: "#f0eeff",
                      }
                    : {
                        background: "transparent",
                        color: "rgba(240,238,255,0.55)",
                      }),
                }}
                className={cn(!isAccent && !isActive && "hover:!text-[#f0eeff] hover:!bg-white/[0.06]")}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Auth */}
        <div className="flex items-center gap-2">
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 999,
                    padding: "4px 12px 4px 4px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  className="hover:!bg-white/10"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback
                      style={{
                        background: "linear-gradient(135deg, #c026d3, #7c3aed)",
                        color: "white",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {(user.name ?? user.email ?? "U").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "rgba(240,238,255,0.8)",
                      fontFamily: "'Inter', sans-serif",
                    }}
                    className="hidden sm:block"
                  >
                    {user.name ?? user.email}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48"
                style={{
                  background: "rgba(18,15,28,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  backdropFilter: "blur(20px)",
                }}
              >
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" style={{ color: "rgba(240,238,255,0.8)", textDecoration: "none" }}>
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                {user.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin" style={{ color: "rgba(240,238,255,0.8)", textDecoration: "none" }}>
                      Admin
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator style={{ background: "rgba(255,255,255,0.08)" }} />
                <DropdownMenuItem
                  style={{ color: "#f87171" }}
                  onClick={() => logout.mutate()}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <button
                onClick={() => setShowSignIn(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "7px 18px",
                  borderRadius: 8,
                  fontSize: 13.5,
                  fontWeight: 600,
                  fontFamily: "'Space Grotesk', sans-serif",
                  background: "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 0 18px rgba(192,38,211,0.35)",
                  transition: "box-shadow 0.2s, opacity 0.2s",
                  letterSpacing: "-0.01em",
                }}
                className="hover:opacity-90 hover:!shadow-[0_0_28px_rgba(192,38,211,0.55)]"
              >
                Sign in
              </button>
              <MagicLinkDialog open={showSignIn} onOpenChange={setShowSignIn} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
