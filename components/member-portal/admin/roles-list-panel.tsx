"use client";

import { DragEvent } from "react";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropIndicator, RoleRecord } from "@/types";

type RolesListPanelProps = {
  roles: RoleRecord[];
  selectedRoleId: string | null;
  hasUnsavedChanges: boolean;
  dropIndicator: DropIndicator | null;
  canReorder: boolean;
  onSelectRole: (roleId: string) => void;
  onBlockedSelect: () => void;
  onDragStartRole: (
    roleId: string,
    event: DragEvent<HTMLButtonElement>,
  ) => void;
  onDragOverRole: (roleId: string, event: DragEvent<HTMLButtonElement>) => void;
  onDragLeaveRole: (roleId: string) => void;
  onDropRole: (roleId: string, event: DragEvent<HTMLButtonElement>) => void;
  onDragEndRole: () => void;
};

export function RolesListPanel({
  roles,
  selectedRoleId,
  hasUnsavedChanges,
  dropIndicator,
  canReorder,
  onSelectRole,
  onBlockedSelect,
  onDragStartRole,
  onDragOverRole,
  onDragLeaveRole,
  onDropRole,
  onDragEndRole,
}: RolesListPanelProps) {
  return (
    <div className="w-full shrink-0 md:w-[280px]">
      <p className="mb-2 text-sm font-medium text-muted-foreground">Roles</p>
      <ScrollArea className="h-[calc(100dvh-14rem)]">
        <div className="space-y-1 pr-4">
          {roles.map((role) => {
            const isSelected = role.id === selectedRoleId;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => {
                  if (
                    hasUnsavedChanges &&
                    selectedRoleId &&
                    role.id !== selectedRoleId
                  ) {
                    onBlockedSelect();
                    return;
                  }
                  onSelectRole(role.id);
                }}
                className={cn(
                  "relative w-full rounded-md px-3 py-2 text-left transition-colors",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "bg-transparent text-foreground hover:bg-accent/60",
                )}
                draggable={canReorder}
                onDragStart={(event) => onDragStartRole(role.id, event)}
                onDragOver={(event) => onDragOverRole(role.id, event)}
                onDragLeave={() => onDragLeaveRole(role.id)}
                onDrop={(event) => onDropRole(role.id, event)}
                onDragEnd={onDragEndRole}
              >
                {dropIndicator?.roleId === role.id &&
                dropIndicator.position === "before" ? (
                  <div className="pointer-events-none absolute top-0 right-2 left-2 border-t-2 border-primary" />
                ) : null}

                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {role.name}
                    </span>
                    {role.hidden ? (
                      <EyeOff
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Hidden role"
                      />
                    ) : null}
                  </span>
                  {role.type === "pledge_class" ? (
                    <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Pledge class
                    </span>
                  ) : null}
                </div>

                {dropIndicator?.roleId === role.id &&
                dropIndicator.position === "after" ? (
                  <div className="pointer-events-none absolute right-2 bottom-0 left-2 border-t-2 border-primary" />
                ) : null}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
