"use client";

import * as React from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EMPTY_USER_FILTERS,
  GRADE_FILTER_OPTIONS,
  GradeFilter,
  RoleOption,
  STATUS_FILTER_OPTIONS,
  StatusFilterKey,
  StatusFilterMode,
  UserFilters,
  hasActiveUserFilters,
} from "@/components/member-portal/admin/users/users-utils";

type UsersToolbarProps = {
  filters: UserFilters;
  onFiltersChange: (next: UserFilters) => void;
  roles: RoleOption[];
  pledgeClassRoles: RoleOption[];
  shownCount: number;
  totalCount: number;
};

type ActiveFilterChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

function toggleValue<T>(list: T[], value: T, checked: boolean): T[] {
  if (checked) return list.includes(value) ? list : [...list, value];
  return list.filter((item) => item !== value);
}

/** Tri-state row: click the active mode again to clear it. */
function ModeRow({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: StatusFilterMode | undefined;
  onChange: (mode: StatusFilterMode | undefined) => void;
}) {
  const button = (target: StatusFilterMode, text: string) => (
    <Button
      type="button"
      size="sm"
      variant={mode === target ? "default" : "outline"}
      className="h-6 px-2 text-xs"
      aria-pressed={mode === target}
      onClick={() => onChange(mode === target ? undefined : target)}
    >
      {text}
    </Button>
  );

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
      <span>{label}</span>
      <div className="flex gap-1">
        {button("include", "Is")}
        {button("exclude", "Not")}
      </div>
    </div>
  );
}

function FilterMenuButton({
  label,
  activeCount,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
  activeCount: number;
}) {
  return (
    <Button variant="outline" size="sm" className="gap-1.5" {...props}>
      {label}
      {activeCount > 0 ? (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {activeCount}
        </Badge>
      ) : null}
      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
    </Button>
  );
}

export function UsersToolbar({
  filters,
  onFiltersChange,
  roles,
  pledgeClassRoles,
  shownCount,
  totalCount,
}: UsersToolbarProps) {
  const update = (patch: Partial<UserFilters>) =>
    onFiltersChange({ ...filters, ...patch });

  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const statusCount = Object.values(filters.statuses).filter(Boolean).length;
  const setStatus = (key: StatusFilterKey, mode: StatusFilterMode | undefined) => {
    const next = { ...filters.statuses };
    if (mode) next[key] = mode;
    else delete next[key];
    update({ statuses: next });
  };
  const setGradeMode = (
    grade: GradeFilter,
    mode: StatusFilterMode | undefined,
  ) =>
    update({
      grades: toggleValue(filters.grades, grade, mode === "include"),
      excludeGrades: toggleValue(filters.excludeGrades, grade, mode === "exclude"),
    });

  const chips: ActiveFilterChip[] = [
    ...filters.roleIds.map((id) => ({
      key: `role-${id}`,
      label: `Role: ${roleNameById.get(id) ?? "Unknown"}`,
      onRemove: () =>
        update({ roleIds: filters.roleIds.filter((r) => r !== id) }),
    })),
    ...filters.pledgeClassRoleIds.map((id) => ({
      key: `pc-${id}`,
      label: `Pledge class: ${roleNameById.get(id) ?? "Unknown"}`,
      onRemove: () =>
        update({
          pledgeClassRoleIds: filters.pledgeClassRoleIds.filter(
            (r) => r !== id,
          ),
        }),
    })),
    ...filters.grades.map((grade) => ({
      key: `grade-${grade}`,
      label: `Year: ${grade}`,
      onRemove: () =>
        update({ grades: filters.grades.filter((g) => g !== grade) }),
    })),
    ...filters.excludeGrades.map((grade) => ({
      key: `not-grade-${grade}`,
      label: `Not year: ${grade}`,
      onRemove: () =>
        update({
          excludeGrades: filters.excludeGrades.filter((g) => g !== grade),
        }),
    })),
    ...STATUS_FILTER_OPTIONS.flatMap(({ key, label }) => {
      const mode = filters.statuses[key];
      return mode
        ? [
            {
              key: `status-${key}`,
              label: mode === "exclude" ? `Not: ${label}` : label,
              onRemove: () => setStatus(key, undefined),
            },
          ]
        : [];
    }),
  ];

  const hasActive = hasActiveUserFilters(filters);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative w-full md:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
            placeholder="Search by name, email, or major"
            aria-label="Search members"
            className="h-9 pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterMenuButton
                label="Roles"
                activeCount={filters.roleIds.length}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-56 overflow-y-auto"
            >
              <DropdownMenuLabel>Filter by role</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {roles.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No roles
                </div>
              ) : (
                roles.map((role) => (
                  <DropdownMenuCheckboxItem
                    key={role.id}
                    checked={filters.roleIds.includes(role.id)}
                    onCheckedChange={(checked) =>
                      update({
                        roleIds: toggleValue(
                          filters.roleIds,
                          role.id,
                          checked === true,
                        ),
                      })
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    {role.name}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterMenuButton
                label="Pledge class"
                activeCount={filters.pledgeClassRoleIds.length}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-56 overflow-y-auto"
            >
              <DropdownMenuLabel>Filter by pledge class</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {pledgeClassRoles.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No pledge classes
                </div>
              ) : (
                pledgeClassRoles.map((role) => (
                  <DropdownMenuCheckboxItem
                    key={role.id}
                    checked={filters.pledgeClassRoleIds.includes(role.id)}
                    onCheckedChange={(checked) =>
                      update({
                        pledgeClassRoleIds: toggleValue(
                          filters.pledgeClassRoleIds,
                          role.id,
                          checked === true,
                        ),
                      })
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    {role.name}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterMenuButton
                label="Year"
                activeCount={filters.grades.length + filters.excludeGrades.length}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Filter by year</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {GRADE_FILTER_OPTIONS.filter((grade) => grade !== "Alumni").map(
                (grade) => (
                  <ModeRow
                    key={grade}
                    label={grade}
                    mode={
                      filters.grades.includes(grade)
                        ? "include"
                        : filters.excludeGrades.includes(grade)
                          ? "exclude"
                          : undefined
                    }
                    onChange={(mode) => setGradeMode(grade, mode)}
                  />
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterMenuButton label="Status" activeCount={statusCount} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STATUS_FILTER_OPTIONS.map(({ key, label }) => (
                <ModeRow
                  key={key}
                  label={label}
                  mode={filters.statuses[key]}
                  onChange={(mode) => setStatus(key, mode)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {hasActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFiltersChange({ ...EMPTY_USER_FILTERS })}
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Showing {shownCount} of {totalCount} members
        </span>
        {chips.map((chip) => (
          <Badge key={chip.key} variant="secondary" className="gap-1 pr-1">
            {chip.label}
            <button
              type="button"
              onClick={chip.onRemove}
              aria-label={`Remove filter ${chip.label}`}
              className="rounded-sm p-0.5 hover:bg-foreground/10"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
