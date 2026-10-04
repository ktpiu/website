import "server-only";
import { formatEmailWhen, sendEmailInBackground } from "@/lib/email/plunk";
import { buildSetupUrl, getSiteUrl } from "@/lib/rush/links";
import type { PnmRow } from "@/lib/rush/server";
import {
  AccountSetupEmail,
  ApplicationReceivedEmail,
  CheckInConfirmationEmail,
  ClosedRushInviteEmail,
  SlotUpdateEmail,
} from "@/emails/rush-emails";

/** Setup link for PNMs who haven't chosen a password yet. */
function setupUrlFor(pnm: PnmRow, request?: Request) {
  return pnm.clerk_user_id ? null : buildSetupUrl(pnm.id, request);
}

export function notifyCheckIn(
  pnm: PnmRow,
  event: { title: string; starts_at: string; ends_at: string | null; location_name: string },
  request?: Request,
) {
  sendEmailInBackground({
    to: pnm.email,
    subject: `You're checked in: ${event.title}`,
    react: CheckInConfirmationEmail({
      name: pnm.name,
      siteUrl: getSiteUrl(request),
      eventTitle: event.title,
      when: formatEmailWhen(event.starts_at, event.ends_at),
      location: event.location_name || null,
      setupUrl: setupUrlFor(pnm, request),
    }),
  });
}

export function notifyApplicationReceived(pnm: PnmRow, cycleLabel: string, request?: Request) {
  sendEmailInBackground({
    to: pnm.email,
    subject: "We received your KTP application",
    react: ApplicationReceivedEmail({
      name: pnm.name,
      siteUrl: getSiteUrl(request),
      cycleLabel,
      setupUrl: setupUrlFor(pnm, request),
    }),
  });
}

export function notifyAccountSetup(pnm: PnmRow, request?: Request) {
  sendEmailInBackground({
    to: pnm.email,
    subject: "Set up your KTP rush account",
    react: AccountSetupEmail({
      name: pnm.name,
      siteUrl: getSiteUrl(request),
      setupUrl: buildSetupUrl(pnm.id, request),
    }),
  });
}

export function notifySlotUpdate(
  pnm: PnmRow,
  eventTitle: string,
  action: "booked" | "moved" | "cancelled",
  slot: { starts_at: string; ends_at: string | null; location_name: string } | null,
  request?: Request,
) {
  sendEmailInBackground({
    to: pnm.email,
    subject: `${action === "cancelled" ? "Timeslot cancelled" : "Your timeslot"}: ${eventTitle}`,
    react: SlotUpdateEmail({
      name: pnm.name,
      siteUrl: getSiteUrl(request),
      eventTitle,
      action,
      when: slot ? formatEmailWhen(slot.starts_at, slot.ends_at) : null,
      location: slot?.location_name || null,
    }),
  });
}

export function notifyClosedRushInvite(pnm: PnmRow, cycleLabel: string, request?: Request) {
  sendEmailInBackground({
    to: pnm.email,
    subject: `You're invited to ${cycleLabel}`,
    react: ClosedRushInviteEmail({
      name: pnm.name,
      siteUrl: getSiteUrl(request),
      cycleLabel,
      setupUrl: setupUrlFor(pnm, request),
    }),
  });
}
