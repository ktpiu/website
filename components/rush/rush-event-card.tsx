/* eslint-disable @next/next/no-img-element -- signed storage URLs aren't configured for next/image */
import { CalendarClock, MapPin, Shirt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRange } from "@/lib/rush/client";

export type RushEventCardData = {
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  locationName?: string | null;
  locationUrl?: string | null;
  dressCode?: string | null;
  imageUrl?: string | null;
};

export function RushEventCard({ event, children, badge }: { event: RushEventCardData; children?: React.ReactNode; badge?: React.ReactNode }) {
  const start = new Date(event.startsAt);
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="relative h-36 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
        {event.imageUrl ? (
          <img src={event.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <div className="absolute left-3 top-3 flex h-14 w-14 flex-col items-center justify-center rounded-lg bg-background/95 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">
            {start.toLocaleDateString("en-US", { month: "short" })}
          </span>
          <span className="text-lg font-bold leading-none">{start.getDate()}</span>
        </div>
        {badge ? <div className="absolute right-3 top-3">{badge}</div> : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-lg font-semibold leading-tight">{event.title}</h3>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4 shrink-0" />
          {formatRange(event.startsAt, event.endsAt)}
        </p>
        {event.locationName ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            {event.locationUrl ? (
              <a href={event.locationUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {event.locationName}
              </a>
            ) : (
              event.locationName
            )}
          </p>
        ) : null}
        {event.dressCode ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shirt className="h-4 w-4 shrink-0" />
            {event.dressCode}
          </p>
        ) : null}
        {event.description ? <p className="whitespace-pre-wrap pt-1 text-sm">{event.description}</p> : null}
        {children}
      </div>
    </article>
  );
}

export function ClosedBadge() {
  return <Badge variant="secondary">Closed rush</Badge>;
}
