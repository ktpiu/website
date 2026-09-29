"use client";

import { User as SupabaseUser } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, Instagram, Linkedin, Shield, User } from "lucide-react";
import { useRef, useState } from "react";
import {
  RoleOption,
  STATUS_FLAGS,
  StatusFlagKey,
} from "@/components/member-portal/admin/users/users-utils";
import { AVATAR_ACCEPT, validateAvatarFile } from "@/lib/avatar-upload";
import { AvatarCropDialog } from "@/components/avatar-crop-dialog";

export type EditDialogSection = "profile" | "roles";
export type SocialPlatform = "insta" | "linkedin";

type EditUserDialogValues = {
  name: string;
  email: string;
  major: string;
  graduationYear: string;
  instagramUrl: string;
  linkedinUrl: string;
};

type EditUserDialogProps = {
  currentUser: SupabaseUser;
  open: boolean;
  section: EditDialogSection;
  values: EditUserDialogValues;
  roles: RoleOption[];
  selectedRoleIds: string[];
  flags: Record<StatusFlagKey, boolean>;
  error?: string;
  isSaving: boolean;
  isUploadingAvatar: boolean;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: EditDialogSection) => void;
  onFieldChange: (field: keyof EditUserDialogValues, value: string) => void;
  onFlagChange: (flag: StatusFlagKey, checked: boolean) => void;
  onRoleToggle: (roleId: string, checked: boolean) => void;
  onAvatarUpload: (file: File) => Promise<void>;
  onAvatarError: (message: string) => void;
  onSave: () => Promise<void>;
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function EditUserDialog({
  currentUser,
  open,
  section,
  values,
  roles,
  selectedRoleIds,
  flags,
  error,
  isSaving,
  isUploadingAvatar,
  onOpenChange,
  onSectionChange,
  onFieldChange,
  onFlagChange,
  onRoleToggle,
  onAvatarUpload,
  onAvatarError,
  onSave,
}: EditUserDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const hasAvatar = Boolean(currentUser.avatar);

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so selecting the same file again re-triggers onChange.
    event.target.value = "";
    if (!file) return;

    const validationError = validateAvatarFile(file);
    if (validationError) {
      onAvatarError(validationError);
      return;
    }

    // Let the admin crop before anything is uploaded.
    setPendingAvatarFile(file);
  };

  const handleCropConfirm = async (croppedFile: File) => {
    await onAvatarUpload(croppedFile);
    setPendingAvatarFile(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[85vh] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update profile information for {currentUser.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col gap-4 sm:flex-row sm:items-stretch">
          <div className="sm:w-44 rounded-lg border p-2">
            <button
              type="button"
              onClick={() => onSectionChange("profile")}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                section === "profile"
                  ? "bg-accent font-medium"
                  : "hover:bg-muted"
              }`}
            >
              <span className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Profile
              </span>
            </button>
            <button
              type="button"
              onClick={() => onSectionChange("roles")}
              className={`mt-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                section === "roles" ? "bg-accent font-medium" : "hover:bg-muted"
              }`}
            >
              <span className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Roles
              </span>
            </button>
          </div>
          <div
            className={`flex-1 min-h-0 px-1 ${
              section === "profile" ? "overflow-y-auto space-y-3" : ""
            }`}
          >
            {section === "profile" ? (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Profile Picture</p>
                  <div className="flex items-center gap-4 rounded-md border p-3">
                    <Avatar className="h-16 w-16 rounded-lg">
                      <AvatarImage
                        src={currentUser.avatar}
                        alt={currentUser.name}
                        className="object-cover"
                      />
                      <AvatarFallback className="h-16 w-16 rounded-lg text-lg">
                        {getInitials(currentUser.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        disabled={isUploadingAvatar || isSaving}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Camera className="h-4 w-4" />
                        {isUploadingAvatar
                          ? "Uploading..."
                          : hasAvatar
                            ? "Replace Photo"
                            : "Upload Photo"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        JPEG, PNG, WebP, or GIF up to 4MB. You can crop it
                        before saving.
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={AVATAR_ACCEPT}
                      className="hidden"
                      onChange={handleFileSelected}
                    />
                  </div>
                  <AvatarCropDialog
                    open={pendingAvatarFile !== null}
                    file={pendingAvatarFile}
                    isUploading={isUploadingAvatar}
                    onOpenChange={(nextOpen) => {
                      if (!nextOpen) setPendingAvatarFile(null);
                    }}
                    onConfirm={handleCropConfirm}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Name</p>
                  <Input
                    value={values.name}
                    onChange={(event) =>
                      onFieldChange("name", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Email</p>
                  <Input value={values.email} disabled />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Major</p>
                  <Input
                    value={values.major}
                    onChange={(event) =>
                      onFieldChange("major", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Graduation Year</p>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={2000}
                    max={2100}
                    placeholder="e.g. 2028"
                    value={values.graduationYear}
                    onChange={(event) =>
                      onFieldChange("graduationYear", event.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Grade (Freshman through Senior) is derived from this year.
                  </p>
                </div>
                {STATUS_FLAGS.map((flag) => (
                  <div
                    key={flag.key}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{flag.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {flag.description}
                      </p>
                    </div>
                    <Switch
                      checked={flags[flag.key]}
                      onCheckedChange={(checked) =>
                        onFlagChange(flag.key, checked)
                      }
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <p className="text-sm font-medium">Instagram URL</p>
                  <div className="relative">
                    <Instagram className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                    <Input
                      className="pl-9"
                      placeholder="https://instagram.com/username"
                      value={values.instagramUrl}
                      onChange={(event) =>
                        onFieldChange("instagramUrl", event.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">LinkedIn URL</p>
                  <div className="relative">
                    <Linkedin className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                    <Input
                      className="pl-9"
                      placeholder="https://linkedin.com/in/username"
                      value={values.linkedinUrl}
                      onChange={(event) =>
                        onFieldChange("linkedinUrl", event.target.value)
                      }
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full min-h-0 flex flex-col space-y-2">
                <p className="text-sm font-medium">Roles</p>
                {roles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No roles available.
                  </p>
                ) : (
                  <ScrollArea className="flex-1 min-h-0 rounded-md border p-2">
                    <div className="space-y-2">
                      {roles.map((roleItem) => {
                        const isChecked = selectedRoleIds.includes(roleItem.id);
                        return (
                          <div
                            key={roleItem.id}
                            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                          >
                            <span className="text-sm">{roleItem.name}</span>
                            <Switch
                              checked={isChecked}
                              onCheckedChange={(checked) =>
                                onRoleToggle(roleItem.id, checked)
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </div>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <DialogFooter className="gap-2 sm:justify-end">
          <Button size="sm" onClick={() => void onSave()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
