export type FinancePaymentState = "paid" | "partial" | "unpaid" | "exempt";
export type FinancePaymentSource = "stripe" | "manual";
export type FinancePaymentStatus = "pending" | "completed" | "failed" | "canceled";
export type FinanceAllocationMode = "auto_fifo" | "manual_selection";

export type FinanceChargeInput = {
  title: string;
  description?: string | null;
  dueAt?: string | null;
  defaultAmountCents?: number | null;
  includeRoleIds: string[];
  excludeRoleIds: string[];
  includeUsers: Array<{ userId: string; amountCents?: number | null }>;
  excludeUserIds: string[];
  roleAmounts?: Record<string, number | null>;
  manualUserAmounts?: Record<string, number>;
};

export type FinanceResolvedRecipient = {
  userId: string;
  amountCents: number;
  source: "user_override" | "role" | "default";
};

export type FinanceRecipientConflict = {
  userId: string;
  roleAmounts: Array<{ roleId: string; amountCents: number }>;
};

export type FinanceChargePreviewResult = {
  recipients: FinanceResolvedRecipient[];
  conflicts: FinanceRecipientConflict[];
  missingAmountUserIds: string[];
};

export type FinanceObligationBalance = {
  id: string;
  charge_id: string;
  user_id: string;
  customer_id: string | null;
  amount_cents: number;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  paid_cents: number;
  remaining_cents: number;
  payment_state: FinancePaymentState;
  is_overdue: boolean;
  exempted_at: string | null;
};

export type FinanceAllocationInput = {
  obligationId: string;
  amountCents: number;
};

export type FinanceAllocationResult = {
  obligationId: string;
  amountCents: number;
};
