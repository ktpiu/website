"use client";

import { cn } from "@/lib/utils";
import { ROLE_TYPE_OPTIONS, type RoleType } from "@/types";

type RoleTypeSelectProps = {
  value: RoleType;
  onChange: (value: RoleType) => void;
  className?: string;
  disabled?: boolean;
};

export function RoleTypeSelect({
  value,
  onChange,
  className,
  disabled,
}: RoleTypeSelectProps) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as RoleType)}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {ROLE_TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
