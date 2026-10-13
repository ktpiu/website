import { redirect } from "next/navigation";

/** The PNM list moved into User Management's rush view. */
export default function RushPnmsPage() {
  redirect("/member-portal/admin/users?view=rush");
}
