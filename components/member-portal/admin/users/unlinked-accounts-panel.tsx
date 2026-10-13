"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Link2, Loader2, RefreshCw, UserPlus, UsersRound } from "lucide-react";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { NativeSelect } from "@/components/rush/native-select";
import {
  createProfileForUnlinked,
  fetchUnlinkedAccounts,
  linkUnlinkedAccount,
  type UnlinkedClerkAccount,
} from "@/components/member-portal/admin/users/users-utils";
import { initials, LinkProfileDialog } from "@/components/member-portal/admin/users/profile-dialogs";

function relative(iso: string | null) {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Sign-in accounts with no profile. Admins link them to an existing profile
 * (e.g. a member whose profile has a different email) or create one.
 */
export function UnlinkedAccountsPanel({
  canEdit,
  profilesWithoutSignIn,
  creatableStatuses,
  onCountChange,
  onChanged,
}: {
  canEdit: boolean;
  profilesWithoutSignIn: SupabaseUser[];
  creatableStatuses: AccountStatus[];
  onCountChange?: (count: number) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [accounts, setAccounts] = useState<UnlinkedClerkAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkTarget, setLinkTarget] = useState<UnlinkedClerkAccount | null>(null);
  const [createTarget, setCreateTarget] = useState<UnlinkedClerkAccount | null>(null);
  const [createName, setCreateName] = useState("");
  const [createStatus, setCreateStatus] = useState<AccountStatus>("public");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchUnlinkedAccounts();
      setAccounts(next);
      onCountChange?.(next.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sign-in accounts.");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const done = async (clerkUserId: string) => {
    setAccounts((prev) => {
      const next = (prev ?? []).filter((a) => a.clerkUserId !== clerkUserId);
      onCountChange?.(next.length);
      return next;
    });
    await onChanged();
  };

  const create = async () => {
    if (!createTarget) return;
    setCreating(true);
    try {
      const user = await createProfileForUnlinked(createTarget.clerkUserId, {
        name: createName,
        status: createStatus,
      });
      toast.success(`Created a profile for ${user.name}.`);
      const id = createTarget.clerkUserId;
      setCreateTarget(null);
      await done(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create the profile.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Sign-ins without a profile. New sign-ins get a public account automatically, so these are
          usually older accounts or members who signed up with a different email.
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
      ) : accounts === null ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : accounts.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRound />
            </EmptyMedia>
            <EmptyTitle>Every sign-in has a profile</EmptyTitle>
            <EmptyDescription>Nothing to link right now.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {accounts.map((account) => (
            <li key={account.clerkUserId} className="flex flex-wrap items-center gap-3 p-3">
              <Avatar className="h-10 w-10 rounded-lg">
                <AvatarImage src={account.imageUrl ?? undefined} />
                <AvatarFallback className="rounded-lg text-sm">
                  {initials(account.name, account.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{account.name || account.email || "Unknown"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {account.email} · signed up {relative(account.createdAt)} · last sign-in{" "}
                  {relative(account.lastSignInAt)}
                </p>
                {account.matchingProfile ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Matches {account.matchingProfile.name}&apos;s profile by email
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setLinkTarget(account)}>
                    <Link2 className="h-3.5 w-3.5" /> Link to profile
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setCreateTarget(account);
                      setCreateName(account.name ?? "");
                      setCreateStatus("public");
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Create profile
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <LinkProfileDialog
        open={Boolean(linkTarget)}
        onOpenChange={(open) => !open && setLinkTarget(null)}
        title="Link to an existing profile"
        description={
          <>
            Attach <span className="font-medium text-foreground">{linkTarget?.email}</span> to a profile that
            doesn&apos;t have a sign-in yet. The profile keeps its name, status and roles.
          </>
        }
        candidates={profilesWithoutSignIn}
        suggestedId={linkTarget?.matchingProfile?.id}
        onConfirm={async (userId) => {
          if (!linkTarget) return;
          const user = await linkUnlinkedAccount(linkTarget.clerkUserId, userId);
          toast.success(`Linked to ${user.name}.`);
          await done(linkTarget.clerkUserId);
        }}
      />

      <Dialog open={Boolean(createTarget)} onOpenChange={(open) => !open && setCreateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create profile</DialogTitle>
            <DialogDescription>
              For <span className="font-medium text-foreground">{createTarget?.email}</span>.
              {createTarget?.matchingProfile
                ? ` This links to ${createTarget.matchingProfile.name}'s existing profile instead.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="unlinked-name">Name</Label>
              <Input id="unlinked-name" value={createName} onChange={(e) => setCreateName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unlinked-status">Status</Label>
              <NativeSelect
                id="unlinked-status"
                value={createStatus}
                onChange={(e) => setCreateStatus(e.target.value as AccountStatus)}
              >
                {creatableStatuses
                  .filter((s) => s !== "rushee")
                  .map((value) => (
                    <option key={value} value={value}>
                      {ACCOUNT_STATUS_LABELS[value]}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTarget(null)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
