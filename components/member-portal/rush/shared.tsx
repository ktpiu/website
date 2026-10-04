"use client";

import { useEffect } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { rushFetch } from "@/lib/rush/client";
import type { RushCycle } from "@/lib/rush/types";

/** The cycle the member is looking at across rush pages (defaults to the active one). */
const useCycleStore = create<{ cycleId: string | null; setCycleId: (id: string | null) => void }>()(
  persist((set) => ({ cycleId: null, setCycleId: (cycleId) => set({ cycleId }) }), {
    name: "ktp-rush-cycle",
  }),
);

/** Same as useSelectedCycle().cycleParam, without loading the cycle list. */
export function useCycleParam() {
  return useCycleStore((state) => state.cycleId) ?? "current";
}

/**
 * Warms the data a rush page needs (same query keys the pages use), so
 * hovering a sidebar link makes the page appear already loaded.
 */
export function prefetchRushPage(queryClient: QueryClient, href: string, cycleParam: string) {
  const prefetch = (queryKey: unknown[], url: string, pick?: (body: Record<string, unknown>) => unknown) =>
    queryClient.prefetchQuery({
      queryKey,
      staleTime: 10_000,
      queryFn: () => rushFetch<Record<string, unknown>>(url).then((body) => (pick ? pick(body) : body)),
    });

  prefetch(["rush", "cycles"], "/api/rush/cycles", (b) => b.cycles);
  if (href.endsWith("/schedule") || href.endsWith("/events")) {
    prefetch(["rush", "events", cycleParam], `/api/rush/events?cycleId=${cycleParam}`);
  } else if (href.endsWith("/pnms")) {
    prefetch(["rush", "pnms", cycleParam], `/api/rush/pnms?cycleId=${cycleParam}`);
  } else if (href.endsWith("/deliberation")) {
    prefetch(["rush", "deliberation"], "/api/rush/deliberation/current");
  } else if (href.endsWith("/forms")) {
    prefetch(["rush", "directory", cycleParam], `/api/rush/pnms/directory?cycleId=${cycleParam}`, (b) => b.pnms);
    prefetch(["rush", "responses", "mine", cycleParam], `/api/rush/responses?cycleId=${cycleParam}`, (b) => b.responses);
  }
}

export function useRushCycles() {
  return useQuery({
    queryKey: ["rush", "cycles"],
    queryFn: () => rushFetch<{ cycles: RushCycle[] }>("/api/rush/cycles").then((r) => r.cycles),
    staleTime: 60_000,
  });
}

/**
 * The cycle being viewed. `cycleParam` is usable immediately (the saved id,
 * or "current" for the active cycle) so page queries don't wait on the cycle
 * list to load first.
 */
export function useSelectedCycle() {
  const cycles = useRushCycles();
  const { cycleId, setCycleId } = useCycleStore();
  const list = cycles.data ?? [];
  const selected = list.find((c) => c.id === cycleId) ?? list.find((c) => c.is_active) ?? list[0] ?? null;

  useEffect(() => {
    if (cycles.data && cycleId && !cycles.data.some((c) => c.id === cycleId)) setCycleId(null);
  }, [cycles.data, cycleId, setCycleId]);

  return {
    cycles: list,
    cycle: selected,
    cycleParam: cycleId ?? "current",
    setCycleId,
    isPending: cycles.isPending,
  };
}

function CurrentDot({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500", className)}
      aria-label="Current cycle"
      title="Current cycle"
    />
  );
}

export function CycleSelect({ className }: { className?: string }) {
  const { cycles, cycle, setCycleId } = useSelectedCycle();
  if (cycles.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn("justify-between gap-2", className ?? "w-48")}>
          <span className="flex items-center gap-2 truncate">
            {cycle?.is_active ? <CurrentDot /> : null}
            {cycle?.label ?? "Choose cycle"}
          </span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup value={cycle?.id ?? ""} onValueChange={setCycleId}>
          {cycles.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id} className="justify-between">
              {c.label}
              {c.is_active ? <CurrentDot className="ml-auto" /> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RushPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6 pt-2">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AccessRequired({ what }: { what: string }) {
  return (
    <div className="p-4 md:p-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Access required</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You don&apos;t have permission to {what}. Ask the VP of Membership or Rush Director if you need access.
        </CardContent>
      </Card>
    </div>
  );
}

export function NoCycle({ canCreate }: { canCreate: boolean }) {
  return (
    <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      No rush cycle has been set up yet.
      {canCreate ? " Create one under Rush → Settings." : ""}
    </p>
  );
}
