"use client";

import { Trash2, Shield } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PermissionRecord, RoleRecord, ROLE_TYPE_OPTIONS } from "@/types";
import { RoleTypeSelect } from "@/components/member-portal/admin/role-type-select";

type RoleDetailsPanelProps = {
  selectedRole: RoleRecord | null;
  groupedPermissions: ReadonlyArray<readonly [string, PermissionRecord[]]>;
  permissions: PermissionRecord[];
  draftRolePermissions: Record<string, Set<string>>;
  isDeletingRole: boolean;
  readOnly: boolean;
  onUpdateRole: (updates: Partial<RoleRecord>) => void;
  onToggleAllPermissions: (checked: boolean) => void;
  onTogglePermissionSection: (
    sectionPermissions: PermissionRecord[],
    checked: boolean,
  ) => void;
  onTogglePermission: (permissionKey: string, checked: boolean) => void;
  onOpenDeleteDialog: () => void;
};

export function RoleDetailsPanel({
  selectedRole,
  groupedPermissions,
  permissions,
  draftRolePermissions,
  isDeletingRole,
  readOnly,
  onUpdateRole,
  onToggleAllPermissions,
  onTogglePermissionSection,
  onTogglePermission,
  onOpenDeleteDialog,
}: RoleDetailsPanelProps) {
  if (!selectedRole) {
    return (
      <Empty className="h-full min-h-[calc(100dvh-13rem)] border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Shield className="size-5" />
          </EmptyMedia>
          <EmptyTitle>Select a role</EmptyTitle>
          <EmptyDescription>
            Choose a role from the list to view or edit details and permissions.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{selectedRole.name}</h2>
      </div>
      <Tabs defaultValue="info" className="gap-4">
        <TabsList>
          <TabsTrigger value="info">Display</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Role Name <span className="text-destructive">*</span>
            </label>
            <Input
              disabled={readOnly}
              value={selectedRole.name}
              onChange={(event) => onUpdateRole({ name: event.target.value })}
              placeholder="e.g. Events Director"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              rows={4}
              disabled={readOnly}
              value={selectedRole.description}
              onChange={(event) =>
                onUpdateRole({ description: event.target.value })
              }
              placeholder="Explain what this role can do."
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Role Type</label>
            <RoleTypeSelect
              value={selectedRole.type}
              disabled={readOnly}
              onChange={(type) => onUpdateRole({ type })}
            />
            <p className="text-xs text-muted-foreground">
              {
                ROLE_TYPE_OPTIONS.find((option) => option.value === selectedRole.type)
                  ?.description
              }
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Hidden Role</p>
              <p className="text-xs text-muted-foreground">
                Hidden roles can be used internally without being listed in
                standard views.
              </p>
            </div>
            <Switch
              disabled={readOnly}
              checked={selectedRole.hidden}
              onCheckedChange={(checked) => onUpdateRole({ hidden: checked })}
            />
          </div>

          {readOnly ? null : (
            <div className="pt-2">
              <Button
                variant="destructive"
                onClick={onOpenDeleteDialog}
                disabled={isDeletingRole}
              >
                <Trash2 className="mr-2 size-4" />
                Delete Role
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="permissions" className="space-y-4">
          {groupedPermissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No permissions are available.
            </p>
          ) : (
            <div className="max-h-[520px] space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between border-b pb-3">
                <p className="text-sm font-medium">Grant all permissions</p>
                <Switch
                  disabled={readOnly}
                  checked={permissions.every((permission) =>
                    Boolean(
                      draftRolePermissions[selectedRole.id]?.has(
                        permission.key,
                      ),
                    ),
                  )}
                  onCheckedChange={onToggleAllPermissions}
                />
              </div>

              {groupedPermissions.map(([section, sectionPermissions]) => (
                <div key={section} className="space-y-2 border-b pb-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section}
                    </p>
                    <Switch
                      disabled={readOnly}
                      checked={sectionPermissions.every((permission) =>
                        Boolean(
                          draftRolePermissions[selectedRole.id]?.has(
                            permission.key,
                          ),
                        ),
                      )}
                      onCheckedChange={(checked) =>
                        onTogglePermissionSection(sectionPermissions, checked)
                      }
                    />
                  </div>
                  {sectionPermissions.map((permission) => (
                    <div
                      key={permission.key}
                      className="flex items-start justify-between gap-4 py-2"
                    >
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {permission.description || "No description"}
                        </p>
                      </div>
                      <Switch
                        disabled={readOnly}
                        checked={Boolean(
                          draftRolePermissions[selectedRole.id]?.has(
                            permission.key,
                          ),
                        )}
                        onCheckedChange={(checked) =>
                          onTogglePermission(permission.key, checked)
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
