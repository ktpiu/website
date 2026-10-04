"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageRush } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { FormRenderer } from "@/components/rush/forms/form-renderer";
import { CycleSelect, NoCycle, RushPageHeader, useSelectedCycle } from "@/components/member-portal/rush/shared";
import { ApiError, errorMessage, formatDateTime, rushFetch } from "@/lib/rush/client";
import { validateAnswers, type RushAnswers, type RushFormTemplate } from "@/lib/rush/types";

type DirectoryPnm = { id: string; name: string; photoUrl: string | null };
type MyResponse = {
  id: string;
  templateId: string;
  templateName: string;
  cycleId: string;
  pnmId: string;
  pnmName: string;
  answers: RushAnswers;
  createdAt: string;
  updatedAt: string;
};

export default function RushFormsPage() {
  const { permissions } = useAuthStore();
  const { cycle, cycleParam, isPending: cyclesPending } = useSelectedCycle();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [pnm, setPnm] = useState<DirectoryPnm | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<RushAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<MyResponse | null>(null);
  const [editAnswers, setEditAnswers] = useState<RushAnswers>({});
  const [tab, setTab] = useState("new");

  const directory = useQuery({
    queryKey: ["rush", "directory", cycleParam],
    placeholderData: keepPreviousData,
    queryFn: () => rushFetch<{ pnms: DirectoryPnm[] }>(`/api/rush/pnms/directory?cycleId=${cycleParam}`).then((r) => r.pnms),
  });
  const templates = useQuery({
    queryKey: ["rush", "templates", "evaluation", cycleParam],
    queryFn: () =>
      rushFetch<{ templates: RushFormTemplate[] }>(`/api/rush/templates?cycleId=${cycleParam}`).then((r) =>
        r.templates.filter((t) => t.kind === "evaluation" && t.is_active),
      ),
  });
  const mine = useQuery({
    queryKey: ["rush", "responses", "mine", cycleParam],
    placeholderData: keepPreviousData,
    queryFn: () => rushFetch<{ responses: MyResponse[] }>(`/api/rush/responses?cycleId=${cycleParam}`).then((r) => r.responses),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (directory.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [directory.data, search]);

  const template = templates.data?.find((t) => t.id === templateId) ?? null;
  const editTemplate = editing ? templates.data?.find((t) => t.id === editing.templateId) : null;

  const reset = () => {
    setTemplateId(null);
    setAnswers({});
    setFieldErrors({});
  };

  const submit = async () => {
    if (!template || !pnm || !cycle) return;
    const errors = validateAnswers(template.fields, answers);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setSubmitting(true);
    try {
      await rushFetch("/api/rush/responses", {
        method: "POST",
        json: { templateId: template.id, pnmId: pnm.id, cycleId: cycle.id, answers },
      });
      toast.success(`${template.name} submitted for ${pnm.name}.`);
      setAnswers({});
      setFieldErrors({});
      setPnm(null);
      await queryClient.invalidateQueries({ queryKey: ["rush", "responses"] });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSubmitting(true);
    try {
      await rushFetch(`/api/rush/responses/${editing.id}`, { method: "PATCH", json: { answers: editAnswers } });
      toast.success("Submission updated.");
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["rush", "responses"] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (response: MyResponse) => {
    if (!window.confirm(`Delete your ${response.templateName} for ${response.pnmName}?`)) return;
    try {
      await rushFetch(`/api/rush/responses/${response.id}`, { method: "DELETE" });
      toast.success("Submission deleted.");
      await queryClient.invalidateQueries({ queryKey: ["rush", "responses"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <RushPageHeader
        title="PNM Forms"
        description="Share red flags, standouts, conflicts and evaluations with the rush committee."
        actions={<CycleSelect />}
      />

      {cyclesPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !cycle ? (
        <NoCycle canCreate={canManageRush(permissions)} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="new">New submission</TabsTrigger>
            <TabsTrigger value="mine">My submissions{mine.data?.length ? ` (${mine.data.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="pt-4">
            {!template ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Choose a form to fill out.</p>
                {templates.isPending ? (
                  <Skeleton className="h-32 rounded-xl" />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(templates.data ?? []).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTemplateId(t.id);
                          setAnswers({});
                          setFieldErrors({});
                        }}
                        className="flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-muted/40"
                      >
                        <span className="font-semibold">{t.name}</span>
                        {t.description ? <span className="text-sm text-muted-foreground">{t.description}</span> : null}
                        <span className="mt-auto pt-1 text-xs text-muted-foreground">
                          {t.fields.length} question{t.fields.length === 1 ? "" : "s"}
                          {t.hide_author_in_deliberation ? " · anonymous in deliberation" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Card>
                <CardHeader className="space-y-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 w-fit"
                    onClick={() => {
                      reset();
                      setPnm(null);
                    }}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" /> All forms
                  </Button>
                  <div>
                    <CardTitle>{template.name}</CardTitle>
                    {template.description ? <CardDescription>{template.description}</CardDescription> : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {pnm ? (
                    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
                      <PnmAvatar name={pnm.name} src={pnm.photoUrl} className="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">About</p>
                        <p className="truncate text-lg font-semibold">{pnm.name}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setPnm(null)}>
                        Change
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-xl border p-3">
                      <p className="text-sm font-medium">Which PNM is this about?</p>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          autoFocus
                          placeholder="Search PNMs"
                          className="pl-8"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      {directory.isPending ? (
                        <Skeleton className="h-24" />
                      ) : filtered.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No PNMs found{cycle ? ` in ${cycle.label}` : ""}.</p>
                      ) : (
                        <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                          {filtered.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setPnm(p);
                                setSearch("");
                              }}
                              className="flex items-center gap-2.5 rounded-lg border p-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted"
                            >
                              <PnmAvatar name={p.name} src={p.photoUrl} className="h-8 w-8" />
                              <span className="truncate font-medium">{p.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <FormRenderer fields={template.fields} values={answers} onChange={setAnswers} errors={fieldErrors} />
                  <p className="text-xs text-muted-foreground">
                    {template.hide_author_in_deliberation
                      ? "Your name is visible to the rush committee but hidden during deliberation."
                      : "Your name is visible to the rush committee and during deliberation."}
                  </p>
                  <Button onClick={submit} disabled={submitting || !pnm}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {pnm ? `Submit for ${pnm.name.split(" ")[0]}` : "Choose a PNM to submit"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="mine" className="pt-4">
            {mine.isPending ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : (mine.data ?? []).length === 0 ? (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                You haven&apos;t submitted any forms for {cycle.label}.
              </p>
            ) : (
              <div className="divide-y rounded-xl border bg-card">
                {mine.data!.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">
                        {r.templateName} · {r.pnmName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Submitted {formatDateTime(r.createdAt)}
                        {r.updatedAt !== r.createdAt ? ` · edited ${formatDateTime(r.updatedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(r);
                          setEditAnswers(r.answers);
                        }}
                      >
                        <Pencil className="mr-1 h-4 w-4" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing?.templateName} · {editing?.pnmName}
            </DialogTitle>
          </DialogHeader>
          {editTemplate ? (
            <FormRenderer fields={editTemplate.fields} values={editAnswers} onChange={setEditAnswers} />
          ) : (
            <p className="text-sm text-muted-foreground">This form is no longer active and can&apos;t be edited.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={submitting || !editTemplate}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
