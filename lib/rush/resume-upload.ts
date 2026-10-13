/**
 * Constraints for PNM resume uploads. Dependency-free so the apply form
 * (pre-flight) and the API route (authoritative check) share it.
 */
// Sent alongside the headshot in one request, so both must fit under
// Vercel's 4.5MB body cap.
export const RESUME_MAX_BYTES = 3 * 1024 * 1024;

export const RESUME_ACCEPT = "application/pdf,.pdf";

export function validateResumeFile(file: { type: string; size: number; name: string }): string | null {
  const isPdf = file.type === "application/pdf" || (!file.type && file.name.toLowerCase().endsWith(".pdf"));
  if (!isPdf) return "Resumes must be a PDF.";
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > RESUME_MAX_BYTES) {
    return `Resumes must be ${Math.floor(RESUME_MAX_BYTES / 1024 / 1024)}MB or smaller.`;
  }
  return null;
}
