"use client";

import { useUser } from "@clerk/nextjs";
import { useAuthStore } from "@/lib/auth-store";
import { Unauthorized } from "./unauthorized";
import { Loader2 } from "lucide-react";
import { RedirectToSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { isAuthorized, isLoading, authError, authStatus } = useAuthStore();
  const router = useRouter();

  // Rush candidates have their own portal.
  useEffect(() => {
    if (authStatus === "pnm") router.replace("/rush/portal");
  }, [authStatus, router]);

  // Show loading while Clerk loads (and while a PNM is being redirected)
  if (!clerkLoaded || isLoading || authStatus === "pnm") {
    return (
      <div className="min-h-screen min-w-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to sign in if not authenticated
  if (!isSignedIn) {
    return <RedirectToSignIn />;
  }

  // Pending approval, denied, or a setup failure.
  if (!isAuthorized) {
    return <Unauthorized message={authError} status={authStatus} />;
  }

  // User is authenticated and authorized
  return <>{children}</>;
}
