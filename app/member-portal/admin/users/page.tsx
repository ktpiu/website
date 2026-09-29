"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import {
  canDeleteUsersAdmin,
  canEditUsersAdmin,
  canViewAdmin,
} from "@/lib/permissions";
import { User as SupabaseUser } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { format } from "date-fns";
import {
  Link2Off,
  MoreHorizontal,
  Pencil,
  Trash2,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PendingUsersPanel } from "@/components/member-portal/admin/users/pending-users-panel";
import { UsersToolbar } from "@/components/member-portal/admin/users/users-toolbar";
import {
  PROFILE_FIELD_LABELS,
  getMissingProfileFields,
} from "@/lib/profile-completeness";
import {
  EditDialogSection,
  EditUserDialog,
} from "@/components/member-portal/admin/users/edit-user-dialog";
import { DeleteUserDialog } from "@/components/member-portal/admin/users/delete-user-dialog";
import {
  EMPTY_USER_FILTERS,
  EditState,
  EditableFields,
  RoleOption,
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
  loadUsersData,
  parseGraduationYearInput,
  sortRoles,
  sortUsers,
  syncUserRoles,
  toggleRoleIds,
  updateUserRecord,
  uploadUserAvatar,
  userTableColumns,
} from "@/components/member-portal/admin/users/users-utils";
import { getGradeLabel } from "@/lib/members";

export default function AdminUsersPage() {
  const { permissions } = useAuthStore();
  const [users, setUsers] = useState<SupabaseUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [userRoleIds, setUserRoleIds] = useState<Record<string, string[]>>({});
  const [editRoleIds, setEditRoleIds] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saveUserId, setSaveUserId] = useState<string | null>(null);
  const [avatarUploadUserId, setAvatarUploadUserId] = useState<string | null>(
    null,
  );
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] =
    useState<SupabaseUser | null>(null);
  const [editState, setEditState] = useState<Record<string, EditState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editDialogSection, setEditDialogSection] =
    useState<EditDialogSection>("profile");
  const [filters, setFilters] = useState<UserFilters>(EMPTY_USER_FILTERS);
  const [pendingCount, setPendingCount] = useState(0);

  const isExec = canViewAdmin(permissions);
  const canEdit = canEditUsersAdmin(permissions);
  const canDelete = canDeleteUsersAdmin(permissions);
  const canManage = canEdit || canDelete;

  useEffect(() => {
    if (!isExec) return;

    let isMounted = true;

    async function loadUsers() {
      try {
        setIsLoading(true);
        const { users, roles, userRoleIds } = await loadUsersData();

        if (isMounted) {
          setUsers(users);
          setRoles(roles);
          setUserRoleIds(userRoleIds);
        }
      } catch (err) {
        console.error("Failed to load users:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadUsers();

    return () => {
      isMounted = false;
    };
  }, [isExec]);

  const handleEditChange = (
    userId: string,
    field: keyof EditState,
    value: string | boolean,
  ) => {
    setEditState((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? {}),
        [field]: value,
      },
    }));
  };

  const getEditableRoleIds = (currentUserId: string) =>
    editRoleIds[currentUserId] ?? userRoleIds[currentUserId] ?? [];

  const handleRoleToggle = (
    currentUserId: string,
    roleId: string,
    checked: boolean,
  ) => {
    setEditRoleIds((prev) => {
      const current = prev[currentUserId] ?? userRoleIds[currentUserId] ?? [];
      const next = toggleRoleIds(current, roleId, checked);

      return { ...prev, [currentUserId]: next };
    });
  };

  const handleSave = async (
    currentUser: SupabaseUser,
    forcedUpdates?: Partial<EditableFields>,
  ) => {
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
      if (graduationYear !== undefined)
        updates.graduation_year = graduationYear;
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

      if (!userFieldsChanged && !rolesChanged) {
        return true;
      }

      if (userFieldsChanged) {
        const data = await updateUserRecord(currentUser.id, updates);

        setUsers((prev) =>
          prev.map((userItem) =>
            userItem.id === currentUser.id ? data : userItem,
          ),
        );
      }

      await syncUserRoles(currentUser.id, roleIdsToInsert, roleIdsToDelete);

      if (rolesChanged) {
        setUserRoleIds((prev) => ({
          ...prev,
          [currentUser.id]: nextRoleIds,
        }));
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
      const updated = await uploadUserAvatar(currentUser.id, file);
      setUsers((prev) =>
        prev.map((userItem) =>
          userItem.id === currentUser.id ? updated : userItem,
        ),
      );
    } catch (err) {
      console.error("Failed to upload profile picture:", err);
      setErrors((prev) => ({
        ...prev,
        [currentUser.id]:
          err instanceof Error && err.message
            ? err.message
            : "Failed to upload profile picture. Please try again.",
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

      setUsers((prev) =>
        prev.filter((userItem) => userItem.id !== currentUser.id),
      );
    } catch (err) {
      console.error("Failed to delete user:", err);
      setErrors((prev) => ({
        ...prev,
        [currentUser.id]: "Failed to delete user.",
      }));
    } finally {
      setDeleteUserId(null);
    }
  };

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const roleNameById = useMemo(() => getRoleNameMap(roles), [roles]);
  const sortedRoles = useMemo(() => sortRoles(roles), [roles]);
  const pledgeClassRoles = useMemo(
    () => sortedRoles.filter((role) => role.type === "pledge_class"),
    [sortedRoles],
  );
  const rolesById = useMemo(
    () => new Map(roles.map((role) => [role.id, role])),
    [roles],
  );
  const filteredUsers = useMemo(
    () => filterUsers(users, userRoleIds, roles, filters),
    [users, userRoleIds, roles, filters],
  );
  const sortedUsers = useMemo(
    () => sortUsers(filteredUsers, sortKey, sortDirection),
    [filteredUsers, sortKey, sortDirection],
  );
  const filtersActive = hasActiveUserFilters(filters);

  const handleApproved = (approvedUser: SupabaseUser) => {
    setUsers((prev) =>
      prev.some((item) => item.id === approvedUser.id)
        ? prev.map((item) =>
            item.id === approvedUser.id ? approvedUser : item,
          )
        : [...prev, approvedUser],
    );
    setUserRoleIds((prev) => ({
      ...prev,
      [approvedUser.id]: prev[approvedUser.id] ?? [],
    }));
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  if (!isExec) {
    return (
      <div className="p-4 md:p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Admin Access Required</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You do not have permission to view this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl md:text-3xl font-bold">User Management</h1>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Review member profiles, update details, or remove accounts."
            : "Review member profiles. You do not have permission to edit or remove accounts."}
        </p>
      </div>
      <Tabs defaultValue="members" className="gap-4">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending approval
            {pendingCount > 0 ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {pendingCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4">
          <UsersToolbar
            filters={filters}
            onFiltersChange={setFilters}
            roles={sortedRoles}
            pledgeClassRoles={pledgeClassRoles}
            shownCount={filteredUsers.length}
            totalCount={users.length}
          />
          <Table>
            <TableHeader>
              <TableRow>
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
                        {sortKey === column.sortKey
                          ? sortDirection === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </Button>
                    ) : null}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={userTableColumns.length}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={userTableColumns.length}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No users found.
                  </TableCell>
                </TableRow>
              ) : sortedUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={userTableColumns.length} className="p-0">
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <UsersRound />
                        </EmptyMedia>
                        <EmptyTitle>No members match these filters</EmptyTitle>
                        <EmptyDescription>
                          Try a different search or remove some filters.
                        </EmptyDescription>
                      </EmptyHeader>
                      {filtersActive ? (
                        <EmptyContent>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setFilters({ ...EMPTY_USER_FILTERS })
                            }
                          >
                            Clear filters
                          </Button>
                        </EmptyContent>
                      ) : null}
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                sortedUsers.map((currentUser) => {
                  const missingFields = getMissingProfileFields(
                    currentUser,
                    getUserRoles(currentUser.id, userRoleIds, rolesById),
                  );
                  const isLinked = Boolean(currentUser.clerk_user_id);

                  return (
                    <TableRow key={currentUser.id}>
                      <TableCell className="min-w-[240px]">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 rounded-lg">
                            <AvatarImage src={currentUser.avatar} />
                            <AvatarFallback className="h-10 w-10 rounded-lg">
                              {currentUser.name
                                .split(" ")
                                .map((part) => part[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold">
                                {currentUser.name}
                              </span>
                              {currentUser.is_disaffiliated ? (
                                <Badge variant="destructive">Disaffiliated</Badge>
                              ) : null}
                              {currentUser.is_hidden ? (
                                <Badge variant="outline">Hidden</Badge>
                              ) : null}
                              {currentUser.is_inactive ? (
                                <Badge variant="outline">Inactive</Badge>
                              ) : null}
                              {missingFields.length > 0 ? (
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
                                    Missing:{" "}
                                    {missingFields
                                      .map(
                                        (field) => PROFILE_FIELD_LABELS[field],
                                      )
                                      .join(", ")}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="truncate">
                                {currentUser.email}
                              </span>
                              {!isLinked ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className="inline-flex shrink-0"
                                      aria-label="No sign-in linked"
                                    >
                                      <Link2Off className="h-3.5 w-3.5 text-muted-foreground/70" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    No sign-in linked
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(userRoleIds[currentUser.id] ?? []).length > 0 ? (
                            (userRoleIds[currentUser.id] ?? []).map(
                              (roleId) => (
                                <Badge key={roleId} variant="secondary">
                                  {roleNameById.get(roleId) ?? "Unknown Role"}
                                </Badge>
                              ),
                            )
                          ) : (
                            <Badge variant="secondary">NO ROLES</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{currentUser.major || "—"}</TableCell>
                      <TableCell>
                        {currentUser.graduation_year ? (
                          <div>
                            <div>{currentUser.graduation_year}</div>
                            <div className="text-xs text-muted-foreground">
                              {getGradeLabel(
                                currentUser.graduation_year,
                                currentUser.is_alumni,
                              )}
                            </div>
                          </div>
                        ) : currentUser.is_alumni ? (
                          "Alumni"
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {currentUser.created_at
                          ? format(new Date(currentUser.created_at), "PPP")
                          : "Unknown"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canEdit ? (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditDialogSection("profile");
                                    setEditRoleIds((prev) => ({
                                      ...prev,
                                      [currentUser.id]: [
                                        ...(userRoleIds[currentUser.id] ?? []),
                                      ],
                                    }));
                                    setEditingUserId(currentUser.id);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                              ) : null}
                              {canDelete ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    setPendingDeleteUser(currentUser)
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        <EditUserDialog
                          currentUser={currentUser}
                          open={canEdit && editingUserId === currentUser.id}
                          section={editDialogSection}
                          values={{
                            name: getEditableValue(
                              currentUser,
                              editState,
                              "name",
                            ),
                            email: getEditableValue(
                              currentUser,
                              editState,
                              "email",
                            ),
                            major: getEditableValue(
                              currentUser,
                              editState,
                              "major",
                            ),
                            graduationYear: getEditableValue(
                              currentUser,
                              editState,
                              "graduationYear",
                            ),
                            instagramUrl:
                              getEditableValue(
                                currentUser,
                                editState,
                                "instagramUrl",
                              ) || getSocialUrl(currentUser, "insta"),
                            linkedinUrl:
                              getEditableValue(
                                currentUser,
                                editState,
                                "linkedinUrl",
                              ) || getSocialUrl(currentUser, "linkedin"),
                          }}
                          roles={sortedRoles}
                          selectedRoleIds={getEditableRoleIds(currentUser.id)}
                          flags={getEditableFlags(currentUser, editState)}
                          error={errors[currentUser.id]}
                          isSaving={saveUserId === currentUser.id}
                          isUploadingAvatar={
                            avatarUploadUserId === currentUser.id
                          }
                          onOpenChange={(isOpen) => {
                            setEditingUserId(isOpen ? currentUser.id : null);
                            if (isOpen) {
                              setEditDialogSection("profile");
                              setEditRoleIds((prev) => ({
                                ...prev,
                                [currentUser.id]: [
                                  ...(userRoleIds[currentUser.id] ?? []),
                                ],
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
                          onFieldChange={(field, value) =>
                            handleEditChange(currentUser.id, field, value)
                          }
                          onFlagChange={(flag, checked) =>
                            handleEditChange(currentUser.id, flag, checked)
                          }
                          onRoleToggle={(roleId, checked) =>
                            handleRoleToggle(currentUser.id, roleId, checked)
                          }
                          onAvatarUpload={(file) =>
                            handleAvatarUpload(currentUser, file)
                          }
                          onAvatarError={(message) =>
                            setErrors((prev) => ({
                              ...prev,
                              [currentUser.id]: message,
                            }))
                          }
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
        </TabsContent>

        <TabsContent value="pending">
          <PendingUsersPanel
            canEdit={canEdit}
            roles={sortedRoles}
            onApproved={handleApproved}
            onCountChange={setPendingCount}
          />
        </TabsContent>
      </Tabs>
      <DeleteUserDialog
        open={Boolean(pendingDeleteUser)}
        userName={pendingDeleteUser?.name}
        isDeleting={Boolean(
          pendingDeleteUser && deleteUserId === pendingDeleteUser.id,
        )}
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
