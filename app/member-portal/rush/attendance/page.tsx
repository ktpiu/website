"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canViewActiveAttendance } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AttendanceMark } from "@/components/rush/attendance-mark";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { AccessRequired, CycleSelect, NoCycle, RushPageHeader, useSelectedCycle } from "@/components/member-portal/rush/shared";
import { errorMessage, formatDay, rushFetch } from "@/lib/rush/client";
import type { AttendanceStatus } from "@/lib/rush/types";

type ActiveAttendance = {
  cycle: { id: string; label: string } | null;
  events: Array<{ id: string; title: string; startsAt: string; attendanceEnabled: boolean }>;
  actives: Array<{
    userId: string;
    name: string;
    avatar: string | null;
    events: Record<string, { signedUp: boolean; status: AttendanceStatus | null }>;
  }>;
};

export default function ActiveAttendancePage() {
  const { permissions } = useAuthStore();
  const allowed = canViewActiveAttendance(permissions);
  const { cycleParam, isPending: cyclesPending } = useSelectedCycle();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const queryKey = ["rush", "attendance", "actives", cycleParam];

  const query = useQuery({
    queryKey,
    enabled: allowed,
    placeholderData: keepPreviousData,
    queryFn: () => rushFetch<ActiveAttendance>(`/api/rush/attendance/actives?cycleId=${cycleParam}`),
  });

  const data = query.data;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.actives ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [data, search]);

  if (!allowed) return <AccessRequired what="view active attendance" />;

  const mark = async (userId: string, eventId: string, status: AttendanceStatus | null) => {
    setBusy(true);
    try {
      await rushFetch(`/api/rush/events/${eventId}/mark`, { method: "POST", json: { userId, status } });
      await queryClient.invalidateQueries({ queryKey: ["rush", "attendance"] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const totals = (a: ActiveAttendance["actives"][number]) => {
    const values = Object.values(a.events);
    return {
      attended: values.filter((v) => v.status === "present" || v.status === "late").length,
      noShows: values.filter((v) => v.status === "no_show").length,
      signedUp: values.filter((v) => v.signedUp).length,
    };
  };

  return (
    <div className="mx-auto max-w-6xl">
      <RushPageHeader
        title="Active Attendance"
        description="Track which actives came to rush events. Actives can also check in with the QR code while signed in."
        actions={<CycleSelect />}
      />
      {cyclesPending || query.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !data?.cycle ? (
        <NoCycle canCreate={false} />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search actives…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {data.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events in this cycle yet.</p>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="sticky left-0 z-10 min-w-48 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">Active</th>
                      <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Total</th>
                      {data.events.map((e) => (
                        <th key={e.id} className="min-w-36 border-l px-3 py-2 text-xs font-semibold">
                          {e.title}
                          <span className="block font-normal text-muted-foreground">{formatDay(e.startsAt)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => {
                      const t = totals(a);
                      return (
                        <tr key={a.userId} className="border-t">
                          <td className="sticky left-0 z-10 bg-background px-3 py-2">
                            <span className="flex items-center gap-2">
                              <PnmAvatar name={a.name} src={a.avatar} className="h-6 w-6" />
                              {a.name}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                            {t.attended} attended
                            {t.noShows ? <Badge variant="destructive" className="ml-1.5 px-1.5 text-[10px]">{t.noShows} no-show</Badge> : null}
                          </td>
                          {data.events.map((e) => {
                            const cell = a.events[e.id];
                            return (
                              <td key={e.id} className="border-l px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <AttendanceMark
                                    value={cell?.status ?? null}
                                    disabled={busy}
                                    onChange={(status) => mark(a.userId, e.id, status)}
                                  />
                                  {cell?.signedUp ? <span className="text-[10px] text-muted-foreground">signed up</span> : null}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
