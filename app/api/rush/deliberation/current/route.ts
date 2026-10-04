import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageDeliberation } from "@/lib/permissions";
import { getActiveSession, getParticipantStatus } from "@/lib/rush/deliberation";
import { loadPnmDossier } from "@/lib/rush/dossier";
import { rushErrorResponse, signRushPaths } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type RoundRow = {
  id: string;
  pnm_id: string;
  status: "open" | "closed";
  yes_count: number;
  no_count: number;
  abstain_count: number;
  opened_at: string;
  closed_at: string | null;
};

/**
 * The caller's view of the live deliberation. Admitted members see the
 * presented PNM, the vote breakdown and their own choice. Who voted which
 * way is never returned to anyone.
 */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    const isAdmin = canManageDeliberation(context.permissions);
    const me = context.appUser.id;
    const session = await getActiveSession();

    if (!session) {
      return NextResponse.json({ session: null, isAdmin, myStatus: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const myStatus = await getParticipantStatus(session.id, me);
    const admitted = myStatus === "admitted" || isAdmin;

    const { data: cycle } = await supabaseAdmin
      .from("rush_cycles")
      .select("id, label")
      .eq("id", session.cycle_id)
      .maybeSingle();

    const base = {
      session: {
        id: session.id,
        cycleId: session.cycle_id,
        cycleLabel: (cycle as { label: string } | null)?.label ?? "",
        stage: session.stage,
        startedAt: session.started_at,
        currentPnmId: session.current_pnm_id,
      },
      isAdmin,
      myStatus,
    };
    if (!admitted) return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });

    const [presenting, roundsRes, admittedCountRes] = await Promise.all([
      session.current_pnm_id
        ? loadPnmDossier(session.current_pnm_id, {
            cycleId: session.cycle_id,
            showAllAuthors: false,
            includeContact: false,
          })
        : Promise.resolve(null),
      session.current_pnm_id
        ? supabaseAdmin
            .from("delib_vote_rounds")
            .select("id, pnm_id, status, yes_count, no_count, abstain_count, opened_at, closed_at")
            .eq("session_id", session.id)
            .eq("pnm_id", session.current_pnm_id)
            .order("opened_at", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin
        .from("delib_participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.id)
        .eq("status", "admitted"),
    ]);
    if (roundsRes.error) throw roundsRes.error;

    const round = ((roundsRes.data ?? []) as RoundRow[])[0] ?? null;
    let myChoice: string | null = null;
    if (round?.status === "open") {
      const { data } = await supabaseAdmin
        .from("delib_ballots")
        .select("choice")
        .eq("round_id", round.id)
        .eq("voter_user_id", me)
        .maybeSingle();
      myChoice = (data as { choice: string } | null)?.choice ?? null;
    }

    const group = presenting?.entries.find((e) => e.cycleId === session.cycle_id)?.group ?? null;

    return NextResponse.json(
      {
        ...base,
        admittedCount: admittedCountRes.count ?? 0,
        presenting: presenting
          ? {
              pnm: presenting.pnm,
              group,
              attendance: presenting.attendance,
              applications: presenting.applications,
              responses: presenting.responses,
            }
          : null,
        round: round
          ? {
              id: round.id,
              status: round.status,
              yes: round.yes_count,
              no: round.no_count,
              abstain: round.abstain_count,
              openedAt: round.opened_at,
              closedAt: round.closed_at,
            }
          : null,
        myChoice,
        ...(isAdmin ? await loadAdminExtras(session.id, session.cycle_id, session.stage) : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the deliberation.");
  }
}

/** Participants and the PNMs still in this session's stage (open or closed rush). */
async function loadAdminExtras(sessionId: string, cycleId: string, stage: "open" | "closed") {
  const [participantsRes, entriesRes, roundsRes] = await Promise.all([
    supabaseAdmin
      .from("delib_participants")
      .select("id, user_id, status, requested_at, users!delib_participants_user_id_fkey(name, avatar)")
      .eq("session_id", sessionId)
      .order("requested_at"),
    supabaseAdmin
      .from("pnm_cycle_entries")
      .select("group, outcome, pnms(id, name, photo_path, status)")
      .eq("cycle_id", cycleId)
      .eq("stage", stage)
      .is("outcome", null),
    supabaseAdmin
      .from("delib_vote_rounds")
      .select("pnm_id, yes_count, no_count, abstain_count, closed_at")
      .eq("cycle_id", cycleId)
      .eq("stage", stage)
      .eq("status", "closed")
      .order("closed_at", { ascending: false }),
  ]);
  for (const res of [participantsRes, entriesRes, roundsRes]) if (res.error) throw res.error;

  type ParticipantRow = {
    id: string;
    user_id: string;
    status: string;
    requested_at: string;
    users: { name: string; avatar: string | null } | null;
  };
  type EntryRow = {
    group: string;
    outcome: string | null;
    pnms: { id: string; name: string; photo_path: string | null; status: string } | null;
  };
  const entries = ((entriesRes.data ?? []) as unknown as EntryRow[]).filter((e) => e.pnms);
  const urls = await signRushPaths(entries.map((e) => e.pnms!.photo_path));

  const lastVote = new Map<string, { yes: number; no: number; abstain: number }>();
  for (const r of (roundsRes.data ?? []) as Array<{ pnm_id: string; yes_count: number; no_count: number; abstain_count: number }>) {
    if (!lastVote.has(r.pnm_id)) lastVote.set(r.pnm_id, { yes: r.yes_count, no: r.no_count, abstain: r.abstain_count });
  }

  return {
    participants: ((participantsRes.data ?? []) as unknown as ParticipantRow[]).map((p) => ({
      id: p.id,
      userId: p.user_id,
      name: p.users?.name ?? "",
      avatar: p.users?.avatar || null,
      status: p.status,
      requestedAt: p.requested_at,
    })),
    pnms: entries
      .map((e) => ({
        id: e.pnms!.id,
        name: e.pnms!.name,
        photoUrl: e.pnms!.photo_path ? urls.get(e.pnms!.photo_path) ?? null : null,
        status: e.pnms!.status,
        group: e.group,
        outcome: e.outcome,
        lastVote: lastVote.get(e.pnms!.id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
