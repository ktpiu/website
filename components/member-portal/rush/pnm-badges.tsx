import { Badge } from "@/components/ui/badge";
import { GROUP_LABELS, type DelibGroup, type PnmStatus, type RushStage } from "@/lib/rush/types";

export type PnmListItem = {
  id: string;
  name: string;
  email: string;
  isIuEmail: boolean;
  status: PnmStatus;
  major: string | null;
  gradYear: number | null;
  photoUrl: string | null;
  hasAccount: boolean;
  stage: RushStage;
  group: DelibGroup;
  outcome: string | null;
  eventsAttended: number;
  hasApplication: boolean;
  responseCount: number;
};

const GROUP_STYLES: Record<DelibGroup, string> = {
  undecided: "",
  yes: "bg-emerald-600 text-white border-transparent",
  no: "bg-red-600 text-white border-transparent",
  come_back: "bg-amber-500 text-white border-transparent",
};

export function GroupBadge({ group }: { group: DelibGroup }) {
  return (
    <Badge variant="outline" className={GROUP_STYLES[group]}>
      {GROUP_LABELS[group]}
    </Badge>
  );
}
