"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageRush } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CycleSelect, NoCycle, RushPageHeader, useSelectedCycle } from "@/components/member-portal/rush/shared";
import type { EventsResponse } from "@/components/member-portal/rush/types";
import { formatRange, rushFetch } from "@/lib/rush/client";

export default function RushSchedulePage() {
  const { permissions } = useAuthStore();
  const { cycle, cycleParam, isPending: cyclesPending } = useSelectedCycle();

  const eventsQuery = useQuery({
    queryKey: ["rush", "events", cycleParam],
    placeholderData: keepPreviousData,
    queryFn: () => rushFetch<EventsResponse>(`/api/rush/events?cycleId=${cycleParam}`),
  });

  const events = eventsQuery.data?.events ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <RushPageHeader
        title="Rush Schedule"
        description="Rush events for the cycle. Open an event to see details and sign up for timeslots."
        actions={<CycleSelect />}
      />

      {cyclesPending || eventsQuery.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !cycle ? (
        <NoCycle canCreate={canManageRush(permissions)} />
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No events in {cycle.label} yet.
        </p>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {events.map((event) => {
            const slots = event.slots.filter((s) => s.pnmCapacity > 0 || s.activeCapacity > 0 || s.pnms.length > 0 || s.actives.length > 0);
            const mySlots = slots.filter((s) => s.actives.some((a) => a.isMe)).length;
            return (
              <Link
                key={event.id}
                href={`/member-portal/rush/schedule/${event.id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRange(event.startsAt, event.endsAt)}
                    {event.locationName ? ` · ${event.locationName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {event.visibility === "pnm_portal" ? <Badge variant="secondary">Closed</Badge> : <Badge variant="outline">Public</Badge>}
                  {event.hasTimeslots ? <Badge variant="outline">{slots.length} slots</Badge> : null}
                  {mySlots > 0 ? (
                    <Badge className="gap-1 bg-emerald-600 text-white">
                      <CheckCircle2 className="h-3 w-3" /> Signed up{mySlots > 1 ? ` (${mySlots})` : ""}
                    </Badge>
                  ) : null}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
