"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnswerList } from "@/components/rush/forms/form-renderer";
import { formatDateTime, formatDay } from "@/lib/rush/client";
import type { RushAnswers, RushFormField } from "@/lib/rush/types";

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
  entries: Array<{ id: string; author: string | null; createdAt: string; answers: RushAnswers }>;
}>;

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
                {group.templateName} <span className="font-normal text-muted-foreground">({group.entries.length})</span>
              </h3>
              <div className="space-y-3">
                {group.entries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border bg-muted/30 p-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      {entry.author ?? "Anonymous"} · {formatDateTime(entry.createdAt)}
                    </p>
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
