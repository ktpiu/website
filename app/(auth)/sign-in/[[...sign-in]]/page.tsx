"use client";

import { useState, useEffect } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

/** Same-origin redirect_url from Clerk's protect() redirect, else the portal. */
function getRedirectPath() {
  const raw = new URLSearchParams(window.location.search).get("redirect_url");
  if (!raw) return "/member-portal";
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : "/member-portal";
  } catch {
    return "/member-portal";
  }
}

export default function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;

    setIsLoading(true);
    setError("");

    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.push(getRedirectPath());
      }
    } catch (err) {
      const error = err as { errors?: { message: string }[] };
      setError(
        error.errors?.[0]?.message || "An error occurred. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-w-screen flex transition-all duration-300 ease-in-out">
      {/* Left side - Background image with text overlay */}
      <div className="hidden lg:flex lg:w-1/2 relative">
        <Image
          src="/auth-bg.jpg"
          alt="KTP Background"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

        {/* Back to website link */}
        <div className="absolute top-8 left-8">
          <Link
            href="/"
            className="text-white/80 hover:text-white text-sm flex items-center space-x-2"
          >
            <span>← Back to website</span>
          </Link>
        </div>

        {/* Text overlay - moved right and up */}
        <div className="absolute bottom-16 left-16 text-white">
          <h1 className="text-7xl font-bold tracking-tighter font-inter mb-4 leading-tight">
            Welcome
            <br />
            to the KTP
            <br />
            Member Portal
          </h1>
          <p className="text-lg text-white/80 tracking-normal">
            Your one stop for everything KTP
          </p>
        </div>
      </div>

      {/* Right side - Sign in form */}
      <div className="flex-1 flex flex-col bg-background dark:bg-zinc-900 p-8">
        {/* Theme toggle and Logo at top */}
        <div className="flex justify-between items-center pt-2 pb-4">
          <div className="w-9"></div>
          <Image
            src={
              mounted && theme === "dark"
                ? "/ktp-logos/KTP Logo Dark Plain No BG.png"
                : "/ktp-logos/KTP Logo Plain Text.png"
            }
            alt="KTP Logo"
            width={80}
            height={40}
            className="mx-auto transition-opacity duration-200"
          />
          <ThemeToggle />
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md space-y-8 animate-in fade-in duration-300">
            {/* Welcome text */}
            <div className="text-center space-y-3">
              <h2 className="text-4xl font-bold tracking-tight text-foreground">
                Welcome Back
              </h2>
              <p className="text-muted-foreground text-lg">
                Enter your credentials to access the portal
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md">
                {error}
              </div>
            )}

            {/* Sign in form */}
            <Card className="dark:bg-zinc-800 dark:border-zinc-700">
              <CardContent className="pt-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Clerk CAPTCHA element */}
                  <div id="clerk-captcha"></div>
                  <div className="space-y-2">
                    <label
                      htmlFor="email"
                      className="text-sm font-medium text-left block text-foreground"
                    >
                      Email
                    </label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setEmail(e.target.value)
                      }
                      required
                      className="rounded-md dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="password"
                      className="text-sm font-medium text-left block text-foreground"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={password}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setPassword(e.target.value)
                        }
                        required
                        className="rounded-md pr-10 dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <Link
                      href="/forgot-password"
                      className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-600 dark:hover:bg-zinc-700 text-white"
                    disabled={isLoading}
                  >
                    {isLoading ? "Signing in..." : "Sign In"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Sign up link */}
            <div className="text-center">
              <p className="text-muted-foreground tracking-tight">
                Don&apos;t have an account?{" "}
                <Link
                  href="/sign-up"
                  className="text-zinc-900 dark:text-zinc-200 font-medium hover:underline"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
