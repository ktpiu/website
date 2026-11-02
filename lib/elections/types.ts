/**
 * Election types and rules shared by the browser and the API. Dependency-free.
 * The schema is the Elections section of the baseline migration.
 */

export type ElectionPhase = "setup" | "applications" | "campaign" | "voting" | "closed";

/** What members see. "review" is the campaign phase once the deadline passes. */
export type ElectionStage = Exclude<ElectionPhase, "campaign"> | "submissions" | "review";

export type Election = {
  id: string;
  name: string;
  phase: ElectionPhase;
  submission_deadline: string;
  max_positions_per_candidate: number;
  candidates_finalized_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type ElectionPosition = {
  id: string;
  election_id: string;
  role_id: string | null;
  title: string;
  sort_order: number;
  created_at: string;
};

/** An exec or director role that can be put on the ballot. */
export type BallotRole = {
  id: string;
  name: string;
  type: "exec" | "director";
  priority: number;
};

export type CandidacyStatus =
  | "pending"
  | "approved"
  | "denied"
  | "voided"
  | "withdrawn"
  | "won"
  | "lost"
  | "declined";

export type Candidacy = {
  id: string;
  position_id: string;
  status: CandidacyStatus;
  video_url: string | null;
  /** Shown to the candidate for denials and voids. */
  decision_reason: string | null;
  decided_at: string | null;
};

/** What a candidate sees about their own run. Never includes the transcript path. */
export type MyCandidacy = {
  id: string;
  source: "application" | "manual";
  has_transcript: boolean;
  applied_at: string;
  candidacies: Candidacy[];
};

/** A candidate as election managers see them. */
export type ManagedCandidate = MyCandidacy & {
  user: { id: string; name: string; email: string; avatar: string | null };
  has_intro: boolean;
  photo_count: number;
};

export type ElectionMember = { id: string; name: string; email: string };

export const CANDIDACY_STATUS_LABELS: Record<CandidacyStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
  voided: "Voided",
  withdrawn: "Withdrawn",
  won: "Won",
  lost: "Not elected",
  declined: "Declined seat",
};

export const MAX_POSITIONS_LIMIT = 5;

export const STAGE_LABELS: Record<ElectionStage, string> = {
  setup: "Setup",
  applications: "Applications open",
  submissions: "Campaign submissions",
  review: "Member review",
  voting: "Voting",
  closed: "Closed",
};

export function electionStage(
  election: Pick<Election, "phase" | "submission_deadline">,
  now = new Date(),
): ElectionStage {
  if (election.phase !== "campaign") return election.phase;
  return new Date(election.submission_deadline) <= now ? "review" : "submissions";
}

/** The positions-per-candidate limit can change until candidates are finalized. */
export function positionsLocked(election: Pick<Election, "candidates_finalized_at">) {
  return election.candidates_finalized_at !== null;
}

/** A seat added after candidates were finalized, so it gets its own campaigners. */
export function isLatePosition(
  election: Pick<Election, "candidates_finalized_at">,
  position: Pick<ElectionPosition, "created_at">,
) {
  return (
    election.candidates_finalized_at !== null &&
    new Date(position.created_at) > new Date(election.candidates_finalized_at)
  );
}

export const INTRO_MAX_WORDS = 300;
export const ENDORSEMENT_MAX_WORDS = 100;

/** Same rule as public.election_word_count: runs of whitespace separate words. */
export function wordCount(text: string | null | undefined) {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** YouTube or Google Drive only; same rule as public.election_is_video_link. */
export function isVideoLink(url: string) {
  return /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be|drive\.google\.com)\//i.test(url.trim());
}

export type CandidatePhoto = { id: string; url: string | null };

/** A candidate's campaign materials, for the candidate and election managers. */
export type CandidateMaterials = {
  candidate_id: string;
  name: string;
  intro: string;
  awards: string;
  has_transcript: boolean;
  photos: CandidatePhoto[];
  /** Approved seats, each with its own initiative video. */
  seats: Array<{ candidacy_id: string; position_id: string; title: string; video_url: string | null }>;
  materials_updated_at: string | null;
  /** True when an election manager, not the candidate, made the last edit. */
  edited_by_standards: boolean;
  /** Whether the viewer can change anything right now, and why not. */
  can_edit: boolean;
  locked_reason: string | null;
};

export type MaterialsCheck = { label: string; done: boolean; optional?: boolean };

/** The four required tasks (plus the optional one), as a checklist. */
export function materialsChecklist(m: Pick<CandidateMaterials, "intro" | "awards" | "has_transcript" | "photos" | "seats">): MaterialsCheck[] {
  return [
    { label: "Written introduction", done: wordCount(m.intro) > 0 && wordCount(m.intro) <= INTRO_MAX_WORDS },
    { label: "Initiative video for each position", done: m.seats.length > 0 && m.seats.every((s) => Boolean(s.video_url)) },
    { label: "Unofficial IU transcript", done: m.has_transcript },
    { label: "At least one photo", done: m.photos.length > 0 },
    { label: "Awards, projects or employment", done: m.awards.trim().length > 0, optional: true },
  ];
}

export type EndorsementKind = "text" | "video";
export type EndorsementStatus = "pending" | "approved" | "rejected";

/** The viewer's own endorsement of a candidate. */
export type MyEndorsement = {
  id: string;
  kind: EndorsementKind;
  body: string | null;
  video_url: string | null;
  status: EndorsementStatus;
};

/** A finalized candidate as members see them before and during review. */
export type BallotCandidate = {
  candidate_id: string;
  name: string;
  avatar: string | null;
  is_me: boolean;
  seats: Array<{ position_id: string; title: string }>;
  my_endorsement: MyEndorsement | null;
};

/** An endorsement in the Standards Board's approval queue. */
export type QueuedEndorsement = {
  id: string;
  kind: EndorsementKind;
  body: string | null;
  video_url: string | null;
  status: EndorsementStatus;
  updated_at: string;
  author: { id: string; name: string };
  candidate: { id: string; name: string };
};

export const ENDORSEMENT_STATUS_LABELS: Record<EndorsementStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Not approved",
};

/** Endorsements open when candidates are finalized and close when voting starts. */
export function endorsementsOpen(election: Pick<Election, "phase" | "candidates_finalized_at">) {
  return election.phase === "campaign" && election.candidates_finalized_at !== null;
}

/** Statuses of a seat a finalized candidate is still (or was) running for. */
export const ON_BALLOT_STATUSES: CandidacyStatus[] = ["approved", "won", "lost", "declined"];

/** A candidate's public profile, for active members during review and voting. */
export type CandidateProfile = {
  candidate_id: string;
  name: string;
  avatar: string | null;
  is_me: boolean;
  intro: string;
  awards: string;
  photos: CandidatePhoto[];
  seats: Array<{ position_id: string; title: string; video_url: string | null }>;
  endorsements: Array<{
    id: string;
    author_name: string;
    kind: EndorsementKind;
    body: string | null;
    video_url: string | null;
  }>;
  my_endorsement: MyEndorsement | null;
};

/** Profiles open to members at the deadline; candidates can preview their own once finalized. */
export function profilesOpen(election: Pick<Election, "phase" | "submission_deadline">, now = new Date()) {
  const stage = electionStage(election, now);
  return stage === "review" || stage === "voting";
}

export type ResultStatus = "provisional" | "awaiting_selection" | "tied" | "final" | "vacant";
export type RoundKind = "initial" | "runoff" | "revote";

export type RoundTally = { choice: string; label: string; online: number; paper: number; votes: number };

export type RoundSummary = {
  id: string;
  position_id: string;
  kind: RoundKind;
  status: "open" | "closed" | "tied";
  opened_at: string;
  closed_at: string | null;
  ballots_cast: number;
  /** Null while the round is open: nobody sees counts until it closes. */
  tallies: RoundTally[] | null;
};

export type VotingChoice = { candidacy_id: string; candidate_id: string; name: string };

export type SeatResult = {
  position_id: string;
  title: string;
  /** Null until the seat's first vote closes. */
  status: ResultStatus | null;
  resolution: "outright" | "runner_up" | "runoff" | "revote" | null;
  winner: VotingChoice | null;
  tied: VotingChoice[];
};

export type PendingSelection = {
  candidate_id: string;
  user_id: string;
  name: string;
  seats: Array<{ candidacy_id: string; position_id: string; title: string }>;
};

/** Everything the voting screens share. Nothing in it links a voter to a choice. */
export type VotingState = {
  election: Election;
  positions: ElectionPosition[];
  results: SeatResult[];
  rounds: RoundSummary[];
  open_round: (RoundSummary & { title: string; choices: VotingChoice[] }) | null;
  admitted_count: number;
  pending_selections: PendingSelection[];
};

export type ManagerVotingState = VotingState & {
  join_code: string | null;
  participants: Array<{ user_id: string; name: string; status: "admitted" | "removed" }>;
  /** Every on-ballot candidacy, for choosing who is on a re-vote. */
  candidacies: Array<VotingChoice & { position_id: string; status: CandidacyStatus }>;
};

export type MemberVotingState = VotingState & {
  me: { admitted: boolean; has_voted: boolean; selection: PendingSelection | null };
};

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  provisional: "Won (still in another race)",
  awaiting_selection: "Awaiting seat choice",
  tied: "Tied: runoff needed",
  final: "Final",
  vacant: "Vacant",
};

export const ROUND_KIND_LABELS: Record<RoundKind, string> = {
  initial: "Vote",
  runoff: "Runoff",
  revote: "Re-vote",
};
