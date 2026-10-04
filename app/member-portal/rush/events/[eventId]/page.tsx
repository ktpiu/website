"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ArrowLeft, Copy, ImagePlus, Link2, Maximize2, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageRush } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/rush/native-select";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { SlotGrid } from "@/components/rush/slot-grid";
import { AttendanceChip } from "@/components/rush/attendance-mark";
import type { AttendanceStatus } from "@/lib/rush/types";
import { AccessRequired } from "@/components/member-portal/rush/shared";
import { EventForm, eventToForm, formToPayload, type EventFormValues } from "@/components/member-portal/rush/event-form";
import type { MemberEvent, MemberSlot } from "@/components/member-portal/rush/types";
import { useSlotBroadcasts } from "@/hooks/use-rush-realtime";
import { AVATAR_ACCEPT } from "@/lib/avatar-upload";
import { cn } from "@/lib/utils";
import { errorMessage, formatDateTime, formatRange, formatTime, fromLocalInput, rushFetch, toLocalInput } from "@/lib/rush/client";

type AttendanceData = {
  attendance: Array<{ id: string; method: string; status: AttendanceStatus; checkedInAt: string; pnm: { id: string; name: string; email: string; photoUrl: string | null } }>;
  actives: Array<{ id: string; method: string; status: AttendanceStatus; checkedInAt: string; user: { id: string; name: string; avatar: string | null } }>;
  unmatched: Array<{
    id: string;
    name: string;
    email: string;
    submittedAt: string;
    suggestions: Array<{ id: string; name: string; email: string; score: number }>;
  }>;
  cyclePnms: Array<{ id: string; name: string; email: string }>;
};

type AxisDialog =
  | { kind: "time"; ids: string[] | null; date: string; start: string; end: string }
  | { kind: "location"; ids: string[] | null; name: string };
type AllocateDialog = { id: string; pnmCapacity: string; activeCapacity: string; notes: string };

const isUnallocated = (slot: MemberSlot) =>
  slot.pnmCapacity === 0 && slot.activeCapacity === 0 && slot.pnms.length === 0 && slot.actives.length === 0;

function useAction(refresh: () => void) {
  return async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      refresh();
    }
  };
}

export default function RushEventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { permissions } = useAuthStore();
  const canManage = canManageRush(permissions);
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rush"] });
  const run = useAction(refresh);

  const eventQuery = useQuery({
    queryKey: ["rush", "event", eventId],
    enabled: canManage,
    queryFn: () => rushFetch<{ event: MemberEvent }>(`/api/rush/events/${eventId}`).then((r) => r.event),
  });
  const attendanceQuery = useQuery({
    queryKey: ["rush", "event", eventId, "attendance"],
    enabled: canManage,
    queryFn: () => rushFetch<AttendanceData>(`/api/rush/events/${eventId}/attendance`),
  });
  const membersQuery = useQuery({
    queryKey: ["rush", "members"],
    enabled: canManage,
    staleTime: 5 * 60_000,
    queryFn: () =>
      rushFetch<{ members: Array<{ id: string; name: string; email: string }> }>("/api/rush/members").then((r) => r.members),
  });
  useSlotBroadcasts(eventQuery.data?.hasTimeslots ? [eventId] : [], refresh);

  const [form, setForm] = useState<EventFormValues | null>(null);
  const [presentOpen, setPresentOpen] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [axisDialog, setAxisDialog] = useState<AxisDialog | null>(null);
  const [allocateDialog, setAllocateDialog] = useState<AllocateDialog | null>(null);
  const [manualPnmId, setManualPnmId] = useState("");
  const [walkIn, setWalkIn] = useState({ name: "", email: "" });
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (eventQuery.data && !form) setForm(eventToForm(eventQuery.data));
  }, [eventQuery.data, form]);

  if (!canManage) return <AccessRequired what="manage rush events" />;
  if (eventQuery.isPending || !form) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 pt-2">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (eventQuery.error) return <p className="p-6 text-sm text-destructive">{errorMessage(eventQuery.error)}</p>;

  const event = eventQuery.data;
  const attendance = attendanceQuery.data;
  const checkedInIds = new Set((attendance?.attendance ?? []).map((a) => a.pnm.id));
  const presentCount = (attendance?.attendance ?? []).filter((a) => a.status !== "no_show").length;

  const saveDetails = () =>
    run(() => rushFetch(`/api/rush/events/${event.id}`, { method: "PATCH", json: formToPayload(form) }), "Event saved.");

  const uploadImage = (file: File | undefined) => {
    if (!file) return;
    const body = new FormData();
    body.set("image", file);
    run(() => rushFetch(`/api/rush/events/${event.id}/image`, { method: "POST", body }), "Image updated.");
  };

  const deleteEvent = async () => {
    if (!window.confirm(`Delete "${event.title}"? Attendance and signups for it will be removed.`)) return;
    try {
      await rushFetch(`/api/rush/events/${event.id}`, { method: "DELETE" });
      toast.success("Event deleted.");
      router.push("/member-portal/rush/events");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const slotsUrl = `/api/rush/events/${event.id}/slots`;
  const distinct = (items: string[]) => Array.from(new Set(items));
  const timeKeyOf = (sl: MemberSlot) => `${sl.startsAt}|${sl.endsAt ?? ""}`;

  const saveAxis = () => {
    if (!axisDialog) return;
    const d = axisDialog;
    setAxisDialog(null);
    if (d.kind === "time") {
      const startsAt = fromLocalInput(`${d.date}T${d.start}`);
      const endsAt = d.end ? fromLocalInput(`${d.date}T${d.end}`) : null;
      if (d.ids) {
        run(
          () => Promise.all(d.ids!.map((id) => rushFetch(`/api/rush/slots/${id}`, { method: "PATCH", json: { startsAt, endsAt } }))),
          "Time updated.",
        );
        return;
      }
      // A new time gets one empty cell under every existing location.
      const locations = distinct(event.slots.map((sl) => sl.locationName));
      const slots = (locations.length ? locations : [event.locationName]).map((locationName) => ({
        startsAt,
        endsAt,
        locationName,
        pnmCapacity: 0,
        activeCapacity: 0,
      }));
      run(() => rushFetch(slotsUrl, { method: "POST", json: { slots } }), "Time added.");
      return;
    }
    const name = d.name.trim();
    if (d.ids) {
      run(
        () => Promise.all(d.ids!.map((id) => rushFetch(`/api/rush/slots/${id}`, { method: "PATCH", json: { locationName: name } }))),
        "Location updated.",
      );
      return;
    }
    const blank = event.slots.filter((sl) => !sl.locationName.trim());
    if (event.slots.length > 0 && blank.length === event.slots.length) {
      // Only unnamed cells exist so far: name them instead of adding a second column.
      run(
        () => Promise.all(blank.map((sl) => rushFetch(`/api/rush/slots/${sl.id}`, { method: "PATCH", json: { locationName: name } }))),
        "Location added.",
      );
      return;
    }
    // A new location gets one empty cell at every existing time.
    const times = new Map(event.slots.map((sl) => [timeKeyOf(sl), sl]));
    const slots = (times.size ? Array.from(times.values()) : [{ startsAt: event.startsAt, endsAt: null }]).map((t) => ({
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      locationName: name,
      pnmCapacity: 0,
      activeCapacity: 0,
    }));
    run(() => rushFetch(slotsUrl, { method: "POST", json: { slots } }), "Location added.");
  };

  const deleteAxis = (ids: string[], what: string) => {
    if (!window.confirm(`Delete this ${what} and any signups in it?`)) return;
    run(() => Promise.all(ids.map((id) => rushFetch(`/api/rush/slots/${id}`, { method: "DELETE" }))), `${what[0].toUpperCase()}${what.slice(1)} deleted.`);
  };

  const saveAllocation = () => {
    if (!allocateDialog) return;
    const v = allocateDialog;
    setAllocateDialog(null);
    run(
      () =>
        rushFetch(`/api/rush/slots/${v.id}`, {
          method: "PATCH",
          json: { pnmCapacity: Number(v.pnmCapacity || 0), activeCapacity: Number(v.activeCapacity || 0), notes: v.notes },
        }),
      "Spots saved.",
    );
  };

  const openAddTime = () => {
    const last = [...event.slots].sort((x, y) => y.startsAt.localeCompare(x.startsAt))[0];
    const base = toLocalInput(last?.startsAt ?? event.startsAt);
    setAxisDialog({ kind: "time", ids: null, date: base.slice(0, 10), start: "", end: "" });
  };

  const copyLink = async () => {
    if (!event.checkinUrl) return;
    await navigator.clipboard.writeText(event.checkinUrl);
    toast.success("Check-in link copied.");
  };

  return (
    <div className={cn("mx-auto space-y-4 pb-10", tab === "slots" ? "max-w-none" : "max-w-5xl")}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mt-1">
        <Link href="/member-portal/rush/events">
          <ArrowLeft className="mr-1 h-4 w-4" /> All events
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-sm text-muted-foreground">
            {formatRange(event.startsAt, event.endsAt)}
            {event.locationName ? ` · ${event.locationName}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={deleteEvent}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Delete
        </Button>
      </div>

      <Tabs value={tab ?? (event.attendanceEnabled ? "checkin" : "attendance")} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {event.attendanceEnabled ? <TabsTrigger value="checkin">Check-in</TabsTrigger> : null}
          <TabsTrigger value="attendance">
            Attendance ({presentCount})
            {attendance?.unmatched.length ? (
              <Badge className="ml-1.5 bg-amber-500 px-1.5 text-white">{attendance.unmatched.length}</Badge>
            ) : null}
          </TabsTrigger>
          {event.hasTimeslots ? <TabsTrigger value="slots">Timeslots ({event.slots.length})</TabsTrigger> : null}
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        {event.attendanceEnabled ? <TabsContent value="checkin" className="pt-4">
          <Card>
            <CardContent className="grid gap-6 pt-6 md:grid-cols-[auto_1fr]">
              <div className="mx-auto rounded-xl bg-white p-4">
                {event.checkinUrl ? <QRCodeSVG value={event.checkinUrl} size={220} marginSize={1} /> : null}
              </div>
              <div className="space-y-4">
                <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <span>
                    <span className="block font-medium">Check-in is {event.checkinOpen ? "open" : "closed"}</span>
                    <span className="block text-xs text-muted-foreground">
                      PNMs can only check in while this is on. Turn it off after the event.
                    </span>
                  </span>
                  <Switch
                    checked={event.checkinOpen}
                    onCheckedChange={(checked) =>
                      run(() => rushFetch(`/api/rush/events/${event.id}`, { method: "PATCH", json: { checkinOpen: checked } }))
                    }
                  />
                </label>
                <div className="space-y-2">
                  <Label>Check-in link</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={event.checkinUrl ?? ""} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={copyLink} aria-label="Copy link">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button onClick={() => setPresentOpen(true)}>
                  <Maximize2 className="mr-1.5 h-4 w-4" /> Show QR full screen
                </Button>
                <p className="text-xs text-muted-foreground">
                  {event.visibility === "public"
                    ? "Anyone who checks in becomes an open rush PNM (matched by email)."
                    : "Closed event: check-ins are matched to PNMs in this cycle by email. Anyone else is held for you to reconcile."}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent> : null}

        <TabsContent value="attendance" className="space-y-4 pt-4">
          {attendance?.unmatched.length ? (
            <Card className="border-amber-500/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Needs reconciling ({attendance.unmatched.length})</CardTitle>
                <CardDescription>These check-ins didn&apos;t match a PNM in this cycle. Link each one or dismiss it.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {attendance.unmatched.map((u) => (
                  <div key={u.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {u.email} · {formatDateTime(u.submittedAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => run(() => rushFetch(`/api/rush/unmatched/${u.id}`, { method: "POST", json: { action: "dismiss" } }), "Dismissed.")}
                      >
                        <X className="mr-1 h-4 w-4" /> Dismiss
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {u.suggestions.map((s) => (
                        <Button
                          key={s.id}
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            run(
                              () => rushFetch(`/api/rush/unmatched/${u.id}`, { method: "POST", json: { action: "link", pnmId: s.id } }),
                              `Linked to ${s.name}.`,
                            )
                          }
                        >
                          <Link2 className="mr-1 h-3.5 w-3.5" /> {s.name}
                          <span className="ml-1 text-xs text-muted-foreground">({s.email})</span>
                        </Button>
                      ))}
                      <NativeSelect
                        className="w-56"
                        value=""
                        onChange={(e) =>
                          e.target.value &&
                          run(
                            () => rushFetch(`/api/rush/unmatched/${u.id}`, { method: "POST", json: { action: "link", pnmId: e.target.value } }),
                            "Linked.",
                          )
                        }
                        aria-label="Link to another PNM"
                      >
                        <option value="">Link to another PNM…</option>
                        {attendance.cyclePnms.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.email})
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Manual check-in</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">PNM in this cycle</Label>
                <NativeSelect className="w-64" value={manualPnmId} onChange={(e) => setManualPnmId(e.target.value)}>
                  <option value="">Choose…</option>
                  {(attendance?.cyclePnms ?? [])
                    .filter((p) => !checkedInIds.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <Button
                variant="outline"
                disabled={!manualPnmId}
                onClick={() => {
                  const pnmId = manualPnmId;
                  setManualPnmId("");
                  run(() => rushFetch(`/api/rush/events/${event.id}/attendance`, { method: "POST", json: { pnmId } }), "Checked in.");
                }}
              >
                Check in
              </Button>
              <Button
                variant="outline"
                disabled={!manualPnmId}
                onClick={() => {
                  const pnmId = manualPnmId;
                  setManualPnmId("");
                  run(
                    () => rushFetch(`/api/rush/events/${event.id}/mark`, { method: "POST", json: { pnmId, status: "no_show" } }),
                    "Marked no-show.",
                  );
                }}
              >
                <X className="mr-1 h-4 w-4" /> No-show
              </Button>
              {event.visibility === "public" ? (
                <>
                  <span className="pb-2 text-xs text-muted-foreground">or new walk-in</span>
                  <Input className="w-40" placeholder="Name" value={walkIn.name} onChange={(e) => setWalkIn((w) => ({ ...w, name: e.target.value }))} />
                  <Input className="w-52" placeholder="email@iu.edu" value={walkIn.email} onChange={(e) => setWalkIn((w) => ({ ...w, email: e.target.value }))} />
                  <Button
                    variant="outline"
                    disabled={!walkIn.name || !walkIn.email}
                    onClick={() => {
                      const json = walkIn;
                      setWalkIn({ name: "", email: "" });
                      run(() => rushFetch(`/api/rush/events/${event.id}/attendance`, { method: "POST", json }), "Checked in.");
                    }}
                  >
                    <UserPlus className="mr-1 h-4 w-4" /> Add
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Checked in ({presentCount})</CardTitle>
            </CardHeader>
            <CardContent>
              {!attendance ? (
                <Skeleton className="h-24" />
              ) : attendance.attendance.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody has checked in yet.</p>
              ) : (
                <ul className="divide-y">
                  {attendance.attendance.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/member-portal/rush/pnms/${a.pnm.id}`} className="flex items-center gap-2.5 text-sm">
                        <PnmAvatar name={a.pnm.name} src={a.pnm.photoUrl} className="h-8 w-8" />
                        <span>
                          <span className="font-medium">{a.pnm.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatTime(a.checkedInAt)} · {a.method} {a.status !== "present" ? <AttendanceChip status={a.status} /> : null}
                          </span>
                        </span>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Remove ${a.pnm.name}'s check-in`}
                        onClick={() => {
                          if (window.confirm(`Remove ${a.pnm.name}'s check-in?`)) {
                            run(() => rushFetch(`/api/rush/attendance/${a.id}`, { method: "DELETE" }));
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {event.hasTimeslots ? (
          <TabsContent value="slots" className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {event.activesMultiSlot ? "Actives may take multiple slots." : "One slot per active."}{" "}
                {event.selfChangeMode === "admin_only"
                  ? "Only admins can change signups."
                  : `Self-changes allowed until ${event.changeCutoffMinutes} min before a slot.`}{" "}
                Change these under Details.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={openAddTime}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add time
                </Button>
                <Button variant="outline" onClick={() => setAxisDialog({ kind: "location", ids: null, name: "" })}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add location
                </Button>
              </div>
            </div>
            {event.slots.length === 0 ? (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Start by adding a time (with its date) and a location. Each cell stays empty until you allocate PNM and active spots to it.
              </p>
            ) : (
              <SlotGrid
                slots={event.slots}
                layout={event.slotGrid}
                alwaysShowDate
                renderHeader={(axis, label, group) => {
                  const ids = group.map((g) => g.id);
                  const first = group[0];
                  const edit = () =>
                    axis === "time"
                      ? setAxisDialog({
                          kind: "time",
                          ids,
                          date: toLocalInput(first.startsAt).slice(0, 10),
                          start: toLocalInput(first.startsAt).slice(11),
                          end: toLocalInput(first.endsAt).slice(11),
                        })
                      : setAxisDialog({ kind: "location", ids, name: first.locationName });
                  return (
                    <span className="flex items-center justify-between gap-1">
                      <span>{label}</span>
                      <span className="flex shrink-0">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={edit} aria-label={`Edit ${axis}`}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteAxis(ids, axis)} aria-label={`Delete ${axis}`}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </span>
                    </span>
                  );
                }}
                renderCell={(slot) =>
                  isUnallocated(slot) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto w-full border-dashed py-3 text-xs text-muted-foreground"
                      onClick={() =>
                        setAllocateDialog({ id: slot.id, pnmCapacity: "4", activeCapacity: "2", notes: slot.notes ?? "" })
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Allocate spots
                    </Button>
                  ) : (
                    <SlotAdminCell
                      slot={slot}
                      cyclePnms={attendance?.cyclePnms ?? []}
                      members={membersQuery.data ?? []}
                      onEdit={() =>
                        setAllocateDialog({
                          id: slot.id,
                          pnmCapacity: String(slot.pnmCapacity),
                          activeCapacity: String(slot.activeCapacity),
                          notes: slot.notes ?? "",
                        })
                      }
                      onDelete={() => {
                        if (window.confirm("Clear this cell and its signups?")) {
                          run(
                            () =>
                              rushFetch(`/api/rush/slots/${slot.id}`, { method: "DELETE" }).then(() =>
                                rushFetch(slotsUrl, {
                                  method: "POST",
                                  json: {
                                    startsAt: slot.startsAt,
                                    endsAt: slot.endsAt,
                                    locationName: slot.locationName,
                                    pnmCapacity: 0,
                                    activeCapacity: 0,
                                  },
                                }),
                              ),
                            "Cell cleared.",
                          );
                        }
                      }}
                      onAssign={(json) => run(() => rushFetch(`/api/rush/slots/${slot.id}/assign`, { method: "POST", json }))}
                      onRemove={(signupId) => run(() => rushFetch(`/api/rush/signups/${signupId}`, { method: "DELETE" }))}
                    />
                  )
                }
              />
            )}
          </TabsContent>
        ) : null}

        <TabsContent value="details" className="pt-4">
          <Card>
            <CardContent className="space-y-6 pt-6">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => imageInput.current?.click()}>
                  <ImagePlus className="mr-1.5 h-4 w-4" /> {event.imageUrl ? "Replace image" : "Add cover image"}
                </Button>
                {event.imageUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => run(() => rushFetch(`/api/rush/events/${event.id}/image`, { method: "DELETE" }), "Image removed.")}
                  >
                    Remove image
                  </Button>
                ) : null}
                <input
                  ref={imageInput}
                  type="file"
                  accept={AVATAR_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    uploadImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <EventForm values={form} onChange={setForm} />
              <div className="flex gap-2">
                <Button onClick={saveDetails}>Save changes</Button>
                <Button variant="ghost" onClick={() => setForm(eventToForm(event))}>
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={presentOpen} onOpenChange={setPresentOpen}>
        <DialogContent className="flex h-[100dvh] max-w-none flex-col items-center justify-center gap-6 rounded-none bg-white text-black sm:max-w-none">
          <DialogHeader>
            <DialogTitle className="text-center text-3xl text-black sm:text-5xl">{event.title}</DialogTitle>
          </DialogHeader>
          {event.checkinUrl ? <QRCodeSVG value={event.checkinUrl} size={480} marginSize={2} className="h-auto w-[min(80vw,70vh)]" /> : null}
          <p className="text-xl font-medium sm:text-2xl">Scan to check in</p>
          {!event.checkinOpen ? <p className="text-red-600">Check-in is currently closed.</p> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(axisDialog)} onOpenChange={(open) => !open && setAxisDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {axisDialog?.ids ? "Edit" : "Add"} {axisDialog?.kind === "location" ? "location" : "time"}
            </DialogTitle>
          </DialogHeader>
          {axisDialog?.kind === "time" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["date", "Date", "date"],
                  ["start", "Starts", "time"],
                  ["end", "Ends (optional)", "time"],
                ] as const
              ).map(([key, label, type]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`axis-${key}`}>{label}</Label>
                  <Input
                    id={`axis-${key}`}
                    type={type}
                    value={axisDialog[key]}
                    onChange={(e) => setAxisDialog((d) => (d && d.kind === "time" ? { ...d, [key]: e.target.value } : d))}
                  />
                </div>
              ))}
              {!axisDialog.ids ? (
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  Adds an empty cell under every location. Spanning several days? Add each day&apos;s times separately.
                </p>
              ) : null}
            </div>
          ) : axisDialog ? (
            <div className="space-y-2">
              <Label htmlFor="axis-name">Location</Label>
              <Input
                id="axis-name"
                autoFocus
                value={axisDialog.name}
                placeholder="Luddy Hall 1106"
                onChange={(e) => setAxisDialog((d) => (d && d.kind === "location" ? { ...d, name: e.target.value } : d))}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAxisDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveAxis}
              disabled={
                !axisDialog ||
                (axisDialog.kind === "time" ? !axisDialog.date || !axisDialog.start : !axisDialog.name.trim())
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(allocateDialog)} onOpenChange={(open) => !open && setAllocateDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate spots</DialogTitle>
          </DialogHeader>
          {allocateDialog ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["pnmCapacity", "PNM spots", "number"],
                  ["activeCapacity", "Active spots", "number"],
                  ["notes", "Notes (optional)", "text"],
                ] as const
              ).map(([key, label, type]) => (
                <div key={key} className={cn("space-y-2", key === "notes" && "sm:col-span-2")}>
                  <Label htmlFor={`alloc-${key}`}>{label}</Label>
                  <Input
                    id={`alloc-${key}`}
                    type={type}
                    min={type === "number" ? 0 : undefined}
                    value={allocateDialog[key]}
                    onChange={(e) => setAllocateDialog((d) => d && { ...d, [key]: e.target.value })}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Cells with no spots stay hidden from PNMs and actives. Lowering spots keeps everyone already signed up; it only blocks new signups.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocateDialog(null)}>
              Cancel
            </Button>
            <Button onClick={saveAllocation}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One timeslot cell in the admin grid: roster, capacity and placement controls. */
function SlotAdminCell({
  slot,
  cyclePnms,
  members,
  onEdit,
  onDelete,
  onAssign,
  onRemove,
}: {
  slot: MemberSlot;
  cyclePnms: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: (json: { pnmId?: string; userId?: string }) => void;
  onRemove: (signupId: string) => void;
}) {
  const pnmIds = new Set(slot.pnms.map((p) => p.pnmId));
  const activeIds = new Set(slot.actives.map((a) => a.userId));
  const groups = [
    {
      title: "PNMs",
      people: slot.pnms.map((p) => ({ signupId: p.signupId, name: p.name, photo: p.photoUrl })),
      capacity: slot.pnmCapacity,
      options: cyclePnms.filter((p) => !pnmIds.has(p.id)),
      placeholder: "+ PNM (moves them here)",
      assign: (id: string) => onAssign({ pnmId: id }),
    },
    {
      title: "Actives",
      people: slot.actives.map((a) => ({ signupId: a.signupId, name: a.name, photo: a.avatar })),
      capacity: slot.activeCapacity,
      options: members.filter((m) => !activeIds.has(m.id)),
      placeholder: "+ Active",
      assign: (id: string) => onAssign({ userId: id }),
    },
  ];

  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-2">
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs text-muted-foreground">{slot.notes || " "}</p>
        <div className="-mr-1 -mt-1 flex">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit timeslot">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} aria-label="Delete timeslot">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.title} className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.title} {group.people.length}/{group.capacity}
            {group.people.length > group.capacity ? <span className="text-amber-600"> over</span> : null}
          </p>
          <ul className="space-y-0.5">
            {group.people.map((p) => (
              <li key={p.signupId} className="flex items-center justify-between gap-1 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <PnmAvatar name={p.name} src={p.photo} className="h-5 w-5" />
                  <span className="truncate">{p.name}</span>
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onRemove(p.signupId)} aria-label={`Remove ${p.name}`}>
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
          <NativeSelect value="" onChange={(e) => e.target.value && group.assign(e.target.value)} aria-label={`Add ${group.title}`}>
            <option value="">{group.placeholder}</option>
            {group.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ))}
    </div>
  );
}
