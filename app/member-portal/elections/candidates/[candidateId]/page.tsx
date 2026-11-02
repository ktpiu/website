"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
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

export default function CandidateProfilePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = use(params);
  const queryClient = useQueryClient();
  const key = ["elections", "profile", candidateId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => rushFetch<{ election: Election; profile: CandidateProfile }>(`/api/elections/current/candidates/${candidateId}`),
  });
  const [endorsing, setEndorsing] = useState(false);

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
          <CardContent className="pt-6 text-sm text-muted-foreground">{errorMessage(query.error)}</CardContent>
        </Card>
      </div>
    );
  }

  const { election, profile } = query.data;
  const canEndorse = endorsementsOpen(election) && !profile.is_me;
  const preview = profile.is_me && !profilesOpen(election);

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      {back}

      {preview ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This is a preview of your profile. Members can see it after the submission deadline.
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
              <Badge key={s.position_id} variant="secondary">
                {s.title}
              </Badge>
            ))}
          </div>
        </div>
        {canEndorse ? (
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => setEndorsing(true)}>{profile.my_endorsement ? "Edit endorsement" : "Endorse"}</Button>
            {profile.my_endorsement ? (
              <span className="text-xs text-muted-foreground">
                {ENDORSEMENT_STATUS_LABELS[profile.my_endorsement.status]}
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
                <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
                  {photo.url ? (
                    // Signed URLs from private storage; next/image would need the host configured.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt={`${profile.name}, photo ${index + 1}`} className="h-full w-full object-cover" />
                  ) : null}
                </div>
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

      {profile.seats.map((seat) => (
        <Card key={seat.position_id}>
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
      ))}

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
          <CardTitle className="text-base">Endorsements</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.endorsements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No endorsements yet.</p>
          ) : (
            <ul className="space-y-4">
              {profile.endorsements.map((e) => (
                <li key={e.id} className="space-y-1.5">
                  <p className="text-sm font-medium">{e.author_name}</p>
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

      {endorsing ? (
        <EndorseDialog
          target={{ candidate_id: profile.candidate_id, name: profile.name, my_endorsement: profile.my_endorsement }}
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
