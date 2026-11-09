"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DeleteUserDialogProps = {
  open: boolean;
  /** One name, or several for a bulk delete. */
  userNames?: string[];
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function DeleteUserDialog({
  open,
  userNames,
  isDeleting,
  onOpenChange,
  onCancel,
  onConfirm,
}: DeleteUserDialogProps) {
  const names = userNames ?? [];
  const many = names.length > 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{many ? `Delete ${names.length} users` : "Delete User"}</DialogTitle>
          <DialogDescription>
            {many
              ? `Delete these ${names.length} accounts? This action cannot be undone.`
              : names[0]
                ? `Delete ${names[0]}'s account? This action cannot be undone.`
                : "This action cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        {many ? (
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
            {names.map((name, i) => (
              <li key={`${name}-${i}`}>{name}</li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : many ? `Delete ${names.length} users` : "Delete User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
