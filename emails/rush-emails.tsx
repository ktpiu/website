import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "react-email";
import type { ReactNode } from "react";

/**
 * React Email templates for the rush system. Rendered to HTML in
 * lib/email/plunk.ts and sent through Plunk.
 */

const colors = {
  ink: "#0f172a",
  muted: "#475569",
  border: "#e2e8f0",
  bg: "#f8fafc",
  accent: "#1e3a8a",
};

function Layout({
  preview,
  siteUrl,
  children,
}: {
  preview: string;
  siteUrl: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.bg, fontFamily: "Helvetica, Arial, sans-serif", margin: 0 }}>
        <Container
          style={{
            maxWidth: 520,
            margin: "32px auto",
            backgroundColor: "#ffffff",
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: "32px 28px",
          }}
        >
          <Img
            src={`${siteUrl}/ktp-logos/KTP%20Logo%20Plain%20Text%20Slim.png`}
            alt="Kappa Theta Pi"
            width={120}
            style={{ marginBottom: 24 }}
          />
          {children}
          <Hr style={{ borderColor: colors.border, margin: "28px 0 16px" }} />
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: "18px", margin: 0 }}>
            Kappa Theta Pi · Indiana University. You&apos;re receiving this because you signed up for
            a KTP rush event.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const h1 = { color: colors.ink, fontSize: 22, fontWeight: 700, margin: "0 0 12px" } as const;
const p = { color: colors.ink, fontSize: 15, lineHeight: "24px", margin: "0 0 12px" } as const;
const detail = { color: colors.muted, fontSize: 14, lineHeight: "22px", margin: 0 } as const;
const button = {
  backgroundColor: colors.accent,
  color: "#ffffff",
  borderRadius: 8,
  padding: "12px 20px",
  fontSize: 15,
  fontWeight: 600,
  textDecoration: "none",
} as const;

function Details({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  const shown = rows.filter(([, v]) => v);
  if (shown.length === 0) return null;
  return (
    <Section
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: "12px 16px",
        margin: "16px 0",
      }}
    >
      {shown.map(([label, value]) => (
        <Text key={label} style={detail}>
          <strong style={{ color: colors.ink }}>{label}:</strong> {value}
        </Text>
      ))}
    </Section>
  );
}

function Cta({ href, label }: { href: string; label: string }) {
  return (
    <Section style={{ margin: "20px 0 8px" }}>
      <Button href={href} style={button}>
        {label}
      </Button>
    </Section>
  );
}

type Base = { name: string; siteUrl: string };

export function CheckInConfirmationEmail({
  name,
  siteUrl,
  eventTitle,
  when,
  location,
  setupUrl,
}: Base & { eventTitle: string; when: string; location?: string | null; setupUrl?: string | null }) {
  return (
    <Layout preview={`You're checked in to ${eventTitle}`} siteUrl={siteUrl}>
      <Heading style={h1}>You&apos;re checked in!</Heading>
      <Text style={p}>Hi {name.split(" ")[0]}, thanks for coming out to {eventTitle}.</Text>
      <Details rows={[["Event", eventTitle], ["When", when], ["Where", location]]} />
      {setupUrl ? (
        <>
          <Text style={p}>
            Set a password to see your rush events and sign up for timeslots. It only takes a minute.
          </Text>
          <Cta href={setupUrl} label="Set up your account" />
        </>
      ) : (
        <Cta href={`${siteUrl}/rush/portal`} label="Open your rush portal" />
      )}
    </Layout>
  );
}

export function ApplicationReceivedEmail({
  name,
  siteUrl,
  cycleLabel,
  setupUrl,
}: Base & { cycleLabel: string; setupUrl?: string | null }) {
  return (
    <Layout preview="We received your KTP application" siteUrl={siteUrl}>
      <Heading style={h1}>Application received</Heading>
      <Text style={p}>
        Hi {name.split(" ")[0]}, thanks for applying to Kappa Theta Pi for {cycleLabel}. The rush
        committee will review your application and reach out with next steps.
      </Text>
      {setupUrl ? (
        <>
          <Text style={p}>Create an account to stay in touch and keep track of your rush events.</Text>
          <Cta href={setupUrl} label="Create your account" />
        </>
      ) : (
        <Cta href={`${siteUrl}/rush/portal`} label="Open your rush portal" />
      )}
    </Layout>
  );
}

export function AccountSetupEmail({ name, siteUrl, setupUrl }: Base & { setupUrl: string }) {
  return (
    <Layout preview="Set up your KTP rush account" siteUrl={siteUrl}>
      <Heading style={h1}>Set up your rush account</Heading>
      <Text style={p}>
        Hi {name.split(" ")[0]}, choose a password to see your rush events, check your attendance
        and sign up for timeslots.
      </Text>
      <Cta href={setupUrl} label="Set up your account" />
      <Text style={detail}>This link expires in 7 days.</Text>
    </Layout>
  );
}

export function SlotUpdateEmail({
  name,
  siteUrl,
  eventTitle,
  action,
  when,
  location,
}: Base & {
  eventTitle: string;
  action: "booked" | "moved" | "cancelled";
  when?: string | null;
  location?: string | null;
}) {
  const heading =
    action === "cancelled" ? "Timeslot cancelled" : action === "moved" ? "Timeslot changed" : "Timeslot confirmed";
  return (
    <Layout preview={`${heading}: ${eventTitle}`} siteUrl={siteUrl}>
      <Heading style={h1}>{heading}</Heading>
      <Text style={p}>
        Hi {name.split(" ")[0]},{" "}
        {action === "cancelled"
          ? `your timeslot for ${eventTitle} has been cancelled.`
          : `here are the details for your ${eventTitle} timeslot.`}
      </Text>
      {action !== "cancelled" && <Details rows={[["Event", eventTitle], ["When", when], ["Where", location]]} />}
      <Cta href={`${siteUrl}/rush/portal`} label="View your rush portal" />
    </Layout>
  );
}

export function ClosedRushInviteEmail({
  name,
  siteUrl,
  cycleLabel,
  setupUrl,
}: Base & { cycleLabel: string; setupUrl?: string | null }) {
  return (
    <Layout preview={`You're invited to ${cycleLabel}`} siteUrl={siteUrl}>
      <Heading style={h1}>Congratulations!</Heading>
      <Text style={p}>
        Hi {name.split(" ")[0]}, you&apos;ve been invited to {cycleLabel}. Closed rush events and
        timeslot signups are now available in your rush portal.
      </Text>
      {setupUrl ? (
        <Cta href={setupUrl} label="Set up your account" />
      ) : (
        <Cta href={`${siteUrl}/rush/portal`} label="Open your rush portal" />
      )}
    </Layout>
  );
}
