"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/rush/native-select";
import { FIELD_TYPE_LABELS, type ParticipantRole, type PeopleSource, type RushFieldType, type RushFormField } from "@/lib/rush/types";

export type TemplateDraft = {
  name: string;
  description: string;
  kind: "evaluation" | "application";
  hideAuthorInDeliberation: boolean;
  isActive: boolean;
  submissionMode: "single" | "multiple";
  participantRoles: ParticipantRole[];
  fields: RushFormField[];
};

function newFieldId() {
  return `q_${Math.random().toString(36).slice(2, 8)}`;
}

/** Edits a form template: name, settings and an ordered list of questions. */
export function FormBuilder({ draft, onChange }: { draft: TemplateDraft; onChange: (draft: TemplateDraft) => void }) {
  const setField = (index: number, patch: Partial<RushFormField>) =>
    onChange({ ...draft, fields: draft.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) });
  const move = (index: number, delta: number) => {
    const fields = [...draft.fields];
    const [item] = fields.splice(index, 1);
    fields.splice(index + delta, 0, item);
    onChange({ ...draft, fields });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tpl-name">Form name</Label>
          <Input id="tpl-name" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-kind">Type</Label>
          <NativeSelect
            id="tpl-kind"
            value={draft.kind}
            onChange={(e) => onChange({ ...draft, kind: e.target.value as TemplateDraft["kind"] })}
          >
            <option value="evaluation">Evaluation (filled by actives)</option>
            <option value="application">Application (filled by PNMs)</option>
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="tpl-desc">Description</Label>
        <Textarea id="tpl-desc" rows={2} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.isActive} onCheckedChange={(v) => onChange({ ...draft, isActive: v })} />
          Active
        </label>
        {draft.kind === "evaluation" ? (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={draft.hideAuthorInDeliberation}
              onCheckedChange={(v) => onChange({ ...draft, hideAuthorInDeliberation: v })}
            />
            Hide author names during deliberation
          </label>
        ) : null}
      </div>

      {draft.kind === "evaluation" ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor="tpl-mode">Who submits</Label>
            <NativeSelect
              id="tpl-mode"
              value={draft.submissionMode}
              onChange={(e) => {
                const submissionMode = e.target.value as TemplateDraft["submissionMode"];
                onChange({
                  ...draft,
                  submissionMode,
                  participantRoles:
                    submissionMode === "multiple" && draft.participantRoles.length === 0
                      ? [{ id: newFieldId(), label: "Actives in the room", required: true }]
                      : draft.participantRoles,
                });
              }}
            >
              <option value="single">One person submits their own</option>
              <option value="multiple">Several people share one submission (e.g. interviews)</option>
            </NativeSelect>
          </div>
          {draft.submissionMode === "multiple" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                The submitter picks who was in the room for each role. One submission counts once toward averages.
              </p>
              {draft.participantRoles.map((role, index) => (
                <div key={role.id} className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-40 flex-1"
                    placeholder="Role, e.g. Interviewers"
                    value={role.label}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        participantRoles: draft.participantRoles.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)),
                      })
                    }
                  />
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch
                      checked={role.required}
                      onCheckedChange={(required) =>
                        onChange({
                          ...draft,
                          participantRoles: draft.participantRoles.map((r, i) => (i === index ? { ...r, required } : r)),
                        })
                      }
                    />
                    Required
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Remove role"
                    onClick={() => onChange({ ...draft, participantRoles: draft.participantRoles.filter((_, i) => i !== index) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({
                    ...draft,
                    participantRoles: [...draft.participantRoles, { id: newFieldId(), label: "", required: false }],
                  })
                }
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add role
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="text-sm font-medium">Questions</p>
        {draft.fields.map((field, index) => (
          <div key={field.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-48 flex-1"
                placeholder="Question"
                value={field.label}
                onChange={(e) => setField(index, { label: e.target.value })}
              />
              <NativeSelect
                className="w-40"
                value={field.type}
                onChange={(e) => {
                  const type = e.target.value as RushFieldType;
                  setField(index, {
                    type,
                    options: type === "select" ? field.options ?? ["Option 1", "Option 2"] : undefined,
                    people: type === "people" ? field.people ?? { source: "pnms", multiple: true } : undefined,
                  });
                }}
                aria-label="Answer type"
              >
                {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <label className="flex items-center gap-1.5 text-xs">
                <Switch checked={field.required} onCheckedChange={(v) => setField(index, { required: v })} />
                Required
              </label>
              <div className="flex">
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={index === draft.fields.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onChange({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}
                  aria-label="Remove question"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {field.type === "people" ? (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <NativeSelect
                  className="w-48"
                  aria-label="Who can be selected"
                  value={field.people?.source ?? "pnms"}
                  onChange={(e) =>
                    setField(index, {
                      people: { multiple: true, ...field.people, source: e.target.value as PeopleSource },
                    })
                  }
                >
                  <option value="pnms">PNMs in this cycle</option>
                  <option value="actives">Actives</option>
                  <option value="both">Actives and PNMs</option>
                </NativeSelect>
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch
                    checked={field.people?.multiple ?? true}
                    onCheckedChange={(multiple) =>
                      setField(index, { people: { source: "pnms", ...field.people, multiple } })
                    }
                  />
                  Allow several
                </label>
                {draft.kind === "evaluation" ? (
                  field.people?.source === "pnms" ? (
                    <label className="flex items-center gap-1.5 text-xs">
                      <Switch
                        checked={Boolean(field.people?.conflict)}
                        onCheckedChange={(conflict) =>
                          setField(index, { people: { source: "pnms", multiple: true, ...field.people, conflict } })
                        }
                      />
                      Report as conflicts of interest
                    </label>
                  ) : null
                ) : field.people?.source === "actives" ? (
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch
                      checked={Boolean(field.people?.conflict)}
                      onCheckedChange={(conflict) =>
                        setField(index, { people: { source: "actives", multiple: true, ...field.people, conflict } })
                      }
                    />
                    Report as conflicts of interest
                  </label>
                ) : null}
              </div>
            ) : null}
            {field.type === "select" ? (
              <Textarea
                rows={3}
                placeholder="One option per line"
                value={(field.options ?? []).join("\n")}
                onChange={(e) => setField(index, { options: e.target.value.split("\n") })}
              />
            ) : null}
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ ...draft, fields: [...draft.fields, { id: newFieldId(), label: "", type: "text", required: false }] })
          }
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add question
        </Button>
      </div>
    </div>
  );
}
