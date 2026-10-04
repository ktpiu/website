"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import {
  RushEventCard,
  EventStatusBadge,
  type RushEventCardData,
} from "@/components/rush/rush-event-card";
import { FAQSection } from "@/components/sections/faq-section";

type Overview = {
  cycle: {
    label: string;
    phase: "open" | "closed" | "concluded";
    applicationsOpen: boolean;
  } | null;
  events: Array<RushEventCardData & { id: string }>;
  contacts: Array<{
    id: string;
    name: string;
    avatar: string | null;
    title: string;
    email: string | null;
    phone: string | null;
  }>;
};

const STEPS = [
  {
    // icon: Users,
    title: "Open Rush",
    body: "Anyone can come. Meet the chapter at our open events, and learn what KTP is all about!",
  },
  {
    // icon: ClipboardList,
    title: "Application",
    body: "Submit a short application to help us learn more about your background and interest in KTP.",
  },
  {
    // icon: Sparkles,
    title: "Closed Rush",
    body: "Invite-only events like dinners and interviews to get to know the brothers in a more personal environment.",
  },
  {
    // icon: PartyPopper,
    title: "Bid Day",
    body: "Receive your bid from PFC, and accept to join KTP's newest pledge class!",
  },
];

export default function RushPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/rush/public/overview")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  // Open rush is "active" while the current cycle is in open rush and taking applications.
  const inOpenRush = data?.cycle?.phase === "open";
  const openRushActive = inOpenRush && Boolean(data?.cycle?.applicationsOpen);

  const now = Date.now();
  const events = data?.events ?? [];

  return (
    <main>
      <section className="relative overflow-hidden border-b bg-muted/40 py-20 sm:py-28">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary/70">
            {data?.cycle?.label ?? ""}
          </p>
          <h1 className="mb-5 text-4xl font-bold tracking-tighter sm:text-6xl">
            Rush KTP
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Kappa Theta Pi is Indiana University&apos;s professional technology
            fraternity. Rush is how we get to know you, and how you get to know
            us.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {openRushActive ? (
              <Button asChild size="lg">
                <Link href="/rush/apply">
                  Apply now <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button size="lg" disabled>
                Apply now <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in?redirect_url=/rush/portal">Log in</Link>
            </Button>
          </div>
          {data && !openRushActive ? (
            <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
              {inOpenRush
                ? "Applications aren't open yet. Come to an open rush event below to meet us in the meantime!"
                : "This semester's open rush process has concluded. We'd love to meet you next semester!"}
            </p>
          ) : null}
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <h2 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
            How rush works
          </h2>
          <p className="mb-10 text-muted-foreground">
            Four steps from your first event to your bid.
          </p>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <CardContent className="space-y-3 pt-6">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                      {/* <step.icon className="h-5 w-5 text-muted-foreground" /> */}
                    </div>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="events"
        className="scroll-mt-20 border-y bg-muted/30 py-16 sm:py-20"
      >
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <h2 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Open rush events
          </h2>
          <p className="mb-10 text-muted-foreground">
            Everyone is welcome. Bring a friend.
          </p>
          {!data && !failed ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-72 rounded-xl" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              {failed
                ? "We couldn't load events right now."
                : "No open rush events are scheduled yet. Check back soon!"}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <RushEventCard
                  key={event.id}
                  event={event}
                  badge={<EventStatusBadge startsAt={event.startsAt} endsAt={event.endsAt} now={now} />}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {data && data.contacts.length > 0 ? (
        <section className="py-16 sm:py-20">
          <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Questions? Reach out
            </h2>
            <p className="mb-10 text-muted-foreground">
              Our rush directors are happy to help.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.contacts.map((contact) => (
                <Card key={contact.id}>
                  <CardContent className="flex items-start gap-4 pt-6">
                    <PnmAvatar
                      name={contact.name}
                      src={contact.avatar}
                      className="h-14 w-14"
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold">{contact.name}</p>
                      {contact.title ? (
                        <p className="text-sm text-muted-foreground">
                          {contact.title}
                        </p>
                      ) : null}
                      {contact.email ? (
                        <a
                          href={`mailto:${contact.email}`}
                          className="flex items-center gap-1.5 truncate text-sm underline-offset-2 hover:underline"
                        >
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          {contact.email}
                        </a>
                      ) : null}
                      {contact.phone ? (
                        <a
                          href={`tel:${contact.phone}`}
                          className="flex items-center gap-1.5 text-sm underline-offset-2 hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          {contact.phone}
                        </a>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* <section className="border-t bg-muted/30 py-16 sm:py-20"> */}
        {/* <div className="container mx-auto max-w-3xl px-4 sm:px-6 lg:px-8"> */}
          <FAQSection />
        {/* </div> */}
      {/* </section> */}
    </main>
  );
}
