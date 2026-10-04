import "server-only";
import type { ReactElement } from "react";
import { after } from "next/server";
import { render } from "react-email";

/**
 * Transactional email through Plunk (https://www.useplunk.com, pay-as-you-go).
 * Templates are React Email components rendered to HTML here. Only
 * transactional sends are used: recipients are marked unsubscribed so they
 * never land in marketing lists.
 */

const PLUNK_API_URL = (process.env.PLUNK_API_URL ?? "https://next-api.useplunk.com").replace(/\/$/, "");

export type SendEmailParams = {
  to: string;
  subject: string;
  react: ReactElement;
  replyTo?: string;
};

export async function sendEmail({ to, subject, react, replyTo }: SendEmailParams) {
  const apiKey = process.env.PLUNK_SECRET_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn(`Email not sent (PLUNK_SECRET_KEY / EMAIL_FROM not set): "${subject}" to ${to}`);
    return false;
  }

  const html = await render(react);
  const response = await fetch(`${PLUNK_API_URL}/v1/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      subject,
      body: html,
      from,
      subscribed: false,
      ...(replyTo || process.env.EMAIL_REPLY_TO
        ? { reply: replyTo ?? process.env.EMAIL_REPLY_TO }
        : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Plunk send failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return true;
}

/**
 * Sends after the response is returned so a slow or failing email provider
 * never blocks or fails a check-in, application or booking.
 */
export function sendEmailInBackground(params: SendEmailParams) {
  after(async () => {
    try {
      await sendEmail(params);
    } catch (error) {
      console.error(`Failed to send "${params.subject}" to ${params.to}:`, error);
    }
  });
}

const EMAIL_TIME_ZONE = "America/Indiana/Indianapolis";

/** "Tue, Oct 6 · 7:00 – 9:00 PM" in Bloomington time. */
export function formatEmailWhen(startsAt: string, endsAt?: string | null) {
  const start = new Date(startsAt);
  const date = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: EMAIL_TIME_ZONE,
  });
  const time = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: EMAIL_TIME_ZONE });
  return endsAt ? `${date} · ${time(start)} – ${time(new Date(endsAt))}` : `${date} · ${time(start)}`;
}
