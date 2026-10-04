"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PersonOption = {
  /** Unique key, e.g. "user:<id>" or "pnm:<id>". */
  key: string;
  name: string;
  avatar?: string | null;
  /** Small label shown beside the name, e.g. "Active" or "PNM". */
  kind?: string;
};

type Props = {
  options: PersonOption[];
  /** Selected keys. */
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  /** Keys that can't be chosen. */
  disabledKeys?: string[];
  id?: string;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function PersonAvatar({ person }: { person: PersonOption }) {
  return (
    <Avatar className="h-6 w-6">
      {person.avatar ? <AvatarImage src={person.avatar} alt="" /> : null}
      <AvatarFallback className="text-[10px]">{initials(person.name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Searchable single- or multi-person picker. Options are supplied by the
 * caller, so it works for actives, PNMs or both.
 */
export function PeopleSelector({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = "Select people…",
  disabled,
  loading,
  invalid,
  disabledKeys,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const selected = value.map((k) => byKey.get(k)).filter((o): o is PersonOption => Boolean(o));
  const showKinds = new Set(options.map((o) => o.kind).filter(Boolean)).size > 1;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => !q || o.name.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (key: string) => {
    if (multiple) {
      onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
    } else {
      onChange(value[0] === key ? [] : [key]);
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", invalid && "border-destructive")}
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {loading
                ? "Loading…"
                : selected.length === 0
                  ? placeholder
                  : multiple
                    ? `${selected.length} selected`
                    : selected[0].name}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-64 p-2">
          <Input
            autoFocus
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 h-8"
          />
          <ul role="listbox" aria-multiselectable={multiple} className="max-h-60 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-sm text-muted-foreground">No one found.</li>
            ) : (
              filtered.map((option) => {
                const isSelected = value.includes(option.key);
                const isDisabled = disabledKeys?.includes(option.key) && !isSelected;
                return (
                  <li key={option.key} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => toggle(option.key)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40"
                    >
                      <PersonAvatar person={option} />
                      <span className="flex-1 truncate">{option.name}</span>
                      {showKinds && option.kind ? (
                        <span className="text-[10px] uppercase text-muted-foreground">{option.kind}</span>
                      ) : null}
                      {isSelected ? <Check className="h-4 w-4 text-primary" /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverContent>
      </Popover>

      {multiple && selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((person) => (
            <Badge key={person.key} variant="secondary" className="gap-1 pr-1">
              {person.name}
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(person.key)}
                className="rounded-full p-0.5 hover:bg-background/60"
                aria-label={`Remove ${person.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
