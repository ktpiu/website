"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, Clock, UserCheck, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnswerList } from "@/components/rush/forms/form-renderer";
import { formatDateTime, formatDay } from "@/lib/rush/client";
import { ATTENDANCE_LABELS, type AttendanceStatus, type RushAnswers, type RushFormField } from "@/lib/rush/types";
import { cn } from "@/lib/utils";

export type DossierAttendance = Array<{ id: string; eventTitle: string; startsAt: string; cycleLabel: string; method: string }>;
export type DossierApplication = {
  id: string;
  cycleLabel: string;
  submittedAt: string;
  email: string;
  isIuEmail: boolean;
  fields: RushFormField[];
  answers: RushAnswers;
};
export type DossierResponses = Array<{
  templateId: string;
  templateName: string;
  fields: RushFormField[];
  eventId?: string | null;
  eventTitle?: string | null;
  averages?: Array<{ fieldId: string; label: string; average: number; count: number }>;
  entries: Array<{
    id: string;
    author: string | null;
    participants?: Array<{ name: string; role: string }>;
    createdAt: string;
    answers: RushAnswers;
  }>;
}>;

export type DossierDelibEvent = {
  eventId: string;
  title: string;
  startsAt: string;
  attendanceEnabled: boolean;
  pnmStatus: AttendanceStatus | null;
  signedUp: Array<{ userId: string; name: string; status: "attended" | "late" | "missed" | "unknown" }>;
  others: Array<{ userId: string; name: string }>;
};
export type DossierConflicts = Array<{ userId: string; name: string; reportedBy: Array<"A" | "PNM"> }>;

/** "A" / "PNM" chips showing who reported a conflict (both when both did). */
export function ConflictsCard({ conflicts }: { conflicts: DossierConflicts }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CircleAlert className="h-4 w-4 text-amber-500" /> Conflicts of interest ({conflicts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conflicts reported.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {conflicts.map((c) => (
              <li key={c.userId} className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="flex gap-1">
                  {c.reportedBy.map((by) => (
                    <Badge key={by} variant="outline" className="text-[10px]" title={by === "A" ? "Reported by the active" : "Reported by the PNM"}>
                      {by}
                    </Badge>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ACTIVE_STATUS = {
  attended: { icon: UserCheck, className: "text-emerald-600 dark:text-emerald-400", label: "Attended" },
  late: { icon: Clock, className: "text-amber-600 dark:text-amber-400", label: "Late" },
  missed: { icon: UserX, className: "text-destructive", label: "Didn't show up" },
  unknown: { icon: UserCheck, className: "text-muted-foreground", label: "Attendance not taken" },
} as const;

/** Who was at each dinner/interview: signed-up actives (green if they came, flagged if not) and other evaluators. */
export function EventRosterCard({ events }: { events: DossierDelibEvent[] }) {
  if (events.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Dinners & interviews</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {events.map((event) => (
          <div key={event.eventId} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{event.title}</h3>
              <span className="text-xs text-muted-foreground">{formatDay(event.startsAt)}</span>
              {event.pnmStatus ? (
                <Badge variant={event.pnmStatus === "no_show" ? "destructive" : "secondary"} className="text-[10px]">
                  PNM: {ATTENDANCE_LABELS[event.pnmStatus]}
                </Badge>
              ) : null}
            </div>
            {event.signedUp.length === 0 ? (
              <p className="text-xs text-muted-foreground">No actives signed up.</p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2">
                {event.signedUp.map((a) => {
                  const { icon: Icon, className, label } = ACTIVE_STATUS[a.status];
                  return (
                    <li key={a.userId} className="flex items-center gap-2 text-sm" title={label}>
                      <Icon className={cn("h-4 w-4 shrink-0", className)} aria-label={label} />
                      <span className={cn(a.status === "missed" && "text-muted-foreground line-through")}>{a.name}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {event.others.length > 0 ? (
              <div className="rounded-md border border-dashed p-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Also submitted an evaluation (not signed up)
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {event.others.map((a) => (
                    <Badge key={a.userId} variant="outline" className="gap-1 border-sky-500/50 text-sky-700 dark:text-sky-400">
                      <UserCheck className="h-3 w-3" /> {a.name}
                    </Badge>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AttendanceCard({ attendance }: { attendance: DossierAttendance }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Event attendance ({attendance.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {attendance.length === 0 ? (
          <p className="text-sm text-muted-foreground">No check-ins yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {attendance.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  {a.eventTitle}
                  {a.method !== "self" ? (
                    <Badge variant="outline" className="text-[10px]">
                      {a.method}
                    </Badge>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDay(a.startsAt)} · {a.cycleLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ApplicationsCard({ applications }: { applications: DossierApplication[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Application</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No application submitted.</p>
        ) : (
          applications.map((app) => (
            <div key={app.id} className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {app.cycleLabel} · submitted {formatDateTime(app.submittedAt)}
                {app.email ? ` · ${app.email}` : ""}
              </p>
              {!app.isIuEmail ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Applied with a non-IU email
                </p>
              ) : null}
              <AnswerList fields={app.fields} answers={app.answers} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function ResponsesCard({ responses }: { responses: DossierResponses }) {
  const total = responses.reduce((n, r) => n + r.entries.length, 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Forms & evaluations ({total})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No forms submitted about this PNM.</p>
        ) : (
          responses.map((group) => (
            <div key={group.templateId} className="space-y-3">
              <h3 className="text-sm font-semibold">
                {group.templateName}
                {group.eventTitle ? <span className="font-normal text-muted-foreground"> · {group.eventTitle}</span> : null}{" "}
                <span className="font-normal text-muted-foreground">({group.entries.length})</span>
              </h3>
              {group.averages && group.averages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {group.averages.map((avg) => (
                    <div key={avg.fieldId} className="rounded-md bg-primary/5 px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground">{avg.label}</span>{" "}
                      <span className="font-semibold">{avg.average.toFixed(1)}</span>
                      <span className="text-muted-foreground"> / 5{avg.count > 1 ? ` · ${avg.count} scores` : ""}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="space-y-3">
                {group.entries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border bg-muted/30 p-3">
                    <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {entry.author ?? <Badge variant="secondary">Anonymous</Badge>} · {formatDateTime(entry.createdAt)}
                    </p>
                    {entry.participants && entry.participants.length > 1 ? (
                      <p className="mb-2 text-xs text-muted-foreground">
                        In the room:{" "}
                        {entry.participants.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(", ")}
                      </p>
                    ) : null}
                    <AnswerList fields={group.fields} answers={entry.answers} />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
