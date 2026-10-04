/** Shapes returned by /api/rush/events for the member portal. */

export type SlotPerson = { signupId: string; name: string };

export type MemberSlot = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  locationName: string;
  locationUrl: string | null;
  notes: string | null;
  pnmCapacity: number;
  activeCapacity: number;
  pnms: Array<SlotPerson & { pnmId: string; photoUrl: string | null; attendance: "present" | "late" | "no_show" | null }>;
  actives: Array<SlotPerson & { userId: string; avatar: string | null; isMe: boolean }>;
};

export type MemberEvent = {
  id: string;
  cycleId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  locationName: string;
  locationUrl: string | null;
  dressCode: string | null;
  imageUrl: string | null;
  visibility: "public" | "pnm_portal";
  checkinOpen: boolean;
  hasTimeslots: boolean;
  activesMultiSlot: boolean;
  selfChangeMode: "cutoff" | "admin_only";
  changeCutoffMinutes: number;
  slotGrid: "time_rows" | "location_rows";
  formTemplateId: string | null;
  attendanceEnabled: boolean;
  qrCheckinEnabled: boolean;
  canMarkPnms: boolean;
  checkinUrl?: string;
  attendanceCount?: number;
  unmatchedCount?: number;
  slots: MemberSlot[];
};

export type EventsResponse = { cycle: { id: string; label: string } | null; events: MemberEvent[] };
