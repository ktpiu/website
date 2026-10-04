"use client";

import { DragEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Shield } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canEditRoles, canViewAdmin } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  CreateRoleFormState,
  DropIndicator,
  PermissionRecord,
  RoleRecord,
} from "@/types";
import {
  clonePermissionMap,
  compareRoles,
  EMPTY_CREATE_FORM,
} from "@/lib/utils";
import {
  applyRoleUpdates,
  createRoleRecord,
  deleteRoleRecord,
  fetchRolesData,
  groupPermissionsBySection,
  hasUnsavedRoleChanges,
  installUnsavedNavigationGuard,
  mapPermissionIdByKey,
  nextDropPosition,
  persistRoleDrafts,
  reorderRolesLive,
  resolveSelectedRoleId,
  toggleAllPermissionsForRole,
  togglePermissionForRole,
  toggleSectionPermissionsForRole,
} from "@/app/member-portal/admin/roles/page-utils";
import { RolesListPanel } from "@/components/member-portal/admin/roles-list-panel";
import { RoleDetailsPanel } from "@/components/member-portal/admin/role-details-panel";
import { CreateRoleDialog } from "@/components/member-portal/admin/create-role-dialog";
import { DeleteRoleDialog } from "@/components/member-portal/admin/delete-role-dialog";
import { UnsavedChangesBar } from "@/components/member-portal/admin/unsaved-changes-bar";

export default function AdminRolesPage() {
  const { permissions: myPermissions } = useAuthStore();
  const isExec = canViewAdmin(myPermissions);
  const canEdit = canEditRoles(myPermissions);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [isDeletingRole, setIsDeletingRole] = useState(false);

  const [baseRoles, setBaseRoles] = useState<RoleRecord[]>([]);
  const [draftRoles, setDraftRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [baseRolePermissions, setBaseRolePermissions] = useState<
    Record<string, Set<string>>
  >({});
  const [draftRolePermissions, setDraftRolePermissions] = useState<
    Record<string, Set<string>>
  >({});

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draggedRoleId, setDraggedRoleId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<CreateRoleFormState>(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const groupedPermissions = useMemo(
    () => groupPermissionsBySection(permissions),
    [permissions],
  );

  const permissionIdByKey = useMemo(
    () => mapPermissionIdByKey(permissions),
    [permissions],
  );

  const selectedRole = useMemo(
    () => draftRoles.find((role) => role.id === selectedRoleId) ?? null,
    [draftRoles, selectedRoleId],
  );

  const hasUnsavedChanges = useMemo(
    () =>
      hasUnsavedRoleChanges(
        baseRoles,
        draftRoles,
        baseRolePermissions,
        draftRolePermissions,
      ),
    [baseRoles, draftRoles, baseRolePermissions, draftRolePermissions],
  );

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchRolesData();
      setBaseRoles(data.roles);
      setDraftRoles(data.roles);
      setPermissions(data.permissions);
      setBaseRolePermissions(data.permissionMap);
      setDraftRolePermissions(clonePermissionMap(data.permissionMap));
    } catch (error) {
      console.error("Failed to load role management data:", error);
      toast.error("Failed to load roles and permissions.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isExec) return;
    void loadData();
  }, [isExec]);

  useEffect(() => {
    setSelectedRoleId((current) => resolveSelectedRoleId(draftRoles, current));
  }, [draftRoles]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    return installUnsavedNavigationGuard(() => {
      toast.warning("Save or cancel role changes before leaving this page.");
    });
  }, [hasUnsavedChanges]);

  const openCreateDialog = () => {
    setCreateError("");
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateDialogOpen(true);
  };

  const handleCreateRole = async () => {
    const normalizedName = createForm.name.trim();
    if (!normalizedName) {
      setCreateError("Role name is required.");
      return;
    }

    setIsCreatingRole(true);
    try {
      const createdRole = await createRoleRecord({
        name: normalizedName,
        description: createForm.description.trim(),
        hidden: createForm.hidden,
        type: createForm.type,
      });

      setBaseRoles((prev) => [...prev, createdRole].sort(compareRoles));
      setDraftRoles((prev) => [...prev, createdRole].sort(compareRoles));
      setBaseRolePermissions((prev) => {
        const next = clonePermissionMap(prev);
        next[createdRole.id] = new Set();
        return next;
      });
      setDraftRolePermissions((prev) => {
        const next = clonePermissionMap(prev);
        next[createdRole.id] = new Set();
        return next;
      });
      setSelectedRoleId(createdRole.id);
      setCreateDialogOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateError("");
      toast.success("Role created.");
    } catch (error) {
      console.error("Failed to create role:", error);
      toast.error("Failed to create role.");
    } finally {
      setIsCreatingRole(false);
    }
  };

  const updateSelectedRole = (updates: Partial<RoleRecord>) => {
    if (!selectedRoleId) return;
    setDraftRoles((prev) => applyRoleUpdates(prev, selectedRoleId, updates));
  };

  const handleDragStartRole = (
    roleId: string,
    event: DragEvent<HTMLButtonElement>,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", roleId);
    setDraggedRoleId(roleId);
  };

  const handleDragOverRole = (
    roleId: string,
    event: DragEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const position = nextDropPosition(event);
    setDropIndicator({ roleId, position });

    if (draggedRoleId) {
      setDraftRoles((prev) =>
        reorderRolesLive(prev, draggedRoleId, roleId, position),
      );
    }
  };

  const handleDragLeaveRole = (roleId: string) => {
    setDropIndicator((prev) => (prev?.roleId === roleId ? null : prev));
  };

  const handleDropRole = (
    _roleId: string,
    event: DragEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    setDropIndicator(null);
  };

  const handleDragEndRole = () => {
    setDraggedRoleId(null);
    setDropIndicator(null);
  };

  const handleTogglePermission = (permissionKey: string, checked: boolean) => {
    if (!selectedRoleId) return;
    setDraftRolePermissions((prev) =>
      togglePermissionForRole(prev, selectedRoleId, permissionKey, checked),
    );
  };

  const handleToggleAllPermissions = (checked: boolean) => {
    if (!selectedRoleId) return;
    setDraftRolePermissions((prev) =>
      toggleAllPermissionsForRole(prev, selectedRoleId, permissions, checked),
    );
  };

  const handleTogglePermissionSection = (
    sectionPermissions: PermissionRecord[],
    checked: boolean,
  ) => {
    if (!selectedRoleId) return;
    setDraftRolePermissions((prev) =>
      toggleSectionPermissionsForRole(
        prev,
        selectedRoleId,
        sectionPermissions,
        checked,
      ),
    );
  };

  const handleCancelDraft = () => {
    setDraftRoles([...baseRoles].sort(compareRoles));
    setDraftRolePermissions(clonePermissionMap(baseRolePermissions));
    toast.info("Unsaved role changes were discarded.");
  };

  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      await persistRoleDrafts({
        baseRoles,
        draftRoles,
        baseRolePermissions,
        draftRolePermissions,
        permissionIdByKey,
      });

      toast.success("Roles updated.");
      await loadData();
    } catch (error) {
      console.error("Failed to save role changes:", error);
      toast.error("Failed to save role changes.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;
    if (hasUnsavedChanges) {
      toast.warning("Save or cancel changes before deleting a role.");
      return;
    }

    setIsDeletingRole(true);
    try {
      await deleteRoleRecord(selectedRole.id);

      setBaseRoles((prev) => prev.filter((role) => role.id !== selectedRole.id));
      setDraftRoles((prev) => prev.filter((role) => role.id !== selectedRole.id));
      setBaseRolePermissions((prev) => {
        const next = clonePermissionMap(prev);
        delete next[selectedRole.id];
        return next;
      });
      setDraftRolePermissions((prev) => {
        const next = clonePermissionMap(prev);
        delete next[selectedRole.id];
        return next;
      });

      setSelectedRoleId(null);
      setDeleteDialogOpen(false);
      toast.success("Role deleted.");
    } catch (error) {
      console.error("Failed to delete role:", error);
      toast.error("Failed to delete role.");
    } finally {
      setIsDeletingRole(false);
    }
  };

  if (!isExec) {
    return (
      <div className="p-4 md:p-6">
        <div className="max-w-xl rounded-lg border bg-background p-4 md:p-6">
          <h2 className="text-lg font-semibold">Admin Access Required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You do not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-4 pb-20 md:gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold md:text-3xl">Role Management</h1>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Select a role to edit details and permissions."
              : "View only. Editing roles requires the admin.roles.edit permission."}
          </p>
        </div>
        {canEdit ? (
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 size-4" />
            Create Role
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Skeleton className="h-[520px] w-full" />
          <Skeleton className="h-[520px] w-full" />
        </div>
      ) : draftRoles.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Shield className="size-5" />
            </EmptyMedia>
            <EmptyTitle>No roles found</EmptyTitle>
            <EmptyDescription>
              Create a role to start managing access controls.
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <EmptyContent>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 size-4" />
                Create Role
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="relative flex-1 min-h-0">
          <div className="flex min-h-full flex-col gap-4 md:flex-row md:gap-6">
            <RolesListPanel
              roles={draftRoles}
              selectedRoleId={selectedRoleId}
              hasUnsavedChanges={hasUnsavedChanges}
              dropIndicator={dropIndicator}
              canReorder={canEdit}
              onSelectRole={setSelectedRoleId}
              onBlockedSelect={() =>
                toast.warning("Save or cancel changes before switching roles.")
              }
              onDragStartRole={handleDragStartRole}
              onDragOverRole={handleDragOverRole}
              onDragLeaveRole={handleDragLeaveRole}
              onDropRole={handleDropRole}
              onDragEndRole={handleDragEndRole}
            />

            <Separator orientation="vertical" className="hidden md:block" />
            <Separator orientation="horizontal" className="md:hidden" />

            <div className="min-w-0 flex-1 self-stretch">
              <RoleDetailsPanel
                selectedRole={selectedRole}
                groupedPermissions={groupedPermissions}
                permissions={permissions}
                draftRolePermissions={draftRolePermissions}
                isDeletingRole={isDeletingRole}
                readOnly={!canEdit}
                onUpdateRole={updateSelectedRole}
                onToggleAllPermissions={handleToggleAllPermissions}
                onTogglePermissionSection={handleTogglePermissionSection}
                onTogglePermission={handleTogglePermission}
                onOpenDeleteDialog={() => setDeleteDialogOpen(true)}
              />
            </div>
          </div>

          {hasUnsavedChanges ? (
            <UnsavedChangesBar
              isSaving={isSaving}
              onCancelChanges={handleCancelDraft}
              onSaveChanges={handleSaveDraft}
            />
          ) : null}
        </div>
      )}

      <CreateRoleDialog
        open={createDialogOpen}
        form={createForm}
        error={createError}
        isCreatingRole={isCreatingRole}
        onOpenChange={setCreateDialogOpen}
        onFormChange={setCreateForm}
        onSubmit={handleCreateRole}
        onCancel={() => {
          setCreateDialogOpen(false);
          setCreateError("");
        }}
      />

      <DeleteRoleDialog
        open={deleteDialogOpen}
        roleName={selectedRole?.name}
        isDeletingRole={isDeletingRole}
        onOpenChange={setDeleteDialogOpen}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteRole}
      />
    </div>
  );
}
