"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/rush/native-select";
import { fromLocalInput, toLocalInput } from "@/lib/rush/client";
import type { MemberEvent } from "@/components/member-portal/rush/types";
import { cn } from "@/lib/utils";

export type EventFormValues = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  locationName: string;
  locationUrl: string;
  dressCode: string;
  visibility: "public" | "pnm_portal";
  hasTimeslots: boolean;
  activesMultiSlot: boolean;
  selfChangeMode: "cutoff" | "admin_only";
  changeCutoffMinutes: string;
  slotGrid: "time_rows" | "location_rows";
};

export function emptyEventForm(kind: "open" | "closed" = "open"): EventFormValues {
  return {
    title: "",
    description: "",
    startsAt: "",
    endsAt: "",
    locationName: "",
    locationUrl: "",
    dressCode: "",
    visibility: kind === "closed" ? "pnm_portal" : "public",
    hasTimeslots: false,
    activesMultiSlot: false,
    selfChangeMode: "cutoff",
    changeCutoffMinutes: "0",
    slotGrid: "time_rows",
  };
}

export function eventToForm(event: MemberEvent): EventFormValues {
  return {
    title: event.title,
    description: event.description,
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    locationName: event.locationName,
    locationUrl: event.locationUrl ?? "",
    dressCode: event.dressCode ?? "",
    visibility: event.visibility,
    hasTimeslots: event.hasTimeslots,
    activesMultiSlot: event.activesMultiSlot,
    selfChangeMode: event.selfChangeMode,
    changeCutoffMinutes: String(event.changeCutoffMinutes),
    slotGrid: event.slotGrid,
  };
}

export function formToPayload(values: EventFormValues) {
  return {
    ...values,
    startsAt: fromLocalInput(values.startsAt),
    endsAt: fromLocalInput(values.endsAt),
    changeCutoffMinutes: Number(values.changeCutoffMinutes || 0),
  };
}

export function EventForm({
  values,
  onChange,
}: {
  values: EventFormValues;
  onChange: (values: EventFormValues) => void;
}) {
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="ev-title">Title</Label>
        <Input id="ev-title" value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="Meet the Chapter" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ev-start">Starts</Label>
          <Input id="ev-start" type="datetime-local" value={values.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-end">Ends</Label>
          <Input id="ev-end" type="datetime-local" value={values.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-loc">Location</Label>
          <Input id="ev-loc" value={values.locationName} onChange={(e) => set("locationName", e.target.value)} placeholder="Luddy Hall 1106" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-loc-url">Map link (optional)</Label>
          <Input id="ev-loc-url" value={values.locationUrl} onChange={(e) => set("locationUrl", e.target.value)} placeholder="https://maps.google.com/…" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-dress">Dress code (optional)</Label>
          <Input id="ev-dress" value={values.dressCode} onChange={(e) => set("dressCode", e.target.value)} placeholder="Business casual" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-vis">Who can see it</Label>
          <NativeSelect id="ev-vis" value={values.visibility} onChange={(e) => set("visibility", e.target.value as EventFormValues["visibility"])}>
            <option value="public">Open rush: public, shown on the rush page</option>
            <option value="pnm_portal">Closed rush: invited PNMs only, in their portal</option>
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ev-desc">Description</Label>
        <Textarea id="ev-desc" rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} />
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Timeslots</span>
            <span className="block text-xs text-muted-foreground">
              For dinners and interviews: PNMs and actives sign up for one slot.
            </span>
          </span>
          <Switch checked={values.hasTimeslots} onCheckedChange={(v) => set("hasTimeslots", v)} />
        </label>
        {values.hasTimeslots ? (
          <>
            <div className="space-y-2">
              <span className="block text-sm font-medium">Timeslot grid</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["time_rows", "Times down, locations across", "e.g. interviews"],
                    ["location_rows", "Locations down, times across", "e.g. dinners"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("slotGrid", value)}
                    className={cn(
                      "rounded-lg border p-3 text-left text-sm transition-colors",
                      values.slotGrid === value ? "border-primary bg-primary/5" : "hover:bg-muted",
                    )}
                  >
                    <span className="block font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">Actives can take multiple slots</span>
                <span className="block text-xs text-muted-foreground">PNMs always get one slot per event.</span>
              </span>
              <Switch checked={values.activesMultiSlot} onCheckedChange={(v) => set("activesMultiSlot", v)} />
            </label>
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">Only admins can change signups</span>
                <span className="block text-xs text-muted-foreground">
                  When off, people can switch or cancel until the cutoff below.
                </span>
              </span>
              <Switch
                checked={values.selfChangeMode === "admin_only"}
                onCheckedChange={(v) => set("selfChangeMode", v ? "admin_only" : "cutoff")}
              />
            </label>
            {values.selfChangeMode === "cutoff" ? (
              <div className="flex items-center gap-3">
                <Label htmlFor="ev-cutoff" className="shrink-0 text-sm">
                  Change cutoff
                </Label>
                <Input
                  id="ev-cutoff"
                  type="number"
                  min={0}
                  className="w-28"
                  value={values.changeCutoffMinutes}
                  onChange={(e) => set("changeCutoffMinutes", e.target.value)}
                />
                <span className="text-sm text-muted-foreground">minutes before the slot (0 = until it starts)</span>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
