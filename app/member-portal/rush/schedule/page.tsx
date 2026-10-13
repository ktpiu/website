import { redirect } from "next/navigation";

/** The schedule merged into the unified rush events tab. */
export default function RushSchedulePage() {
  redirect("/member-portal/rush/events");
}
