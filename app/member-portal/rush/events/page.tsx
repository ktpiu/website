"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ChevronRight, Plus, QrCode } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageRush } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessRequired, CycleSelect, NoCycle, RushPageHeader, useSelectedCycle } from "@/components/member-portal/rush/shared";
import { EventForm, emptyEventForm, formToPayload, type EventFormValues } from "@/components/member-portal/rush/event-form";
import type { EventsResponse } from "@/components/member-portal/rush/types";
import { errorMessage, formatRange, rushFetch } from "@/lib/rush/client";

export default function RushEventsAdminPage() {
  const { permissions } = useAuthStore();
  const canManage = canManageRush(permissions);
  const { cycle, cycleParam, isPending: cyclesPending } = useSelectedCycle();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<EventFormValues>(emptyEventForm());
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ["rush", "events", cycleParam],
    enabled: canManage,
    placeholderData: keepPreviousData,
    queryFn: () => rushFetch<EventsResponse>(`/api/rush/events?cycleId=${cycleParam}`),
  });

  if (!canManage) return <AccessRequired what="manage rush events" />;

  const create = async () => {
    if (!cycle) return;
    setSaving(true);
    try {
      const { id } = await rushFetch<{ id: string }>("/api/rush/events", {
        method: "POST",
        json: { cycleId: cycle.id, ...formToPayload(form) },
      });
      toast.success("Event created.");
      setCreateOpen(false);
      router.push(`/member-portal/rush/events/${id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const events = query.data?.events ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <RushPageHeader
        title="Events & Check-in"
        description="Create rush events, open QR check-in, manage timeslots and reconcile check-ins."
        actions={
          <>
            <CycleSelect />
            {cycle ? (
              <Button
                onClick={() => {
                  setForm(emptyEventForm(cycle.phase === "closed" ? "closed" : "open"));
                  setCreateOpen(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> New event
              </Button>
            ) : null}
          </>
        }
      />

      {cyclesPending || query.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !cycle ? (
        <NoCycle canCreate />
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No events in {cycle.label} yet.
        </p>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/member-portal/rush/events/${event.id}`}
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
                {event.hasTimeslots ? <Badge variant="outline">{event.slots.length} slots</Badge> : null}
                {event.checkinOpen ? (
                  <Badge className="gap-1 bg-emerald-600 text-white">
                    <QrCode className="h-3 w-3" /> Check-in open
                  </Badge>
                ) : null}
                <Badge variant="outline">{event.attendanceCount ?? 0} checked in</Badge>
                {event.unmatchedCount ? (
                  <Badge className="gap-1 bg-amber-500 text-white">
                    <AlertCircle className="h-3 w-3" /> {event.unmatchedCount} to reconcile
                  </Badge>
                ) : null}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New event · {cycle?.label}</DialogTitle>
          </DialogHeader>
          <EventForm values={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={saving || !form.title.trim() || !form.startsAt}>
              Create event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
