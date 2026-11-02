/**
 * Turns a candidate's YouTube or Google Drive link into an embeddable player
 * URL. Null when the link isn't one we can embed; callers fall back to a
 * plain link.
 */
export function videoEmbedUrl(link: string | null | undefined): string | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");

  let youtubeId: string | null = null;
  if (host === "youtu.be") youtubeId = url.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com") {
    if (url.pathname === "/watch") youtubeId = url.searchParams.get("v");
    const match = /^\/(shorts|embed|live)\/([^/]+)/.exec(url.pathname);
    if (match) youtubeId = match[2];
  }
  if (youtubeId && /^[\w-]{6,20}$/.test(youtubeId)) {
    return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
  }

  if (host === "drive.google.com") {
    const match = /^\/file\/d\/([\w-]+)/.exec(url.pathname);
    const id = match?.[1] ?? url.searchParams.get("id");
    if (id && /^[\w-]+$/.test(id)) return `https://drive.google.com/file/d/${id}/preview`;
  }
  return null;
}
