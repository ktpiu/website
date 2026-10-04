"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/rush/native-select";
import { PeopleSelector } from "@/components/ui/people-selector";
import { usePeopleOptions } from "@/components/rush/forms/use-people-options";
import { cn } from "@/lib/utils";
import { formatAnswer, type RushAnswers, type RushFormField } from "@/lib/rush/types";

function PeopleQuestion({
  field,
  value,
  onChange,
  cycleId,
  publicMode,
  disabled,
  invalid,
  id,
}: {
  field: RushFormField;
  value: string[];
  onChange: (value: string[]) => void;
  cycleId?: string | null;
  publicMode?: boolean;
  disabled?: boolean;
  invalid: boolean;
  id: string;
}) {
  const config = field.people ?? { source: "pnms" as const, multiple: true };
  const { people, loading } = usePeopleOptions(config.source, cycleId, publicMode);
  return (
    <PeopleSelector
      id={id}
      options={people}
      value={value}
      onChange={onChange}
      multiple={config.multiple}
      loading={loading}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

/** Renders a form template's questions as controlled inputs. */
export function FormRenderer({
  fields,
  values,
  onChange,
  errors,
  disabled,
  cycleId,
  publicMode,
}: {
  fields: RushFormField[];
  values: RushAnswers;
  onChange: (values: RushAnswers) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Cycle whose PNMs the people selector offers. */
  cycleId?: string | null;
  /** Public application: people selectors only list active names. */
  publicMode?: boolean;
}) {
  const set = (id: string, value: RushAnswers[string] | undefined) => {
    const next = { ...values };
    if (value === undefined || value === "") delete next[id];
    else next[id] = value;
    onChange(next);
  };

  return (
    <div className="space-y-5">
      {fields.map((field) => {
        const id = `field-${field.id}`;
        const value = values[field.id];
        const error = errors?.[field.id];
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={id} className="leading-snug">
              {field.label}
              {field.required ? <span className="text-destructive"> *</span> : null}
            </Label>
            {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}

            {field.type === "text" && (
              <Input
                id={id}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(field.id, e.target.value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
              />
            )}
            {field.type === "textarea" && (
              <Textarea
                id={id}
                rows={4}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(field.id, e.target.value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
              />
            )}
            {field.type === "people" && (
              <PeopleQuestion
                id={id}
                field={field}
                value={Array.isArray(value) ? value : []}
                onChange={(next) => set(field.id, next.length ? next : undefined)}
                cycleId={cycleId}
                publicMode={publicMode}
                disabled={disabled}
                invalid={Boolean(error)}
              />
            )}
            {field.type === "select" && (
              <NativeSelect
                id={id}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(field.id, e.target.value)}
                disabled={disabled}
              >
                <option value="">Choose…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            )}
            {field.type === "rating" && (
              <div className="flex gap-2" role="radiogroup" aria-labelledby={id}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={value === n}
                    disabled={disabled}
                    onClick={() => set(field.id, value === n ? undefined : n)}
                    className={cn(
                      "h-10 w-10 rounded-md border text-sm font-medium transition-colors",
                      value === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            {field.type === "yesno" && (
              <div className="flex gap-2" role="radiogroup">
                {[
                  { label: "Yes", v: true },
                  { label: "No", v: false },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    role="radio"
                    aria-checked={value === option.v}
                    disabled={disabled}
                    onClick={() => set(field.id, value === option.v ? undefined : option.v)}
                    className={cn(
                      "h-10 min-w-16 rounded-md border px-4 text-sm font-medium transition-colors",
                      value === option.v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Read-only list of answers. */
export function AnswerList({ fields, answers }: { fields: RushFormField[]; answers: RushAnswers }) {
  return (
    <dl className="space-y-3">
      {fields.map((field) => (
        <div key={field.id}>
          <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-sm">{formatAnswer(field, answers[field.id])}</dd>
        </div>
      ))}
    </dl>
  );
}
