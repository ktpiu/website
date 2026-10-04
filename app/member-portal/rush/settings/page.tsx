"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { NativeSelect } from "@/components/rush/native-select";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { FormBuilder, type TemplateDraft } from "@/components/rush/forms/form-builder";
import { AccessRequired, RushPageHeader, useRushCycles } from "@/components/member-portal/rush/shared";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { PHASE_LABELS, type RushFormTemplate } from "@/lib/rush/types";

type Contact = {
  id: string;
  user_id: string;
  title: string;
  public_email: string | null;
  public_phone: string | null;
  sort_order: number;
  users: { name: string; avatar: string | null } | null;
};

const currentYear = new Date().getFullYear();

export default function RushSettingsPage() {
  const { permissions } = useAuthStore();
  const canManage = canManageRush(permissions);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rush"] });

  const cycles = useRushCycles();
  const templates = useQuery({
    queryKey: ["rush", "templates", "all"],
    enabled: canManage,
    queryFn: () => rushFetch<{ templates: RushFormTemplate[] }>("/api/rush/templates").then((r) => r.templates),
  });
  const contacts = useQuery({
    queryKey: ["rush", "contacts"],
    enabled: canManage,
    queryFn: () => rushFetch<{ contacts: Contact[] }>("/api/rush/contacts").then((r) => r.contacts),
  });
  const members = useQuery({
    queryKey: ["rush", "members"],
    enabled: canManage,
    staleTime: 5 * 60_000,
    queryFn: () =>
      rushFetch<{ members: Array<{ id: string; name: string; email: string }> }>("/api/rush/members").then((r) => r.members),
  });

  const [newCycle, setNewCycle] = useState({ term: "fall", year: String(currentYear) });
  const [editing, setEditing] = useState<{ id: string | null; draft: TemplateDraft } | null>(null);
  const [contactEdit, setContactEdit] = useState<{ id: string | null; userId: string; title: string; publicEmail: string; publicPhone: string } | null>(null);

  if (!canManage) return <AccessRequired what="manage rush settings" />;

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      refresh();
    }
  };

  const applicationTemplates = (templates.data ?? []).filter((t) => t.kind === "application");
  const evaluationTemplates = (templates.data ?? []).filter((t) => t.kind === "evaluation");

  const saveTemplate = async () => {
    if (!editing) return;
    const ok = await run(
      () =>
        editing.id
          ? rushFetch(`/api/rush/templates/${editing.id}`, { method: "PATCH", json: editing.draft })
          : rushFetch("/api/rush/templates", { method: "POST", json: editing.draft }),
      "Form saved.",
    );
    if (ok) setEditing(null);
  };

  const saveContact = async () => {
    if (!contactEdit) return;
    const json = { userId: contactEdit.userId, title: contactEdit.title, publicEmail: contactEdit.publicEmail, publicPhone: contactEdit.publicPhone };
    const ok = await run(
      () =>
        contactEdit.id
          ? rushFetch(`/api/rush/contacts/${contactEdit.id}`, { method: "PATCH", json })
          : rushFetch("/api/rush/contacts", { method: "POST", json }),
      "Contact saved.",
    );
    if (ok) setContactEdit(null);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <RushPageHeader title="Rush Settings" description="Rush cycles, forms and the contacts shown on the public rush page." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rush cycles</CardTitle>
          <CardDescription>
            One cycle per semester. Its phase drives the public rush page: applications are only accepted during open
            rush. PNMs move from open to closed rush from the PNMs page or deliberation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cycles.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="divide-y rounded-lg border">
              {(cycles.data ?? []).map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {c.is_active ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="Current cycle" aria-label="Current cycle" />
                    ) : null}
                    <p className="font-medium">{c.label}</p>
                  </div>
                  <NativeSelect
                    className="w-36"
                    value={c.phase}
                    onChange={(e) =>
                      run(() => rushFetch(`/api/rush/cycles/${c.id}`, { method: "PATCH", json: { phase: e.target.value } }))
                    }
                    aria-label={`${c.label} phase`}
                  >
                    {Object.entries(PHASE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                  {c.phase === "open" ? (
                    <>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={c.applications_open}
                          onCheckedChange={(v) => run(() => rushFetch(`/api/rush/cycles/${c.id}`, { method: "PATCH", json: { applicationsOpen: v } }))}
                        />
                        Applications open
                      </label>
                      <NativeSelect
                        className="w-44"
                        value={c.application_template_id ?? ""}
                        onChange={(e) =>
                          run(() => rushFetch(`/api/rush/cycles/${c.id}`, { method: "PATCH", json: { applicationTemplateId: e.target.value || null } }))
                        }
                        aria-label="Application form"
                      >
                        <option value="">Default application</option>
                        {applicationTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </>
                  ) : null}
                  {!c.is_active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => run(() => rushFetch(`/api/rush/cycles/${c.id}`, { method: "PATCH", json: { isActive: true } }), `${c.label} is now current.`)}
                    >
                      Make current
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Term</Label>
              <NativeSelect className="w-28" value={newCycle.term} onChange={(e) => setNewCycle((c) => ({ ...c, term: e.target.value }))}>
                <option value="fall">Fall</option>
                <option value="spring">Spring</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Year</Label>
              <Input className="w-24" type="number" value={newCycle.year} onChange={(e) => setNewCycle((c) => ({ ...c, year: e.target.value }))} />
            </div>
            <Button
              variant="outline"
              onClick={() => run(() => rushFetch("/api/rush/cycles", { method: "POST", json: { ...newCycle, year: Number(newCycle.year) } }), "Cycle created.")}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add cycle
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Forms</CardTitle>
            <CardDescription>Evaluation forms actives fill out, and the public application.</CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() =>
              setEditing({
                id: null,
                draft: { name: "", description: "", kind: "evaluation", hideAuthorInDeliberation: false, isActive: true, submissionMode: "single", participantRoles: [], fields: [] },
              })
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> New form
          </Button>
        </CardHeader>
        <CardContent>
          {templates.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="divide-y rounded-lg border">
              {[...evaluationTemplates, ...applicationTemplates].map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t.name}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {t.kind === "application" ? "Application" : "Evaluation"} · {t.fields.length} questions
                      </span>
                    </p>
                  </div>
                  {t.submission_mode === "multiple" ? <Badge variant="secondary">Multi-person</Badge> : null}
                  {!t.is_active ? <Badge variant="outline">Archived</Badge> : null}
                  {t.kind === "evaluation" && t.is_active ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={t.is_open}
                        onCheckedChange={(isOpen) =>
                          run(
                            () => rushFetch(`/api/rush/templates/${t.id}/open`, { method: "PATCH", json: { isOpen } }),
                            isOpen ? `${t.name} is open.` : `${t.name} is closed.`,
                          )
                        }
                      />
                      {t.is_open ? "Open" : "Closed"}
                    </label>
                  ) : null}
                  {t.hide_author_in_deliberation ? <Badge variant="secondary">Anonymous</Badge> : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Edit ${t.name}`}
                    onClick={() =>
                      setEditing({
                        id: t.id,
                        draft: {
                          name: t.name,
                          description: t.description,
                          kind: t.kind,
                          hideAuthorInDeliberation: t.hide_author_in_deliberation,
                          isActive: t.is_active,
                          submissionMode: t.submission_mode,
                          participantRoles: t.participant_roles,
                          fields: t.fields,
                        },
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${t.name}"? Forms with responses are archived instead.`)) {
                        run(() => rushFetch(`/api/rush/templates/${t.id}`, { method: "DELETE" }));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Rush contacts</CardTitle>
            <CardDescription>Shown on the public rush page. Only the email and phone you enter here are public.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setContactEdit({ id: null, userId: "", title: "Rush Director", publicEmail: "", publicPhone: "" })}>
            <Plus className="mr-1.5 h-4 w-4" /> Add contact
          </Button>
        </CardHeader>
        <CardContent>
          {(contacts.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {contacts.data!.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <PnmAvatar name={c.users?.name ?? ""} src={c.users?.avatar} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{c.users?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[c.title, c.public_email, c.public_phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Edit contact"
                    onClick={() =>
                      setContactEdit({
                        id: c.id,
                        userId: c.user_id,
                        title: c.title,
                        publicEmail: c.public_email ?? "",
                        publicPhone: c.public_phone ?? "",
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Remove contact"
                    onClick={() => run(() => rushFetch(`/api/rush/contacts/${c.id}`, { method: "DELETE" }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit form" : "New form"}</DialogTitle>
          </DialogHeader>
          {editing ? <FormBuilder draft={editing.draft} onChange={(draft) => setEditing((e) => e && { ...e, draft })} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveTemplate} disabled={!editing?.draft.name.trim() || editing.draft.fields.length === 0}>
              Save form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(contactEdit)} onOpenChange={(open) => !open && setContactEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{contactEdit?.id ? "Edit contact" : "Add contact"}</DialogTitle>
          </DialogHeader>
          {contactEdit ? (
            <div className="space-y-4">
              {!contactEdit.id ? (
                <div className="space-y-2">
                  <Label htmlFor="contact-user">Member</Label>
                  <NativeSelect
                    id="contact-user"
                    value={contactEdit.userId}
                    onChange={(e) => {
                      const member = members.data?.find((m) => m.id === e.target.value);
                      setContactEdit((c) => c && { ...c, userId: e.target.value, publicEmail: c.publicEmail || member?.email || "" });
                    }}
                  >
                    <option value="">Choose a member…</option>
                    {(members.data ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              {(
                [
                  ["title", "Title"],
                  ["publicEmail", "Public email"],
                  ["publicPhone", "Public phone (optional)"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`contact-${key}`}>{label}</Label>
                  <Input
                    id={`contact-${key}`}
                    value={contactEdit[key]}
                    onChange={(e) => setContactEdit((c) => c && { ...c, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactEdit(null)}>
              Cancel
            </Button>
            <Button onClick={saveContact} disabled={!contactEdit?.userId}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
