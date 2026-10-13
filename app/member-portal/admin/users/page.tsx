"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  ExternalLink,
  Link2,
  Link2Off,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import {
  canDeleteUsersAdmin,
  canEditUsersAdmin,
  canManageDeliberation,
  canViewRush,
} from "@/lib/permissions";
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUSES,
  allowedTransitions,
  creatableStatuses,
  getUserDirectoryScope,
  RUSH_SCOPE_STATUSES,
  type AccountStatus,
  type UserDirectoryScope,
} from "@/lib/account-status";
import { User as SupabaseUser } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { UsersToolbar } from "@/components/member-portal/admin/users/users-toolbar";
import { PROFILE_FIELD_LABELS, getMissingProfileFields } from "@/lib/profile-completeness";
import {
  EditDialogSection,
  EditUserDialog,
} from "@/components/member-portal/admin/users/edit-user-dialog";
import { DeleteUserDialog } from "@/components/member-portal/admin/users/delete-user-dialog";
import {
  AccountStatusBadge,
  StatusChangeDialog,
  WebsiteVisibilityControl,
} from "@/components/member-portal/admin/users/account-status-controls";
import {
  CreateProfileDialog,
  initials,
  LinkProfileDialog,
} from "@/components/member-portal/admin/users/profile-dialogs";
import { UnlinkedAccountsPanel } from "@/components/member-portal/admin/users/unlinked-accounts-panel";
import { TransitionDialog } from "@/components/member-portal/rush/transition-dialog";
import { GroupBadge } from "@/components/member-portal/rush/pnm-badges";
import {
  EMPTY_USER_FILTERS,
  EditState,
  EditableFields,
  LoadUsersDataResult,
  SortKey,
  UserFilters,
  buildSocialsUpdate,
  deleteUserRecord,
  filterUsers,
  getEditableFlags,
  STATUS_FLAGS,
  getEditableValue,
  getRoleDiff,
  getRoleNameMap,
  getSocialUrl,
  getUserRoles,
  hasActiveUserFilters,
  linkSignInToProfile,
  loadUsersData,
  parseGraduationYearInput,
  setWebsiteVisibility,
  sortRoles,
  sortUsers,
  syncUserRoles,
  toggleRoleIds,
  updateUserRecord,
  uploadUserAvatar,
  userTableColumns,
} from "@/components/member-portal/admin/users/users-utils";
import { getGradeLabel } from "@/lib/members";
import { STAGE_LABELS, type DelibGroup, type RushStage } from "@/lib/rush/types";
import { cn } from "@/lib/utils";

type View = { key: string; label: string; statuses: readonly AccountStatus[] };

const RUSH_VIEW: View = { key: "rush", label: "Rushees & pledges", statuses: ["rushee", "pledge"] };

const VIEWS: Record<UserDirectoryScope, View[]> = {
  all: [
    { key: "active", label: "Actives", statuses: ["active"] },
    RUSH_VIEW,
    { key: "pledge", label: "Pledges", statuses: ["pledge"] },
    { key: "rushee", label: "Rushees", statuses: ["rushee"] },
    { key: "public", label: "Public", statuses: ["public"] },
    { key: "alumni", label: "Alumni", statuses: ["alumni"] },
    { key: "left", label: "Dropped & disaffiliated", statuses: ["dropped", "disaffiliated"] },
    { key: "all", label: "All", statuses: ACCOUNT_STATUSES },
  ],
  rush: [
    RUSH_VIEW,
    { key: "rushee", label: "Rushees", statuses: ["rushee"] },
    { key: "pledge", label: "Pledges", statuses: ["pledge"] },
    { key: "public", label: "Public", statuses: ["public"] },
    { key: "all", label: "All", statuses: RUSH_SCOPE_STATUSES },
  ],
};

/** Actives for admins; rushees and pledges for rush directors. */
const DEFAULT_VIEW: Record<UserDirectoryScope, string> = { all: "active", rush: "rush" };

export default function AdminUsersPage() {
  const { permissions } = useAuthStore();
  const [data, setData] = useState<LoadUsersDataResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editRoleIds, setEditRoleIds] = useState<Record<string, string[]>>({});
  const [saveUserId, setSaveUserId] = useState<string | null>(null);
  const [avatarUploadUserId, setAvatarUploadUserId] = useState<string | null>(null);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<SupabaseUser | null>(null);
  const [editState, setEditState] = useState<Record<string, EditState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editDialogSection, setEditDialogSection] = useState<EditDialogSection>("profile");
  const [filters, setFilters] = useState<UserFilters>(EMPTY_USER_FILTERS);
  const [unlinkedCount, setUnlinkedCount] = useState(0);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusTarget, setStatusTarget] = useState<{ to: AccountStatus; userIds: string[] } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkSignInUser, setLinkSignInUser] = useState<SupabaseUser | null>(null);
  const [rushTransitionOpen, setRushTransitionOpen] = useState(false);

  const scope = getUserDirectoryScope(permissions);
  const isAdmin = scope === "all";
  const canEdit = canEditUsersAdmin(permissions);
  const canDelete = canDeleteUsersAdmin(permissions);
  const rushView = canViewRush(permissions);
  const canDeliberate = canManageDeliberation(permissions);
  const createStatuses = useMemo(() => creatableStatuses(permissions), [permissions]);

  const users = useMemo(() => data?.users ?? [], [data]);
  const roles = useMemo(() => data?.roles ?? [], [data]);
  const userRoleIds = useMemo(() => data?.userRoleIds ?? {}, [data]);
  const rush = useMemo(() => data?.rush ?? {}, [data]);

  const reload = useCallback(async () => {
    try {
      const next = await loadUsersData();
      setData(next);
      setLoadError(null);
    } catch (err) {
      console.error("Failed to load users:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load users.");
    }
  }, []);

  useEffect(() => {
    if (scope) reload();
  }, [scope, reload]);

  // ?view= deep links (e.g. the old rush PNM list redirects to ?view=rush).
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("view");
    if (param) setViewKey(param);
  }, []);

  const views = scope ? VIEWS[scope] : [];
  const view =
    views.find((v) => v.key === viewKey) ?? views.find((v) => scope && v.key === DEFAULT_VIEW[scope]) ?? views[0];

  const patchUser = (next: SupabaseUser) =>
    setData((prev) =>
      prev ? { ...prev, users: prev.users.map((u) => (u.id === next.id ? next : u)) } : prev,
    );

  const handleEditChange = (userId: string, field: keyof EditState, value: string | boolean) => {
    setEditState((prev) => ({ ...prev, [userId]: { ...(prev[userId] ?? {}), [field]: value } }));
  };

  const getEditableRoleIds = (currentUserId: string) =>
    editRoleIds[currentUserId] ?? userRoleIds[currentUserId] ?? [];

  const handleRoleToggle = (currentUserId: string, roleId: string, checked: boolean) => {
    setEditRoleIds((prev) => {
      const current = prev[currentUserId] ?? userRoleIds[currentUserId] ?? [];
      return { ...prev, [currentUserId]: toggleRoleIds(current, roleId, checked) };
    });
  };

  const handleSave = async (currentUser: SupabaseUser, forcedUpdates?: Partial<EditableFields>) => {
    if (!canEdit) return false;
    setErrors((prev) => ({ ...prev, [currentUser.id]: "" }));
    setSaveUserId(currentUser.id);

    try {
      const updates: Partial<EditableFields> = {};
      const nextState = editState[currentUser.id] ?? {};

      if (nextState.name !== undefined) updates.name = nextState.name;
      if (nextState.email !== undefined) updates.email = nextState.email;
      if (nextState.major !== undefined) updates.major = nextState.major;
      if (nextState.avatar !== undefined) updates.avatar = nextState.avatar;
      const graduationYear = parseGraduationYearInput(nextState.graduationYear);
      if (graduationYear !== undefined) updates.graduation_year = graduationYear;
      for (const { key, column } of STATUS_FLAGS) {
        const value = nextState[key];
        if (value !== undefined) updates[column] = value;
      }
      if (forcedUpdates) Object.assign(updates, forcedUpdates);
      const socialsUpdate = buildSocialsUpdate(currentUser, nextState);
      if (socialsUpdate !== undefined) updates.socials = socialsUpdate;

      const nextRoleIds = getEditableRoleIds(currentUser.id);
      const { roleIdsToInsert, roleIdsToDelete, rolesChanged } = getRoleDiff(
        userRoleIds[currentUser.id] ?? [],
        nextRoleIds,
      );
      const userFieldsChanged = Object.keys(updates).length > 0;

      if (!userFieldsChanged && !rolesChanged) return true;

      if (userFieldsChanged) patchUser(await updateUserRecord(currentUser.id, updates));

      await syncUserRoles(currentUser.id, roleIdsToInsert, roleIdsToDelete);

      if (rolesChanged) {
        setData((prev) =>
          prev ? { ...prev, userRoleIds: { ...prev.userRoleIds, [currentUser.id]: nextRoleIds } } : prev,
        );
        setEditRoleIds((prev) => {
          const next = { ...prev };
          delete next[currentUser.id];
          return next;
        });
      }
      return true;
    } catch (err) {
      console.error("Failed to update user:", err);
      setErrors((prev) => ({
        ...prev,
        [currentUser.id]:
          err instanceof Error && err.message.startsWith("Graduation year")
            ? err.message
            : "Failed to update user. Please try again.",
      }));
      return false;
    } finally {
      setSaveUserId(null);
    }
  };

  const handleAvatarUpload = async (currentUser: SupabaseUser, file: File) => {
    if (!canEdit) return;
    setErrors((prev) => ({ ...prev, [currentUser.id]: "" }));
    setAvatarUploadUserId(currentUser.id);
    try {
      patchUser(await uploadUserAvatar(currentUser.id, file));
    } catch (err) {
      console.error("Failed to upload profile picture:", err);
      setErrors((prev) => ({
        ...prev,
        [currentUser.id]:
          err instanceof Error && err.message ? err.message : "Failed to upload profile picture. Please try again.",
      }));
    } finally {
      setAvatarUploadUserId(null);
    }
  };

  const handleDelete = async (currentUser: SupabaseUser) => {
    if (!canDelete) return;
    setDeleteUserId(currentUser.id);
    try {
      await deleteUserRecord(currentUser.id);
      setData((prev) => (prev ? { ...prev, users: prev.users.filter((u) => u.id !== currentUser.id) } : prev));
    } catch (err) {
      console.error("Failed to delete user:", err);
      toast.error(`Failed to delete ${currentUser.name}.`);
    } finally {
      setDeleteUserId(null);
    }
  };

  const handleVisibility = async (currentUser: SupabaseUser, visibility: SupabaseUser["website_visibility"]) => {
    try {
      patchUser(await setWebsiteVisibility(currentUser.id, visibility));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update website visibility.");
    }
  };

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const roleNameById = useMemo(() => getRoleNameMap(roles), [roles]);
  const sortedRoles = useMemo(() => sortRoles(roles), [roles]);
  const pledgeClassRoles = useMemo(() => sortedRoles.filter((role) => role.type === "pledge_class"), [sortedRoles]);
  const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  const statusCounts = useMemo(() => {
    const counts = new Map<AccountStatus, number>();
    for (const user of users) counts.set(user.account_status, (counts.get(user.account_status) ?? 0) + 1);
    return counts;
  }, [users]);
  const viewUsers = useMemo(
    () => (view ? users.filter((u) => view.statuses.includes(u.account_status)) : []),
    [users, view],
  );
  const filteredUsers = useMemo(
    () => filterUsers(viewUsers, userRoleIds, roles, filters),
    [viewUsers, userRoleIds, roles, filters],
  );
  const sortedUsers = useMemo(
    () => sortUsers(filteredUsers, sortKey, sortDirection),
    [filteredUsers, sortKey, sortDirection],
  );
  const filtersActive = hasActiveUserFilters(filters);
  const profilesWithoutSignIn = useMemo(() => users.filter((u) => !u.clerk_user_id), [users]);

  // Bulk moves: any status the viewer may move at least one selected account to.
  const selectedUsers = useMemo(() => users.filter((u) => selected.has(u.id)), [users, selected]);
  const bulkTargets = useMemo(() => {
    const targets = new Set<AccountStatus>();
    for (const user of selectedUsers) {
      for (const to of allowedTransitions(permissions, user.account_status)) targets.add(to);
    }
    return ACCOUNT_STATUSES.filter((s) => targets.has(s));
  }, [selectedUsers, permissions]);
  const canSelect = users.some((u) => allowedTransitions(permissions, u.account_status).length > 0);

  // Rush-stage moves (open -> closed rush, end rush) for rushees in one stage.
  const selectedRushStage = useMemo(() => {
    if (!canDeliberate || !data?.cycle || selectedUsers.length === 0) return null;
    const stages = new Set(
      selectedUsers.map((u) =>
        u.account_status === "rushee" && rush[u.id]?.stage && !rush[u.id]?.outcome ? rush[u.id].stage : null,
      ),
    );
    const [only] = Array.from(stages);
    return stages.size === 1 && only ? (only as RushStage) : null;
  }, [canDeliberate, data?.cycle, selectedUsers, rush]);

  const toggleSelected = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const allShownSelected = sortedUsers.length > 0 && sortedUsers.every((u) => selected.has(u.id));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  if (!scope) {
    return (
      <div className="p-4 md:p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Access Required</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You do not have permission to view this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  const columnCount = userTableColumns.length + (canSelect ? 1 : 0);

  const accountsTable = (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
        {views.map((v) => {
          const count = v.statuses.reduce((sum, s) => sum + (statusCounts.get(s) ?? 0), 0);
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                setViewKey(v.key);
                setSelected(new Set());
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view?.key === v.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label} <span className="text-muted-foreground">({count})</span>
            </button>
          );
        })}
      </div>

      <UsersToolbar
        filters={filters}
        onFiltersChange={setFilters}
        roles={sortedRoles}
        pledgeClassRoles={pledgeClassRoles}
        shownCount={filteredUsers.length}
        totalCount={viewUsers.length}
      />

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          {bulkTargets.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Move to…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {bulkTargets.map((to) => (
                  <DropdownMenuItem
                    key={to}
                    onClick={() => setStatusTarget({ to, userIds: selectedUsers.map((u) => u.id) })}
                  >
                    {ACCOUNT_STATUS_LABELS[to]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-muted-foreground">You can&apos;t move these accounts.</span>
          )}
          {selectedRushStage ? (
            <Button size="sm" variant="outline" onClick={() => setRushTransitionOpen(true)}>
              {STAGE_LABELS[selectedRushStage]} actions…
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canSelect ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allShownSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(sortedUsers.map((u) => u.id)) : new Set())
                    }
                  />
                </TableHead>
              ) : null}
              {userTableColumns.map((column) => (
                <TableHead key={column.label || "actions"}>
                  {column.sortKey ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start px-0 hover:bg-transparent hover:underline"
                      onClick={() => handleSort(column.sortKey!)}
                    >
                      {column.label}
                      {sortKey === column.sortKey ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
                    </Button>
                  ) : (
                    column.label
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data && !loadError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-muted-foreground">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-destructive">
                  {loadError}
                </TableCell>
              </TableRow>
            ) : sortedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="p-0">
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <UsersRound />
                      </EmptyMedia>
                      <EmptyTitle>{filtersActive ? "No accounts match these filters" : "No accounts here"}</EmptyTitle>
                      <EmptyDescription>
                        {filtersActive
                          ? "Try a different search or remove some filters."
                          : `There are no ${view?.label.toLowerCase()} accounts yet.`}
                      </EmptyDescription>
                    </EmptyHeader>
                    {filtersActive ? (
                      <EmptyContent>
                        <Button variant="outline" size="sm" onClick={() => setFilters({ ...EMPTY_USER_FILTERS })}>
                          Clear filters
                        </Button>
                      </EmptyContent>
                    ) : null}
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              sortedUsers.map((currentUser) => {
                const ownRoles = getUserRoles(currentUser.id, userRoleIds, rolesById);
                const missingFields = getMissingProfileFields(currentUser, ownRoles);
                const isMemberProfile = ["pledge", "active", "alumni"].includes(currentUser.account_status);
                const isLinked = Boolean(currentUser.clerk_user_id);
                const moves = allowedTransitions(permissions, currentUser.account_status);
                const rushInfo = rush[currentUser.id];
                const canLinkSignIn = canEdit && currentUser.account_status === "public" && isLinked;
                const hasMenu = canEdit || canDelete || moves.length > 0 || (rushView && rushInfo);

                return (
                  <TableRow key={currentUser.id} data-state={selected.has(currentUser.id) ? "selected" : undefined}>
                    {canSelect ? (
                      <TableCell>
                        {moves.length > 0 ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${currentUser.name}`}
                            checked={selected.has(currentUser.id)}
                            onChange={(e) => toggleSelected(currentUser.id, e.target.checked)}
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="min-w-[240px]">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 rounded-lg">
                          <AvatarImage src={currentUser.avatar} />
                          <AvatarFallback className="h-10 w-10 rounded-lg">{initials(currentUser.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold">{currentUser.name}</span>
                            <WebsiteVisibilityControl
                              user={currentUser}
                              roles={ownRoles}
                              canEdit={canEdit}
                              onChange={(visibility) => handleVisibility(currentUser, visibility)}
                            />
                            {currentUser.is_inactive ? <Badge variant="outline">Inactive</Badge> : null}
                            {isMemberProfile && missingFields.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/40 text-amber-600 dark:text-amber-400"
                                  >
                                    <TriangleAlert />
                                    Incomplete
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Missing: {missingFields.map((field) => PROFILE_FIELD_LABELS[field]).join(", ")}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className="truncate">{currentUser.email}</span>
                            {!isLinked ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex shrink-0" aria-label="No sign-in linked">
                                    <Link2Off className="h-3.5 w-3.5 text-muted-foreground/70" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>No sign-in linked yet</TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <AccountStatusBadge status={currentUser.account_status} />
                        {currentUser.account_status === "pledge" &&
                        !ownRoles.some((r) => r.type === "pledge_class") ? (
                          <span className="text-xs text-muted-foreground">No pledge class</span>
                        ) : null}
                        {rushInfo && rushInfo.stage && currentUser.account_status === "rushee" ? (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            {STAGE_LABELS[rushInfo.stage]}
                            {rushInfo.group ? <GroupBadge group={rushInfo.group as DelibGroup} /> : null}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(userRoleIds[currentUser.id] ?? []).length > 0 ? (
                          (userRoleIds[currentUser.id] ?? []).map((roleId) => (
                            <Badge key={roleId} variant="secondary">
                              {roleNameById.get(roleId) ?? "Unknown Role"}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{currentUser.major || "—"}</TableCell>
                    <TableCell>
                      {currentUser.graduation_year ? (
                        <div>
                          <div>{currentUser.graduation_year}</div>
                          <div className="text-xs text-muted-foreground">
                            {getGradeLabel(currentUser.graduation_year, currentUser.is_alumni)}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {currentUser.created_at ? format(new Date(currentUser.created_at), "PP") : "Unknown"}
                    </TableCell>
                    <TableCell className="text-right">
                      {hasMenu ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${currentUser.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {canEdit ? (
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditDialogSection("profile");
                                  setEditRoleIds((prev) => ({
                                    ...prev,
                                    [currentUser.id]: [...(userRoleIds[currentUser.id] ?? [])],
                                  }));
                                  setEditingUserId(currentUser.id);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                            ) : null}
                            {rushView && rushInfo ? (
                              <DropdownMenuItem asChild>
                                <Link href={`/member-portal/rush/pnms/${rushInfo.pnmId}`}>
                                  <ExternalLink className="h-4 w-4" />
                                  Rush profile
                                </Link>
                              </DropdownMenuItem>
                            ) : null}
                            {canLinkSignIn ? (
                              <DropdownMenuItem onClick={() => setLinkSignInUser(currentUser)}>
                                <Link2 className="h-4 w-4" />
                                Link sign-in to a profile…
                              </DropdownMenuItem>
                            ) : null}
                            {moves.length > 0 ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
                                {moves.map((to) => (
                                  <DropdownMenuItem
                                    key={to}
                                    onClick={() => setStatusTarget({ to, userIds: [currentUser.id] })}
                                  >
                                    <ArrowRightLeft className="h-4 w-4" />
                                    {ACCOUNT_STATUS_LABELS[to]}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            ) : null}
                            {canDelete ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setPendingDeleteUser(currentUser)}>
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                      <EditUserDialog
                        currentUser={currentUser}
                        open={canEdit && editingUserId === currentUser.id}
                        section={editDialogSection}
                        values={{
                          name: getEditableValue(currentUser, editState, "name"),
                          email: getEditableValue(currentUser, editState, "email"),
                          major: getEditableValue(currentUser, editState, "major"),
                          graduationYear: getEditableValue(currentUser, editState, "graduationYear"),
                          instagramUrl:
                            getEditableValue(currentUser, editState, "instagramUrl") ||
                            getSocialUrl(currentUser, "insta"),
                          linkedinUrl:
                            getEditableValue(currentUser, editState, "linkedinUrl") ||
                            getSocialUrl(currentUser, "linkedin"),
                        }}
                        roles={sortedRoles}
                        selectedRoleIds={getEditableRoleIds(currentUser.id)}
                        flags={getEditableFlags(currentUser, editState)}
                        error={errors[currentUser.id]}
                        isSaving={saveUserId === currentUser.id}
                        isUploadingAvatar={avatarUploadUserId === currentUser.id}
                        onOpenChange={(isOpen) => {
                          setEditingUserId(isOpen ? currentUser.id : null);
                          if (isOpen) {
                            setEditDialogSection("profile");
                            setEditRoleIds((prev) => ({
                              ...prev,
                              [currentUser.id]: [...(userRoleIds[currentUser.id] ?? [])],
                            }));
                          } else {
                            setEditRoleIds((prev) => {
                              const next = { ...prev };
                              delete next[currentUser.id];
                              return next;
                            });
                          }
                        }}
                        onSectionChange={setEditDialogSection}
                        onFieldChange={(field, value) => handleEditChange(currentUser.id, field, value)}
                        onFlagChange={(flag, checked) => handleEditChange(currentUser.id, flag, checked)}
                        onRoleToggle={(roleId, checked) => handleRoleToggle(currentUser.id, roleId, checked)}
                        onAvatarUpload={(file) => handleAvatarUpload(currentUser, file)}
                        onAvatarError={(message) => setErrors((prev) => ({ ...prev, [currentUser.id]: message }))}
                        onSave={async () => {
                          const saved = await handleSave(currentUser);
                          if (saved) setEditingUserId(null);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold md:text-3xl">User Management</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Every account, from public sign-ups to alumni. Status controls where each account can sign in."
              : "Rushees, pledges and public accounts. Register people for rush and move rushees who accept a bid to pledge."}
          </p>
        </div>
        {createStatuses.length > 0 ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New profile
          </Button>
        ) : null}
      </div>

      {isAdmin ? (
        <Tabs defaultValue="accounts" className="gap-4">
          <TabsList>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="unlinked" className="gap-1.5">
              Unlinked sign-ins
              {unlinkedCount > 0 ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {unlinkedCount}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="accounts">{accountsTable}</TabsContent>
          <TabsContent value="unlinked">
            <UnlinkedAccountsPanel
              canEdit={canEdit}
              profilesWithoutSignIn={profilesWithoutSignIn}
              creatableStatuses={createStatuses}
              onCountChange={setUnlinkedCount}
              onChanged={reload}
            />
          </TabsContent>
        </Tabs>
      ) : (
        accountsTable
      )}

      {statusTarget ? (
        <StatusChangeDialog
          target={statusTarget.to}
          users={users.filter((u) => statusTarget.userIds.includes(u.id))}
          pledgeClassRoles={pledgeClassRoles}
          onOpenChange={(open) => !open && setStatusTarget(null)}
          onDone={async () => {
            setSelected(new Set());
            await reload();
          }}
        />
      ) : null}

      {data?.cycle && selectedRushStage ? (
        <TransitionDialog
          open={rushTransitionOpen}
          onOpenChange={setRushTransitionOpen}
          cycle={data.cycle}
          stage={selectedRushStage}
          pnms={selectedUsers.flatMap((u) => (rush[u.id] ? [{ id: rush[u.id].pnmId, name: u.name }] : []))}
          onDone={async () => {
            setSelected(new Set());
            await reload();
          }}
        />
      ) : null}

      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        statuses={createStatuses}
        defaultStatus={view?.statuses.length === 1 ? view.statuses[0] : isAdmin ? "active" : "rushee"}
        onCreated={reload}
      />

      <LinkProfileDialog
        open={Boolean(linkSignInUser)}
        onOpenChange={(open) => !open && setLinkSignInUser(null)}
        title="Link sign-in to a profile"
        description={
          <>
            Moves <span className="font-medium text-foreground">{linkSignInUser?.email}</span>&apos;s sign-in onto a
            profile that doesn&apos;t have one (e.g. their member profile under a different email), then removes this
            public account.
          </>
        }
        candidates={profilesWithoutSignIn.filter((u) => u.id !== linkSignInUser?.id)}
        onConfirm={async (targetUserId) => {
          if (!linkSignInUser) return;
          const { user } = await linkSignInToProfile(linkSignInUser.id, targetUserId);
          toast.success(`Linked the sign-in to ${user.name}.`);
          await reload();
        }}
      />

      <DeleteUserDialog
        open={Boolean(pendingDeleteUser)}
        userName={pendingDeleteUser?.name}
        isDeleting={Boolean(pendingDeleteUser && deleteUserId === pendingDeleteUser.id)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDeleteUser(null);
        }}
        onCancel={() => setPendingDeleteUser(null)}
        onConfirm={async () => {
          if (!pendingDeleteUser) return;
          await handleDelete(pendingDeleteUser);
          setPendingDeleteUser(null);
        }}
      />
    </div>
  );
}
