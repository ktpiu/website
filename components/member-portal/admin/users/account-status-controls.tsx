"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import {
  ACCOUNT_STATUS_DESCRIPTIONS,
  ACCOUNT_STATUS_LABELS,
  type AccountStatus,
} from "@/lib/account-status";
import { getMissingProfileFields, PROFILE_FIELD_LABELS } from "@/lib/profile-completeness";
import { isListedOnWebsite } from "@/lib/members";
import { hasPortalAccess } from "@/lib/account-status";
import type { User as SupabaseUser, WebsiteVisibility } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NativeSelect } from "@/components/rush/native-select";
import { cn } from "@/lib/utils";
import {
  changeAccountStatuses,
  type RoleOption,
} from "@/components/member-portal/admin/users/users-utils";

const STATUS_TONES: Record<AccountStatus, string> = {
  public: "border-muted-foreground/30 text-muted-foreground",
  rushee: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  pledge: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  alumni: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  dropped: "border-destructive/40 text-destructive",
  disaffiliated: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_TONES[status])}>
          {ACCOUNT_STATUS_LABELS[status]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{ACCOUNT_STATUS_DESCRIPTIONS[status]}</TooltipContent>
    </Tooltip>
  );
}

const VISIBILITY_LABELS: Record<WebsiteVisibility, string> = {
  auto: "Automatic",
  shown: "Always show",
  hidden: "Always hide",
};

/** Why an automatic-visibility member isn't on the public pages. */
function hiddenReason(user: SupabaseUser, roles: RoleOption[]) {
  if (user.website_visibility === "hidden") return "Manually hidden from the website.";
  const missing = getMissingProfileFields(user, roles);
  return missing.length
    ? `Not on the website: missing ${missing.map((field) => PROFILE_FIELD_LABELS[field].toLowerCase()).join(", ")}.`
    : "Not on the website.";
}

/**
 * Eye next to a member's name: open when they appear on the public members /
 * alumni pages. Admins can pin them shown or hidden. Only active and alumni
 * accounts can be on the website.
 */
export function WebsiteVisibilityControl({
  user,
  roles,
  canEdit,
  onChange,
}: {
  user: SupabaseUser;
  roles: RoleOption[];
  canEdit: boolean;
  onChange: (visibility: WebsiteVisibility) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  if (!hasPortalAccess(user.account_status)) return null;

  const listed = isListedOnWebsite(user, roles);
  const tip = listed
    ? `On the public ${user.account_status === "alumni" ? "alumni" : "members"} page${
        user.website_visibility === "shown" ? " (always shown)" : ""
      }.`
    : hiddenReason(user, roles);
  const icon = saving ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : listed ? (
    <Eye className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
  ) : (
    <EyeOff className="h-3.5 w-3.5 text-muted-foreground/60" />
  );

  if (!canEdit) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0" aria-label={tip}>
            {icon}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    );
  }

  const select = async (value: string) => {
    if (value === user.website_visibility) return;
    setSaving(true);
    try {
      await onChange(value as WebsiteVisibility);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0 rounded p-0.5 hover:bg-muted"
              aria-label={`Website visibility: ${tip}`}
            >
              {icon}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Public members / alumni pages</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={user.website_visibility} onValueChange={select}>
          {(Object.keys(VISIBILITY_LABELS) as WebsiteVisibility[]).map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <div>
                <div>{VISIBILITY_LABELS[value]}</div>
                <div className="text-xs text-muted-foreground">
                  {value === "auto"
                    ? "Shown once they have a photo, major and pledge class."
                    : value === "shown"
                      ? "Shown even if their profile is incomplete."
                      : "Never shown."}
                </div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Confirms moving one or more accounts to a status. Moving rushees to pledge
 * can assign a pledge class. Accounts the viewer can't move are reported by
 * the server and listed in a toast.
 */
export function StatusChangeDialog({
  target,
  users,
  pledgeClassRoles,
  onOpenChange,
  onDone,
}: {
  target: AccountStatus | null;
  users: SupabaseUser[];
  pledgeClassRoles: RoleOption[];
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void> | void;
}) {
  const [pledgeRoleId, setPledgeRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const sortedPledgeClasses = useMemo(
    () => [...pledgeClassRoles].sort((a, b) => b.priority - a.priority),
    [pledgeClassRoles],
  );

  useEffect(() => {
    if (target === "pledge") setPledgeRoleId(sortedPledgeClasses[0]?.id ?? "");
  }, [target, sortedPledgeClasses]);

  if (!target) return null;
  const names = users.map((u) => u.name);
  const fromRushee = users.some((u) => u.account_status === "rushee");

  const submit = async () => {
    setBusy(true);
    try {
      const result = await changeAccountStatuses({
        userIds: users.map((u) => u.id),
        status: target,
        pledgeRoleId: target === "pledge" && fromRushee ? pledgeRoleId || null : null,
      });
      if (result.changed.length) {
        toast.success(
          `Moved ${result.changed.length} account${result.changed.length === 1 ? "" : "s"} to ${ACCOUNT_STATUS_LABELS[target]}.`,
        );
      }
      if (result.skipped.length) {
        toast.warning(
          `${result.skipped.length} not moved: ${result.skipped
            .slice(0, 3)
            .map((s) => `${s.name} (${s.reason})`)
            .join("; ")}${result.skipped.length > 3 ? "…" : ""}`,
        );
      }
      onOpenChange(false);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to change the status.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to {ACCOUNT_STATUS_LABELS[target]}</DialogTitle>
          <DialogDescription>
            {names.length === 1 ? names[0] : `${names.length} accounts`} →{" "}
            {ACCOUNT_STATUS_DESCRIPTIONS[target]}
          </DialogDescription>
        </DialogHeader>
        {names.length > 1 ? (
          <p className="max-h-32 overflow-y-auto text-sm text-muted-foreground">{names.join(", ")}</p>
        ) : null}
        {target === "rushee" ? (
          <p className="text-sm text-muted-foreground">
            Public accounts are registered for the active rush cycle.
          </p>
        ) : null}
        {target === "public" && users.some((u) => u.account_status === "rushee") ? (
          <p className="text-sm text-muted-foreground">Ends their rush for this cycle.</p>
        ) : null}
        {target === "pledge" && fromRushee ? (
          <div className="space-y-1.5">
            <Label htmlFor="pledge-class">Pledge class</Label>
            <NativeSelect
              id="pledge-class"
              value={pledgeRoleId}
              onChange={(event) => setPledgeRoleId(event.target.value)}
            >
              <option value="">Don&apos;t assign one</option>
              {sortedPledgeClasses.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
