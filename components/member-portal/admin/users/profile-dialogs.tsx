"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from "@/lib/account-status";
import type { User as SupabaseUser } from "@/lib/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NativeSelect } from "@/components/rush/native-select";
import { IuEmailWarning } from "@/components/rush/iu-email-warning";
import { cn } from "@/lib/utils";
import { createProfile } from "@/components/member-portal/admin/users/users-utils";
import { AccountStatusBadge } from "@/components/member-portal/admin/users/account-status-controls";

export function initials(name: string | null | undefined, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Creates a profile with no sign-in; the person's first sign-in links it by email. */
export function CreateProfileDialog({
  open,
  onOpenChange,
  statuses,
  defaultStatus,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statuses: AccountStatus[];
  defaultStatus: AccountStatus;
  onCreated: (user: SupabaseUser) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [status, setStatus] = useState<AccountStatus>(defaultStatus);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setGraduationYear("");
    setStatus(statuses.includes(defaultStatus) ? defaultStatus : statuses[0]);
  }, [open, defaultStatus, statuses]);

  const submit = async () => {
    setBusy(true);
    try {
      const user = await createProfile({ name, email, status, graduationYear });
      toast.success(`Created ${user.name}.`);
      onOpenChange(false);
      await onCreated(user);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create the profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New profile</DialogTitle>
          <DialogDescription>
            Their first sign-in with this email links to the profile automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-profile-name">Name</Label>
            <Input id="new-profile-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-profile-email">Email</Label>
            <Input
              id="new-profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <IuEmailWarning email={email} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-profile-status">Status</Label>
              <NativeSelect
                id="new-profile-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as AccountStatus)}
              >
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {ACCOUNT_STATUS_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-profile-year">Graduation year</Label>
              <Input
                id="new-profile-year"
                inputMode="numeric"
                placeholder="Optional"
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
              />
            </div>
          </div>
          {status === "rushee" ? (
            <p className="text-xs text-muted-foreground">Registers them in the active rush cycle.</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !email.trim()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Picks a profile with no sign-in to attach a sign-in account to. `title` and
 * `description` explain what the link does in the caller's context.
 */
export function LinkProfileDialog({
  open,
  onOpenChange,
  title,
  description,
  candidates,
  suggestedId,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** Profiles without a sign-in. */
  candidates: SupabaseUser[];
  suggestedId?: string | null;
  onConfirm: (userId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(suggestedId ?? null);
  }, [open, suggestedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 100);
  }, [candidates, search]);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await onConfirm(selected);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to link the sign-in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search profiles without a sign-in"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ScrollArea className="h-72 rounded-md border">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No profiles without a sign-in match.
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(user.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted",
                      selected === user.id && "bg-accent",
                    )}
                  >
                    <Avatar className="h-8 w-8 rounded-md">
                      <AvatarImage src={user.avatar} />
                      <AvatarFallback className="rounded-md text-xs">{initials(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <AccountStatusBadge status={user.account_status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !selected}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
