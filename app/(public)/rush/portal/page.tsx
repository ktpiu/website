"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCheck, Heart, LogOut, UserPlus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/rush/native-select";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { ClosedBadge, RushEventCard } from "@/components/rush/rush-event-card";
import { SlotGrid } from "@/components/rush/slot-grid";
import { useSlotBroadcasts } from "@/hooks/use-rush-realtime";
import { ApiError, errorMessage, formatDay, formatRange, rushFetch } from "@/lib/rush/client";
import { STATUS_LABELS, type PnmStatus } from "@/lib/rush/types";
import { cn } from "@/lib/utils";

type PortalSlot = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  locationName: string;
  locationUrl: string | null;
  notes: string | null;
  spotsLeft: number;
  started: boolean;
};

type PortalEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  locationName: string;
  locationUrl: string | null;
  dressCode: string | null;
  imageUrl: string | null;
  isClosed: boolean;
  attended: boolean;
  hasTimeslots: boolean;
  /** The rush this event belongs to has concluded: nothing can change. */
  concluded: boolean;
  selfChangeMode: "cutoff" | "admin_only";
  changeCutoffMinutes: number;
  slotGrid: "time_rows" | "location_rows";
  mySignup: { id: string; slotId: string; canChange: boolean } | null;
  slots: PortalSlot[];
};

type Registration = {
  open: boolean;
  cycleLabel: string | null;
  registered: boolean;
  graduationYears: number[];
};

type UnregisteredData = {
  kind: "unregistered";
  account: { name: string; email: string; graduationYear: number | null; status: string };
  registration: Registration;
};

type PortalResponse = { kind: "member" } | UnregisteredData | PortalData;

type PortalData = {
  kind: "pnm";
  registration: Registration;
  pnm: { name: string; email: string; status: PnmStatus; isIuEmail: boolean; photoUrl: string | null };
  attendance: Array<{ eventId: string; title: string; startsAt: string }>;
  applications: Array<{ cycleLabel: string; submittedAt: string }>;
  events: PortalEvent[];
};

const QUERY_KEY = ["rush", "portal"];

function policyText(event: PortalEvent) {
  if (event.selfChangeMode === "admin_only") return "Once booked, only rush directors can change your timeslot.";
  if (event.changeCutoffMinutes === 0) return "You can switch or cancel until your timeslot starts.";
  const hours = event.changeCutoffMinutes / 60;
  return `You can switch or cancel until ${
    Number.isInteger(hours) ? `${hours} hour${hours === 1 ? "" : "s"}` : `${event.changeCutoffMinutes} minutes`
  } before your timeslot.`;
}

function SlotPicker({ event }: { event: PortalEvent }) {
  const queryClient = useQueryClient();

  const book = useMutation({
    mutationFn: (slotId: string) =>
      rushFetch(`/api/rush/portal/events/${event.id}/slot`, { method: "POST", json: { slotId } }),
    onMutate: async (slotId) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PortalData>(QUERY_KEY);
      queryClient.setQueryData<PortalData>(QUERY_KEY, (data) =>
        data
          ? {
              ...data,
              events: data.events.map((e) =>
                e.id !== event.id
                  ? e
                  : {
                      ...e,
                      mySignup: { id: e.mySignup?.id ?? "pending", slotId, canChange: true },
                      slots: e.slots.map((s) => ({
                        ...s,
                        spotsLeft:
                          s.id === slotId ? Math.max(0, s.spotsLeft - 1) : s.id === e.mySignup?.slotId ? s.spotsLeft + 1 : s.spotsLeft,
                      })),
                    },
              ),
            }
          : data,
      );
      return { previous };
    },
    onError: (error, _slotId, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      toast.error(errorMessage(error));
    },
    onSuccess: () => toast.success("Timeslot booked. We emailed you the details."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const cancel = useMutation({
    mutationFn: () => rushFetch(`/api/rush/portal/events/${event.id}/slot`, { method: "DELETE" }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => toast.success("Timeslot cancelled."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const locked = event.concluded || Boolean(event.mySignup && !event.mySignup.canChange);
  const busy = book.isPending || cancel.isPending;

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Choose a timeslot</p>
        {event.mySignup ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Booked
          </Badge>
        ) : null}
      </div>
      <SlotGrid
        slots={event.slots}
        layout={event.slotGrid}
        renderCell={(slot) => {
          const mine = event.mySignup?.slotId === slot.id;
          const full = slot.spotsLeft <= 0 && !mine;
          return (
            <div className={cn("space-y-1.5 rounded-md p-2", mine ? "bg-primary/10 ring-1 ring-primary" : "bg-muted/30")}>
              <p className="text-xs text-muted-foreground">
                {mine ? "Your slot" : full ? "Full" : `${slot.spotsLeft} spot${slot.spotsLeft === 1 ? "" : "s"} left`}
              </p>
              {slot.notes ? <p className="text-xs text-muted-foreground">{slot.notes}</p> : null}
              {mine ? (
                <Button size="sm" variant="outline" className="h-7 w-full" disabled={busy || locked} onClick={() => cancel.mutate()}>
                  Cancel
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 w-full"
                  disabled={busy || full || slot.started || locked}
                  onClick={() => book.mutate(slot.id)}
                >
                  {event.mySignup ? "Switch here" : "Book"}
                </Button>
              )}
            </div>
          );
        }}
      />
      <p className="text-xs text-muted-foreground">
        {event.concluded
          ? "This rush has concluded, so timeslots can't be changed."
          : locked
            ? "Your timeslot is locked in. Contact a rush director if you need to change it."
            : policyText(event)}
      </p>
    </div>
  );
}

function RegisterCard({
  registration,
  graduationYear,
}: {
  registration: Registration;
  graduationYear: number | null;
}) {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(
    graduationYear && registration.graduationYears.includes(graduationYear) ? String(graduationYear) : "",
  );
  const register = useMutation({
    mutationFn: () => rushFetch("/api/rush/portal/register", { method: "POST", json: { graduationYear: Number(year) } }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => toast.success(`You're registered for ${registration.cycleLabel ?? "rush"}.`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const [freshman, sophomore] = registration.graduationYears;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-5 w-5 text-primary" /> Rushing {registration.cycleLabel ?? "this semester"}?
        </CardTitle>
        <CardDescription>
          Freshmen and sophomores can register here. Everyone else is registered when they check in at an open rush
          event or{" "}
          <Link href="/rush/apply" className="underline underline-offset-2">
            apply
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rush-grad-year">Graduation year</Label>
          <NativeSelect id="rush-grad-year" className="w-56" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Select…</option>
            <option value={freshman}>{freshman} (freshman)</option>
            <option value={sophomore}>{sophomore} (sophomore)</option>
          </NativeSelect>
        </div>
        <Button disabled={!year || register.isPending} onClick={() => register.mutate()}>
          I&apos;m rushing
        </Button>
      </CardContent>
    </Card>
  );
}

function Unregistered({ data }: { data: UnregisteredData }) {
  const { account, registration } = data;
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <PnmAvatar name={account.name} src={null} className="h-16 w-16" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Hi, {account.name.split(" ")[0]}</h1>
            <p className="truncate text-sm text-muted-foreground">{account.email}</p>
          </div>
          <SignOutButton redirectUrl="/rush">
            <Button variant="ghost" size="sm">
              <LogOut className="mr-1.5 h-4 w-4" /> Sign out
            </Button>
          </SignOutButton>
        </CardContent>
      </Card>
      {registration.open ? (
        <RegisterCard registration={registration} graduationYear={account.graduationYear} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You&apos;re not registered for rush</CardTitle>
            <CardDescription>
              {registration.cycleLabel
                ? "Registration through the portal is closed right now. Check in at a rush event to get started."
                : "Rush isn't running right now. Check back next semester."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/rush">See rush info</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Portal() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => rushFetch<PortalResponse>("/api/rush/portal/me"),
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof ApiError && error.status === 403) && count < 1,
  });

  // Members and rush candidates share one sign-in. A member-portal account
  // that lands here (e.g. a member who used the rush portal link) belongs there.
  const router = useRouter();
  const isMember = query.data?.kind === "member";
  useEffect(() => {
    if (isMember) router.replace("/member-portal");
  }, [isMember, router]);

  const portal = query.data?.kind === "pnm" ? query.data : null;
  const slotEventIds = (portal?.events ?? []).filter((e) => e.hasTimeslots).map((e) => e.id);
  useSlotBroadcasts(slotEventIds, () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }));

  if (query.isPending || isMember) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (query.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>{errorMessage(query.error)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <SignOutButton redirectUrl="/rush">
            <Button variant="outline">Sign out</Button>
          </SignOutButton>
        </CardContent>
      </Card>
    );
  }

  if (query.data.kind === "unregistered") {
    return <Unregistered data={query.data} />;
  }
  if (!portal) return null;

  const { pnm, events, attendance, applications, registration } = portal;
  const isFormer = pnm.status === "former";

  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <PnmAvatar name={pnm.name} src={pnm.photoUrl} className="h-16 w-16" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Hi, {pnm.name.split(" ")[0]}</h1>
            <p className="truncate text-sm text-muted-foreground">{pnm.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isFormer ? <Badge variant="secondary">{STATUS_LABELS[pnm.status]}</Badge> : null}
            <SignOutButton redirectUrl="/rush">
              <Button variant="ghost" size="sm">
                <LogOut className="mr-1.5 h-4 w-4" /> Sign out
              </Button>
            </SignOutButton>
          </div>
        </CardContent>
      </Card>

      {isFormer && registration.open && !registration.registered ? (
        <RegisterCard registration={registration} graduationYear={null} />
      ) : null}

      {isFormer ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex gap-4 pt-6">
            <Heart className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-semibold">Thank you for rushing KTP</p>
              <p className="text-sm text-muted-foreground">
                We weren&apos;t able to extend an invitation this semester, but we really enjoyed getting to know you
                and would love to see you rush again next semester. Your account will stay here, and you can check in
                to next semester&apos;s open rush events with the same email.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Your rush events</h2>
        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No upcoming events right now.{" "}
            <Link href="/rush" className="underline underline-offset-2">
              See rush info
            </Link>
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {events.map((event) => (
              <RushEventCard
                key={event.id}
                event={event}
                badge={
                  event.attended ? (
                    <Badge className="gap-1 bg-emerald-600 text-white">
                      <CheckCircle2 className="h-3 w-3" /> Checked in
                    </Badge>
                  ) : event.isClosed ? (
                    <ClosedBadge />
                  ) : null
                }
              >
                {event.hasTimeslots ? <SlotPicker event={event} /> : null}
              </RushEventCard>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Events attended</CardTitle>
          </CardHeader>
          <CardContent>
            {attendance.length === 0 ? (
              <p className="text-sm text-muted-foreground">Check in with the QR code at each event.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {attendance.map((a) => (
                  <li key={a.eventId} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      {a.title}
                    </span>
                    <span className="text-muted-foreground">{formatDay(a.startsAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Application</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {applications.length === 0 ? (
              <>
                <p className="text-muted-foreground">You haven&apos;t submitted an application yet.</p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/rush/apply">
                    <ClipboardCheck className="mr-1.5 h-4 w-4" /> Apply
                  </Link>
                </Button>
              </>
            ) : (
              applications.map((a) => (
                <p key={a.cycleLabel} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Submitted for {a.cycleLabel} on {formatRange(a.submittedAt).split(" · ")[0]}
                </p>
              ))
            )}
          </CardContent>
        </Card>
      </section>

    </div>
  );
}

export default function RushPortalPage() {
  return (
    <QueryProvider>
      <main className="min-h-[calc(100vh-4rem)] bg-muted/30 px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-4xl">
          <Portal />
        </div>
      </main>
      <Toaster richColors />
    </QueryProvider>
  );
}
