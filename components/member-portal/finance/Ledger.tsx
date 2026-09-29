import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export type LedgerChargeEntry = {
  id: string;
  kind: "charge";
  createdAt: string;
  title: string;
  description: string | null;
  amountCents: number;
  remainingCents: number;
  dueAt: string | null;
  isOverdue: boolean;
  paymentState: "paid" | "partial" | "unpaid" | "exempt";
};

export type LedgerPaymentEntry = {
  id: string;
  kind: "payment";
  createdAt: string;
  title: string;
  description: string | null;
  amountCents: number;
  status: string;
};

export type LedgerEntry = LedgerChargeEntry | LedgerPaymentEntry;

function formatDate(date: string | null) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-US");
}

function formatCents(amountCents: number) {
  return `$${(amountCents / 100).toFixed(2)}`;
}

function getChargeStatus(entry: LedgerChargeEntry) {
  if (entry.isOverdue && entry.remainingCents > 0) {
    return {
      label: "overdue",
      variant: "destructive" as const,
    };
  }

  if (entry.paymentState === "paid") {
    return {
      label: "paid",
      variant: "default" as const,
    };
  }

  return {
    label: entry.paymentState,
    variant: "secondary" as const,
  };
}

function getPaymentStatusVariant(status: string) {
  if (status === "completed") return "default" as const;
  if (status === "failed" || status === "canceled") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

export default function Ledger({
  entries,
  loadingLedger,
  //   selectedChargeIds,
  //   selectedChargeAmounts,
  //   onToggleChargeSelection,
  //   onChargeAmountChange,
}: {
  entries: LedgerEntry[];
  loadingLedger: boolean;
  selectedChargeIds?: string[];
  selectedChargeAmounts?: Record<string, string>;
  onToggleChargeSelection?: (chargeId: string, checked: boolean) => void;
  onChargeAmountChange?: (chargeId: string, value: string) => void;
}) {
  //   const selectedChargeSet = new Set(selectedChargeIds ?? []);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-full overflow-auto rounded-md border">
          {loadingLedger ? (
            <p className="p-4 text-sm text-muted-foreground">
              Loading transactions...
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  if (entry.kind === "charge") {
                    const status = getChargeStatus(entry);

                    return (
                      <TableRow key={`charge-${entry.id}`}>
                        <TableCell>{formatDate(entry.createdAt)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{entry.title}</div>
                          {entry.description ? (
                            <div className="text-xs text-muted-foreground">
                              {entry.description}
                            </div>
                          ) : null}
                          <div className="text-xs text-muted-foreground">
                            Due: {formatDate(entry.dueAt)}
                          </div>
                        </TableCell>
                        <TableCell>Charge</TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>
                            {status.label.charAt(0).toUpperCase() +
                              status.label.substring(1, status.label.length)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-red-500">
                          {formatCents(entry.amountCents)}
                        </TableCell>
                        <TableCell>
                          {entry.remainingCents > 0
                            ? formatCents(entry.remainingCents)
                            : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow key={`payment-${entry.id}`}>
                      <TableCell>{formatDate(entry.createdAt)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{entry.title}</div>
                        {entry.description ? (
                          <div className="text-xs text-muted-foreground">
                            {entry.description}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>Payment</TableCell>
                      <TableCell>
                        <Badge variant={getPaymentStatusVariant(entry.status)}>
                          {entry.status.charAt(0).toUpperCase() +
                            entry.status.substring(1, entry.status.length)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatCents(entry.amountCents)}</TableCell>
                      <TableCell>-</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
