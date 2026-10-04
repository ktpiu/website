"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, errorMessage, rushFetch } from "@/lib/rush/client";

type SetupInfo = { name: string; email: string; hasAccount: boolean };

function SetupForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isSignedIn, signOut } = useAuth();
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("This setup link is missing its token.");
      return;
    }
    rushFetch<SetupInfo>(`/api/rush/account/setup?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => setLoadError(errorMessage(e, "This setup link is invalid or has expired.")));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { ticket } = await rushFetch<{ ticket: string }>("/api/rush/account/setup", {
        method: "POST",
        json: { token, password },
      });
      if (isSignedIn) await signOut();
      const result = await signIn.create({ strategy: "ticket", ticket });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.push("/rush/portal");
      } else {
        router.push("/sign-in?redirect_url=/rush/portal");
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_SETUP") {
        router.push("/sign-in?redirect_url=/rush/portal");
        return;
      }
      const clerk = err as { errors?: Array<{ longMessage?: string; message?: string }> };
      setError(clerk.errors?.[0]?.longMessage ?? clerk.errors?.[0]?.message ?? errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <CardHeader>
        <CardTitle>Link not valid</CardTitle>
        <CardDescription>{loadError} Ask a rush director to resend it, or check in at your next event.</CardDescription>
      </CardHeader>
    );
  }
  if (!info) {
    return (
      <CardContent className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </CardContent>
    );
  }
  if (info.hasAccount) {
    return (
      <>
        <CardHeader>
          <CardTitle>You&apos;re all set</CardTitle>
          <CardDescription>Your rush account already has a password.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/sign-in?redirect_url=/rush/portal">Sign in</Link>
          </Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl">Create your rush account</CardTitle>
        <CardDescription>
          Hi {info.name.split(" ")[0]}! Choose a password for <span className="font-medium">{info.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={submitting || !isLoaded}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create account
          </Button>
        </form>
      </CardContent>
    </>
  );
}

export default function AccountSetupPage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-start justify-center bg-muted/30 px-4 py-10 sm:items-center">
      <Card className="w-full max-w-md">
        <Suspense fallback={null}>
          <SetupForm />
        </Suspense>
      </Card>
    </main>
  );
}
