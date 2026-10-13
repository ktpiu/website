import { redirect } from "next/navigation";

/** The schedule merged into the unified rush events tab. */
export default async function RushScheduleEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  redirect(`/member-portal/rush/events/${eventId}`);
}
