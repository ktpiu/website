"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IuEmailWarning } from "@/components/rush/iu-email-warning";
import { errorMessage, formatRange, rushFetch } from "@/lib/rush/client";

type EventInfo = {
  event: { title: string; startsAt: string; endsAt: string | null; locationName: string; checkinOpen: boolean };
  prefill: { name: string; email: string } | null;
};

export default function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    rushFetch<EventInfo>(`/api/rush/check-in/${token}`)
      .then((data) => {
        setInfo(data);
        if (data.prefill) {
          setName(data.prefill.name);
          setEmail(data.prefill.email);
        }
      })
      .catch((e) => setLoadError(errorMessage(e, "This check-in link is not valid.")));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await rushFetch(`/api/rush/check-in/${token}`, { method: "POST", json: { name, email, website } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-start justify-center bg-muted/30 px-4 py-10 sm:items-center">
      <Card className="w-full max-w-md">
        {loadError ? (
          <CardHeader>
            <CardTitle>Check-in unavailable</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
        ) : !info ? (
          <CardContent className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        ) : done ? (
          <CardContent className="space-y-4 py-10 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
            <div className="space-y-1">
              <h1 className="text-2xl font-bold">You&apos;re checked in!</h1>
              <p className="text-muted-foreground">Thanks for coming to {info.event.title}.</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Keep an eye on your inbox for a confirmation email.
            </p>
            <Button asChild variant="outline">
              <Link href="/rush">Rush info</Link>
            </Button>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event check-in</p>
              <CardTitle className="text-2xl">{info.event.title}</CardTitle>
              <CardDescription className="space-y-1 pt-1">
                <span className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" />
                  {formatRange(info.event.startsAt, info.event.endsAt)}
                </span>
                {info.event.locationName ? (
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {info.event.locationName}
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!info.event.checkinOpen ? (
                <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                  Check-in for this event isn&apos;t open right now. Ask a rush committee member for help.
                </p>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name</Label>
                    <Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">IU email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@iu.edu"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <IuEmailWarning email={email} />
                  </div>
                  {/* Honeypot: hidden from people, filled by bots. */}
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="hidden"
                    aria-hidden="true"
                    name="website"
                  />
                  {error ? <p className="text-sm text-destructive">{error}</p> : null}
                  <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Check in
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    We&apos;ll email you a confirmation and a link to set up your rush account.
                  </p>
                </form>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
