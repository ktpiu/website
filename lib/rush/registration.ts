import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAcademicYearEnd, getGradeLabel } from "@/lib/members";
import { getActiveCycle, hasCycleEntry, type PnmRow } from "@/lib/rush/server";
import type { User as SupabaseUser } from "@/lib/supabase";

/** Grades that may register themselves for rush from the portal. */
export const SELF_REGISTER_GRADES = ["Freshman", "Sophomore"] as const;

/** Graduation years that count as freshman or sophomore right now. */
export function selfRegisterGraduationYears(now: Date = new Date()) {
  const end = getAcademicYearEnd(now);
  return [end + 3, end + 2];
}

export function isSelfRegisterGrade(graduationYear: number | null | undefined) {
  const grade = getGradeLabel(graduationYear, false);
  return (SELF_REGISTER_GRADES as readonly string[]).includes(grade ?? "");
}

export type RegistrationState = {
  /** Open rush is running for the current cycle. */
  open: boolean;
  cycleLabel: string | null;
  /** Already registered for the current cycle. */
  registered: boolean;
  /** Graduation years a self-registering rushee may pick. */
  graduationYears: number[];
};

/**
 * Whether this account can register itself for the current rush cycle.
 * Only public accounts (or former rushees) during open rush.
 */
export async function getRegistrationState(
  account: Pick<SupabaseUser, "account_status">,
  pnm: Pick<PnmRow, "id"> | null,
): Promise<RegistrationState> {
  const cycle = await getActiveCycle();
  const registered = Boolean(cycle && pnm && (await hasCycleEntry(pnm.id, cycle.id)));
  const eligibleStatus = account.account_status === "public" || account.account_status === "rushee";
  return {
    open: Boolean(cycle && cycle.phase === "open" && eligibleStatus),
    cycleLabel: cycle?.label ?? null,
    registered,
    graduationYears: selfRegisterGraduationYears(),
  };
}

/** Records the graduation year a rushee gave (server-only column write). */
export async function saveGraduationYear(userId: string, graduationYear: number) {
  const { error } = await supabaseAdmin.from("users").update({ graduation_year: graduationYear }).eq("id", userId);
  if (error) throw error;
}
