"use client";

import { use, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/ui/people-selector";
import { EndorseDialog } from "@/components/member-portal/elections/endorse-dialog";
import { errorMessage, initials, rushFetch } from "@/lib/rush/client";
import { videoEmbedUrl } from "@/lib/elections/video";
import {
  ENDORSEMENT_STATUS_LABELS,
  endorsementsOpen,
  profilesOpen,
  type CandidateProfile,
  type Election,
} from "@/lib/elections/types";

/** A YouTube or Drive player, or a plain link when the URL can't be embedded. */
function VideoPlayer({ url, title }: { url: string; title: string }) {
  const embed = videoEmbedUrl(url);
  if (!embed) {
    return (
      <a className="break-all text-sm underline underline-offset-4" href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
    );
  }
  return (
    <div className="space-y-1">
      <div className="aspect-video overflow-hidden rounded-lg border bg-muted">
        <iframe
          src={embed}
          title={title}
          className="h-full w-full"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <a className="text-xs text-muted-foreground underline underline-offset-4" href={url} target="_blank" rel="noreferrer">
        Open in a new tab
      </a>
    </div>
  );
}

/**
 * A full-screen photo viewer. Closes on the X, a click outside the photo or
 * Escape; arrow keys move between photos.
 */
function PhotoLightbox({
  photos,
  index,
  name,
  onIndex,
  onClose,
}: {
  photos: Array<{ id: string; url: string | null }>;
  index: number;
  name: string;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const count = photos.length;
  const step = (delta: number) => onIndex((index + delta + count) % count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && count > 1) onIndex((index - 1 + count) % count);
      else if (e.key === "ArrowRight" && count > 1) onIndex((index + 1) % count);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [count, index, onClose, onIndex]);

  const photo = photos[index];
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-10"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close photo"
        className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
        onClick={onClose}
      >
        <X className="size-6" />
      </button>
      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
          >
            <ChevronRight className="size-6" />
          </button>
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70">
            {index + 1} / {count}
          </p>
        </>
      ) : null}
      {photo?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.url}
          alt={`${name}, photo ${index + 1}`}
          className="max-h-full max-w-full rounded-md object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
    </div>,
    document.body,
  );
}

/** One profile per role (`?role=<candidacy id>`). Photos, intro and awards are shared. */
export default function CandidateProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { candidateId } = use(params);
  const { role } = use(searchParams);
  const queryClient = useQueryClient();
  const key = ["elections", "profile", candidateId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => rushFetch<{ election: Election; profile: CandidateProfile }>(`/api/elections/current/candidates/${candidateId}`),
  });
  const [endorsing, setEndorsing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href="/member-portal/elections">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> All candidates
      </Link>
    </Button>
  );

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 pb-10">
        {back}
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 pb-10">
        {back}
        <Card>
          <CardContent className="text-sm text-muted-foreground">{errorMessage(query.error)}</CardContent>
        </Card>
      </div>
    );
  }

  const { election, profile } = query.data;
  const seat = profile.seats.find((s) => s.candidacy_id === role) ?? profile.seats[0];
  const canEndorse = endorsementsOpen(election) && !profile.is_me;
  const preview = profile.is_me && !profilesOpen(election);
  const materialsVisible = profile.materials_visible;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      {back}

      {preview ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            This is a preview of your profile. Members can see it after the submission deadline.
          </CardContent>
        </Card>
      ) : null}

      {!materialsVisible ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Candidate materials aren&apos;t available yet. You can read endorsements below.
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="h-16 w-16">
          {profile.avatar ? <AvatarImage src={profile.avatar} alt="" /> : null}
          <AvatarFallback>{initials(profile.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{profile.name}</h1>
          <div className="flex flex-wrap gap-1.5">
            {profile.seats.map((s) => (
              <Badge key={s.position_id} variant={s === seat ? "default" : "outline"} asChild>
                <Link href={`/member-portal/elections/candidates/${candidateId}?role=${s.candidacy_id}`} replace scroll={false}>
                  {s.title}
                </Link>
              </Badge>
            ))}
          </div>
        </div>
        {canEndorse ? (
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => setEndorsing(true)}>{seat.my_endorsement ? "Edit endorsement" : "Endorse"}</Button>
            {seat.my_endorsement ? (
              <span className="text-xs text-muted-foreground">
                {ENDORSEMENT_STATUS_LABELS[seat.my_endorsement.status]}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {profile.photos.length > 0 ? (
        <Carousel className="mx-auto w-full max-w-md" opts={{ loop: profile.photos.length > 1 }}>
          <CarouselContent>
            {profile.photos.map((photo, index) => (
              <CarouselItem key={photo.id}>
                <button
                  type="button"
                  className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted"
                  aria-label={`View photo ${index + 1} full screen`}
                  onClick={() => setViewing(index)}
                  disabled={!photo.url}
                >
                  {photo.url ? (
                    // Signed URLs from private storage; next/image would need the host configured.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt={`${profile.name}, photo ${index + 1}`} className="h-full w-full object-cover" />
                  ) : null}
                </button>
              </CarouselItem>
            ))}
          </CarouselContent>
          {profile.photos.length > 1 ? (
            <>
              <CarouselPrevious className="left-2" />
              <CarouselNext className="right-2" />
            </>
          ) : null}
        </Carousel>
      ) : null}

      {materialsVisible ? (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Introduction</CardTitle>
          </CardHeader>
          <CardContent>
            {profile.intro ? (
              <p className="whitespace-pre-wrap text-sm leading-6">{profile.intro}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No introduction submitted.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Initiatives: {seat.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {seat.video_url ? (
              <VideoPlayer url={seat.video_url} title={`${profile.name}: ${seat.title} initiatives`} />
            ) : (
              <p className="text-sm text-muted-foreground">No video submitted.</p>
            )}
          </CardContent>
        </Card>
        </>
      ) : null}

      {profile.awards ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Awards, projects and experience</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6">{profile.awards}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Endorsements: {seat.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {seat.endorsements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No endorsements yet.</p>
          ) : (
            <ul className="space-y-4">
              {seat.endorsements.map((e) => (
                <li key={e.id} className="space-y-1.5">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <PersonAvatar name={e.author_name} avatar={e.author_avatar} />
                    {e.author_name}
                  </p>
                  {e.kind === "text" ? (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{e.body}</p>
                  ) : e.video_url ? (
                    <VideoPlayer url={e.video_url} title={`Endorsement from ${e.author_name}`} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {viewing !== null ? (
        <PhotoLightbox
          photos={profile.photos}
          index={viewing}
          name={profile.name}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {endorsing ? (
        <EndorseDialog
          key={seat.candidacy_id}
          target={{
            candidate_id: profile.candidate_id,
            candidacy_id: seat.candidacy_id,
            name: profile.name,
            title: seat.title,
            my_endorsement: seat.my_endorsement,
          }}
          onClose={() => setEndorsing(false)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: key });
            void queryClient.invalidateQueries({ queryKey: ["elections", "ballot"] });
          }}
        />
      ) : null}
    </div>
  );
}
