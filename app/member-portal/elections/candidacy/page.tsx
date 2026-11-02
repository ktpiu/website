import { redirect } from "next/navigation";

/** Applying moved to the Elections page. */
export default function CandidacyPage() {
  redirect("/member-portal/elections");
}
