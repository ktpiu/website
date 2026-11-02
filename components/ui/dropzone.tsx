"use client";

import { useDropzone, type Accept } from "react-dropzone";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  accept: Accept;
  /** Called with the accepted files, in the order they were dropped. */
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  /** Shown under the prompt, e.g. "PDF, up to 4MB". */
  hint?: string;
  /** Shown when a dropped file isn't one of the accepted types. */
  rejectMessage?: string;
  id?: string;
  "aria-label"?: string;
};

/** Supabase UI's drag-and-drop box. Uploading stays with the caller. */
export function Dropzone({ accept, onFiles, multiple = false, disabled, hint, rejectMessage, id, ...rest }: Props) {
  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept,
    multiple,
    disabled,
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) toast.error(rejectMessage ?? "That file type isn't allowed.");
      if (accepted.length > 0) onFiles(accepted);
    },
  });

  return (
    <div
      {...getRootProps({
        className: cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors hover:bg-muted/50",
          isDragActive && "border-primary bg-primary/5",
          isDragReject && "border-destructive bg-destructive/5",
          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        ),
      })}
    >
      <input {...getInputProps({ id, "aria-label": rest["aria-label"] })} />
      <Upload className="mb-1 h-5 w-5 text-muted-foreground" />
      <p className="text-sm">
        {isDragActive ? (
          "Drop to upload"
        ) : (
          <>
            Drag and drop {multiple ? "files" : "a file"}, or <span className="underline underline-offset-4">select</span>
          </>
        )}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
