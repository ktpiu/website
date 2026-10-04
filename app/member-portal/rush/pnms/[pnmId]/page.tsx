"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Mail, Pencil, Phone, UserCheck, Vote } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageDeliberation, canManageRush, canViewRush } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { NativeSelect } from "@/components/rush/native-select";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { AccessRequired } from "@/components/member-portal/rush/shared";
import { GroupBadge } from "@/components/member-portal/rush/pnm-badges";
import {
  ApplicationsCard,
  AttendanceCard,
  ResponsesCard,
  type DossierApplication,
  type DossierAttendance,
  type DossierResponses,
} from "@/components/member-portal/rush/dossier-view";
import { VoteBreakdown } from "@/components/member-portal/rush/vote-breakdown";
import { errorMessage, formatDateTime, rushFetch } from "@/lib/rush/client";
import { GROUP_LABELS, STAGE_LABELS, STATUS_LABELS, type DelibGroup, type PnmStatus, type RushStage } from "@/lib/rush/types";

type Dossier = {
  pnm: {
    id: string;
    name: string;
    email: string;
    isIuEmail: boolean;
    phone: string | null;
    major: string | null;
    gradYear: number | null;
    status: PnmStatus;
    photoUrl: string | null;
    hasAccount: boolean;
    createdAt: string;
  };
  entries: Array<{ cycleId: string; cycleLabel: string; stage: RushStage; group: DelibGroup; outcome: string | null }>;
  attendance: DossierAttendance;
  applications: DossierApplication[];
  responses: DossierResponses;
  votes?: Array<{
    id: string;
    cycleLabel: string;
    stage: RushStage;
    openedAt: string;
    closedAt: string | null;
    status: string;
    yes: number;
    no: number;
    abstain: number;
  }>;
};

export default function PnmDetailPage({ params }: { params: Promise<{ pnmId: string }> }) {
  const { pnmId } = use(params);
  const { permissions } = useAuthStore();
  const canView = canViewRush(permissions);
  const canManage = canManageRush(permissions);
  const canDeliberate = canManageDeliberation(permissions);
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", major: "", gradYear: "", status: "open" });

  const query = useQuery({
    queryKey: ["rush", "pnm", pnmId],
    enabled: canView,
    queryFn: () => rushFetch<Dossier>(`/api/rush/pnms/${pnmId}`),
  });

  if (!canView) return <AccessRequired what="view PNMs" />;
  if (query.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 pt-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (query.error) return <p className="p-6 text-sm text-destructive">{errorMessage(query.error)}</p>;

  const { pnm, entries, attendance, applications, responses, votes } = query.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rush"] });

  const openEdit = () => {
    setForm({
      name: pnm.name,
      email: pnm.email,
      phone: pnm.phone ?? "",
      major: pnm.major ?? "",
      gradYear: pnm.gradYear ? String(pnm.gradYear) : "",
      status: pnm.status,
    });
    setEditOpen(true);
  };

  const save = async () => {
    try {
      await rushFetch(`/api/rush/pnms/${pnm.id}`, {
        method: "PATCH",
        json: { ...form, gradYear: form.gradYear || null },
      });
      toast.success("PNM updated.");
      setEditOpen(false);
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const sendSetup = async () => {
    try {
      await rushFetch(`/api/rush/pnms/${pnm.id}/setup-email`, { method: "POST" });
      toast.success(`Setup link sent to ${pnm.email}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const setGroup = async (cycleId: string, group: DelibGroup) => {
    try {
      await rushFetch(`/api/rush/pnms/${pnm.id}/group`, { method: "PATCH", json: { cycleId, group } });
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mt-1">
        <Link href="/member-portal/rush/pnms">
          <ArrowLeft className="mr-1 h-4 w-4" /> All PNMs
        </Link>
      </Button>

      <Card>
        <CardContent className="flex flex-wrap items-start gap-5 pt-6">
          <PnmAvatar name={pnm.name} src={pnm.photoUrl} className="h-24 w-24 text-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{pnm.name}</h1>
              <Badge variant="secondary">{STATUS_LABELS[pnm.status]}</Badge>
              {pnm.hasAccount ? (
                <Badge variant="outline" className="gap-1">
                  <UserCheck className="h-3 w-3" /> Account
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <a href={`mailto:${pnm.email}`} className="flex items-center gap-1.5 hover:underline">
                <Mail className="h-4 w-4" /> {pnm.email}
              </a>
              {pnm.phone ? (
                <a href={`tel:${pnm.phone}`} className="flex items-center gap-1.5 hover:underline">
                  <Phone className="h-4 w-4" /> {pnm.phone}
                </a>
              ) : null}
              {pnm.major ? <span>{pnm.major}</span> : null}
              {pnm.gradYear ? <span>Class of {pnm.gradYear}</span> : null}
            </div>
            {!pnm.isIuEmail ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Not an @iu.edu email
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">First seen {formatDateTime(pnm.createdAt)}</p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {!pnm.hasAccount ? (
                <Button variant="outline" size="sm" onClick={sendSetup}>
                  Send account link
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={openEdit}>
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rush cycles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.cycleId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {entry.cycleLabel} · {STAGE_LABELS[entry.stage]}
                {entry.outcome ? <span className="text-muted-foreground"> · {entry.outcome}</span> : null}
              </span>
              {canDeliberate ? (
                <NativeSelect
                  className="w-36"
                  value={entry.group}
                  onChange={(e) => setGroup(entry.cycleId, e.target.value as DelibGroup)}
                  aria-label={`Group for ${entry.cycleLabel}`}
                >
                  {Object.entries(GROUP_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <GroupBadge group={entry.group} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {votes ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Vote className="h-4 w-4" /> Voting history
              <Badge variant="outline" className="font-normal">
                Deliberation admins only
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {votes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No votes yet.</p>
            ) : (
              votes.map((v) => (
                <div key={v.id} className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {v.cycleLabel} {STAGE_LABELS[v.stage].toLowerCase()} · {formatDateTime(v.openedAt)}
                    {v.status === "open" ? " · voting open" : ""}
                  </p>
                  <VoteBreakdown yes={v.yes} no={v.no} abstain={v.abstain} compact />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <AttendanceCard attendance={attendance} />
        <ApplicationsCard applications={applications} />
      </div>
      <ResponsesCard responses={responses} />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit PNM</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["name", "Name"],
                ["email", "Email"],
                ["phone", "Phone"],
                ["major", "Major"],
                ["gradYear", "Graduation year"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`edit-${key}`}>{label}</Label>
                <Input
                  id={`edit-${key}`}
                  value={form[key]}
                  disabled={key === "email" && pnm.hasAccount}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <NativeSelect id="edit-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
