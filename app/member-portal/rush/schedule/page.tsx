"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Lock, MapPin, Shirt } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageRush } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { SlotGrid } from "@/components/rush/slot-grid";
import { CycleSelect, NoCycle, RushPageHeader, useSelectedCycle } from "@/components/member-portal/rush/shared";
import type { EventsResponse, MemberSlot } from "@/components/member-portal/rush/types";
import { useSlotBroadcasts } from "@/hooks/use-rush-realtime";
import { errorMessage, formatRange, rushFetch } from "@/lib/rush/client";
import { cn } from "@/lib/utils";

/** One timeslot inside the grid: who's signed up and the active's own button. */
function SlotCell({
  slot,
  onSignUp,
  onLeave,
  busy,
}: {
  slot: MemberSlot;
  onSignUp: () => void;
  onLeave: (signupId: string) => void;
  busy: boolean;
}) {
  const me = slot.actives.find((a) => a.isMe);
  const activeFull = slot.actives.length >= slot.activeCapacity;
  const started = new Date(slot.startsAt).getTime() <= Date.now();

  const people = (title: string, count: number, capacity: number, list: Array<{ signupId: string; name: string; photo: string | null; isMe?: boolean }>) => (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title} {count}/{capacity}
      </p>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">None yet</p>
      ) : (
        <ul className="space-y-1">
          {list.map((p) => (
            <li key={p.signupId} className="flex items-center gap-1.5 text-xs">
              <PnmAvatar name={p.name} src={p.photo} className="h-5 w-5" />
              <span className={cn("truncate", p.isMe && "font-semibold")}>{p.isMe ? "You" : p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className={cn("space-y-2 rounded-md p-2", me ? "bg-primary/5 ring-1 ring-primary" : "bg-muted/30")}>
      {slot.notes ? <p className="text-xs text-muted-foreground">{slot.notes}</p> : null}
      {people(
        "PNMs",
        slot.pnms.length,
        slot.pnmCapacity,
        slot.pnms.map((p) => ({ signupId: p.signupId, name: p.name, photo: p.photoUrl })),
      )}
      {people(
        "Actives",
        slot.actives.length,
        slot.activeCapacity,
        slot.actives.map((a) => ({ signupId: a.signupId, name: a.name, photo: a.avatar, isMe: a.isMe })),
      )}
      {me ? (
        <Button size="sm" variant="outline" className="h-7 w-full" disabled={busy} onClick={() => onLeave(me.signupId)}>
          Leave
        </Button>
      ) : (
        <Button size="sm" className="h-7 w-full" disabled={busy || activeFull || started} onClick={onSignUp}>
          {activeFull ? "Full" : "Sign up"}
        </Button>
      )}
    </div>
  );
}

export default function RushSchedulePage() {
  const { permissions, user } = useAuthStore();
  const { cycle, cycleParam, isPending: cyclesPending } = useSelectedCycle();
  const queryClient = useQueryClient();
  const queryKey = ["rush", "events", cycleParam];

  const eventsQuery = useQuery({
    queryKey,
    placeholderData: keepPreviousData,
    queryFn: () => rushFetch<EventsResponse>(`/api/rush/events?cycleId=${cycleParam}`),
  });

  const events = eventsQuery.data?.events ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rush", "events"] });
  useSlotBroadcasts(
    events.filter((e) => e.hasTimeslots).map((e) => e.id),
    refresh,
  );

  const patchMySignup = (slotId: string, add: boolean, eventId: string) =>
    queryClient.setQueryData<EventsResponse>(queryKey, (data) =>
      data && {
        ...data,
        events: data.events.map((e) =>
          e.id !== eventId
            ? e
            : {
                ...e,
                slots: e.slots.map((s) => {
                  const withoutMe = e.activesMultiSlot || s.id === slotId ? s.actives : s.actives.filter((a) => !a.isMe);
                  if (s.id !== slotId) return { ...s, actives: withoutMe };
                  return {
                    ...s,
                    actives: add
                      ? [...withoutMe.filter((a) => !a.isMe), { signupId: "pending", userId: user?.id ?? "", name: user?.name ?? "You", avatar: user?.avatar || null, isMe: true }]
                      : withoutMe.filter((a) => !a.isMe),
                  };
                }),
              },
        ),
      },
    );

  const signUp = useMutation({
    mutationFn: ({ slotId }: { slotId: string; eventId: string }) =>
      rushFetch(`/api/rush/slots/${slotId}/signup`, { method: "POST" }),
    onMutate: async ({ slotId, eventId }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      patchMySignup(slotId, true, eventId);
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(errorMessage(error));
    },
    onSettled: refresh,
  });

  const leave = useMutation({
    mutationFn: ({ signupId }: { signupId: string; slotId: string; eventId: string }) =>
      rushFetch(`/api/rush/signups/${signupId}`, { method: "DELETE" }),
    onMutate: async ({ slotId, eventId }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      patchMySignup(slotId, false, eventId);
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(errorMessage(error));
    },
    onSettled: refresh,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <RushPageHeader
        title="Rush Schedule"
        description="Rush events for the cycle. Sign up for dinner and interview timeslots here."
        actions={<CycleSelect />}
      />

      {cyclesPending || eventsQuery.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : !cycle ? (
        <NoCycle canCreate={canManageRush(permissions)} />
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No events in {cycle.label} yet.
        </p>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <Card key={event.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-lg">{event.title}</CardTitle>
                  <div className="flex gap-1.5">
                    {event.visibility === "pnm_portal" ? <Badge variant="secondary">Closed rush</Badge> : <Badge variant="outline">Public</Badge>}
                    {event.hasTimeslots ? <Badge variant="outline">Timeslots</Badge> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-4 w-4" />
                    {formatRange(event.startsAt, event.endsAt)}
                  </span>
                  {event.locationName ? (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-4 w-4" />
                      {event.locationName}
                    </span>
                  ) : null}
                  {event.dressCode ? (
                    <span className="flex items-center gap-1.5">
                      <Shirt className="h-4 w-4" />
                      {event.dressCode}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {event.description ? <p className="whitespace-pre-wrap text-sm">{event.description}</p> : null}
                {event.hasTimeslots ? (
                  <>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" />
                      {event.activesMultiSlot ? "You can sign up for multiple slots." : "One slot per active."}{" "}
                      {event.selfChangeMode === "admin_only"
                        ? "Only rush directors can change signups once made."
                        : event.changeCutoffMinutes > 0
                          ? `Changes allowed until ${event.changeCutoffMinutes} min before a slot.`
                          : "Changes allowed until a slot starts."}
                    </p>
                    {event.slots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No timeslots have been added yet.</p>
                    ) : (
                      <SlotGrid
                        slots={event.slots}
                        layout={event.slotGrid}
                        renderCell={(slot) => (
                          <SlotCell
                            slot={slot}
                            busy={signUp.isPending || leave.isPending}
                            onSignUp={() => signUp.mutate({ slotId: slot.id, eventId: event.id })}
                            onLeave={(signupId) => leave.mutate({ signupId, slotId: slot.id, eventId: event.id })}
                          />
                        )}
                      />
                    )}
                  </>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
