/**
 * Limits for election uploads. Dependency-free so forms (pre-flight) and API
 * routes (authoritative check) share them.
 */
// Each upload is its own request, so it only has to fit under Vercel's
// 4.5MB body cap.
export const TRANSCRIPT_MAX_BYTES = 4 * 1024 * 1024;

export const TRANSCRIPT_ACCEPT = "application/pdf,.pdf";

export function validateTranscriptFile(file: { type: string; size: number; name: string }): string | null {
  const isPdf = file.type === "application/pdf" || (!file.type && file.name.toLowerCase().endsWith(".pdf"));
  if (!isPdf) return "Transcripts must be a PDF.";
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > TRANSCRIPT_MAX_BYTES) {
    return `Transcripts must be ${Math.floor(TRANSCRIPT_MAX_BYTES / 1024 / 1024)}MB or smaller.`;
  }
  return null;
}

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const MAX_PHOTOS = 5;

export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const PHOTO_ACCEPT = Object.keys(PHOTO_TYPES).join(",");

export function validatePhotoFile(file: { type: string; size: number }): string | null {
  if (!PHOTO_TYPES[file.type]) return "Photos must be a JPEG, PNG or WebP image.";
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > PHOTO_MAX_BYTES) return `Photos must be ${Math.floor(PHOTO_MAX_BYTES / 1024 / 1024)}MB or smaller.`;
  return null;
}
