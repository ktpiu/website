"use client";

import { ALLOW_PARTIAL_PAYMENTS } from "@/lib/finance-config";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAuthStore } from "@/lib/auth-store";
import { supabase } from "@/lib/supabase";
import BalanceBar from "@/components/member-portal/finance/BalanceBar";
import ManagePaymentMethods from "@/components/member-portal/finance/ManagePaymentMethods";
import Ledger, { LedgerEntry } from "@/components/member-portal/finance/Ledger";
import {
  formatPaymentMethodLabel,
  StripePaymentMethodSummary,
} from "@/lib/stripe-payment-methods";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

type FinanceNotSetupProps = {
  onEnablePortal: () => Promise<void>;
  creatingCustomer: boolean;
};

type FinanceObligation = {
  id: string;
  charge_id: string;
  amount_cents: number;
  paid_cents: number;
  remaining_cents: number;
  payment_state: "paid" | "partial" | "unpaid" | "exempt";
  is_overdue: boolean;
  due_at: string | null;
  created_at: string;
  chargeTitle: string;
  chargeDescription: string | null;
};

type FinancePayment = {
  id: string;
  source: string;
  status: string;
  amountCents: number;
  allocationMode: string;
  paymentMethodLabel: string | null;
  notes: string | null;
  createdAt: string;
};

type FinanceOverview = {
  financeEnabled: boolean;
  customer: {
    customerId: string;
    stripeCustomerId: string | null;
  } | null;
  summary: {
    outstandingCents: number;
    overdueCount: number;
    obligationCount: number;
  };
  obligations: FinanceObligation[];
  payments: FinancePayment[];
};

type PayMode = "balance" | "selected";

const EMPTY_OBLIGATIONS: FinanceObligation[] = [];
const EMPTY_PAYMENTS: FinancePayment[] = [];
const MIN_PAYMENT_CENTS = 50; // $0.50

function FinanceLoadingSkeleton() {
  return (
    <div className="w-full h-full flex flex-col gap-5">
      <Card className="w-full">
        <CardContent>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col space-y-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-10 w-10" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="space-y-3 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function FinanceNotSetup({
  onEnablePortal,
  creatingCustomer,
}: FinanceNotSetupProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>Finances Not Setup</EmptyTitle>
        <EmptyDescription>
          You haven&apos;t enabled the finance portal yet. Please enable the
          portal to proceed.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button onClick={onEnablePortal} disabled={creatingCustomer}>
          {creatingCustomer ? "Enabling..." : "Enable Portal"}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function formatCents(amountCents: number) {
  return `$${(amountCents / 100).toFixed(2)}`;
}

function parseDollarsToCents(input: string) {
  if (!input.trim()) return null;
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function toTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(date: string | null) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-US");
}

export default function StripeDuesPage() {
  const { user: appUser, isLoading: isAuthLoading } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(null);

  const [paymentMethods, setPaymentMethods] = useState<
    StripePaymentMethodSummary[]
  >([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<
    string | null
  >(null);

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("balance");
  const [paying, setPaying] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  const [selectedObligationIds, setSelectedObligationIds] = useState<string[]>(
    [],
  );
  const [selectedAmounts, setSelectedAmounts] = useState<
    Record<string, string>
  >({});

  const obligations = overview?.obligations ?? EMPTY_OBLIGATIONS;
  const payments = overview?.payments ?? EMPTY_PAYMENTS;

  const unpaidObligations = useMemo(
    () => obligations.filter((obligation) => obligation.remaining_cents > 0),
    [obligations],
  );

  const unpaidById = useMemo(
    () =>
      new Map(
        unpaidObligations.map((obligation) => [obligation.id, obligation]),
      ),
    [unpaidObligations],
  );

  const outstandingCents =
    overview?.summary.outstandingCents ??
    unpaidObligations.reduce(
      (sum, obligation) => sum + obligation.remaining_cents,
      0,
    );

  const selectedPaymentMethod = useMemo(() => {
    if (!selectedPaymentMethodId) return null;
    return (
      paymentMethods.find((method) => method.id === selectedPaymentMethodId) ??
      null
    );
  }, [paymentMethods, selectedPaymentMethodId]);

  const selectedAllocations = useMemo(() => {
    const allocations: Array<{ obligationId: string; amountCents: number }> =
      [];

    for (const obligationId of selectedObligationIds) {
      const obligation = unpaidById.get(obligationId);
      if (!obligation) continue;

      const input = selectedAmounts[obligationId] ?? "";
      const parsed = parseDollarsToCents(input);
      const amountCents =
        ALLOW_PARTIAL_PAYMENTS && parsed && parsed > 0
          ? Math.min(parsed, obligation.remaining_cents)
          : obligation.remaining_cents;

      if (amountCents > 0) {
        allocations.push({ obligationId, amountCents });
      }
    }

    return allocations;
  }, [selectedAmounts, selectedObligationIds, unpaidById]);

  const selectedTotalCents = useMemo(
    () =>
      selectedAllocations.reduce(
        (sum, allocation) => sum + allocation.amountCents,
        0,
      ),
    [selectedAllocations],
  );

  const ledgerEntries = useMemo<LedgerEntry[]>(() => {
    const chargeEntries: LedgerEntry[] = obligations.map((obligation) => ({
      id: obligation.id,
      kind: "charge",
      createdAt: obligation.created_at,
      title: obligation.chargeTitle,
      description: obligation.chargeDescription,
      amountCents: obligation.amount_cents,
      remainingCents: obligation.remaining_cents,
      dueAt: obligation.due_at,
      isOverdue: obligation.is_overdue,
      paymentState: obligation.payment_state,
    }));

    const paymentEntries: LedgerEntry[] = payments.map((payment) => ({
      id: payment.id,
      kind: "payment",
      createdAt: payment.createdAt,
      title:
        payment.source === "manual"
          ? "Manual Payment"
          : payment.allocationMode === "auto_fifo"
            ? "Full Balance Payment"
            : "Partial Balance Payment",
      description: payment.paymentMethodLabel ?? payment.notes,
      amountCents: payment.amountCents,
      status: payment.status,
    }));

    return [...chargeEntries, ...paymentEntries].sort(
      (a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt),
    );
  }, [obligations, payments]);

  useEffect(() => {
    setSelectedObligationIds((current) =>
      current.filter((id) => unpaidById.has(id)),
    );
    setSelectedAmounts((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([obligationId]) =>
          unpaidById.has(obligationId),
        ),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [unpaidById]);

  const loadOverview = useCallback(async () => {
    const response = await fetch("/api/finance/me/overview");
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to load finance overview.");
    }

    const financeOverview = result as FinanceOverview;
    setOverview(financeOverview);
    setStripeCustomerId(financeOverview.customer?.stripeCustomerId ?? null);
  }, []);

  useEffect(() => {
    async function initialize() {
      if (isAuthLoading) return;

      if (!appUser?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        await loadOverview();
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load finances.",
        );
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, [appUser?.id, isAuthLoading, loadOverview]);

  async function handleEnablePortal() {
    if (!appUser?.id) {
      toast.error("No user found for your account.");
      return;
    }

    try {
      setCreatingCustomer(true);
      setError(null);

      const response = await fetch("/api/stripe/customer/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: appUser.name, email: appUser.email }),
      });

      const result = await response.json();
      if (!response.ok || !result.id) {
        throw new Error(result.error || "Failed to create customer");
      }

      const { error: upsertError } = await supabase
        .from("customers")
        .upsert({ user_id: appUser.id, stripe_id: result.id });

      if (upsertError) {
        throw upsertError;
      }

      toast.success("Finance portal enabled.");
      await loadOverview();
    } catch (enableError) {
      const message =
        enableError instanceof Error
          ? enableError.message
          : "Failed to enable portal.";
      setError(message);
      toast.error(message);
    } finally {
      setCreatingCustomer(false);
    }
  }

  function handleToggleChargeSelection(obligationId: string, checked: boolean) {
    const obligation = unpaidById.get(obligationId);

    setSelectedObligationIds((current) =>
      checked
        ? Array.from(new Set([...current, obligationId]))
        : current.filter((id) => id !== obligationId),
    );

    if (!checked) {
      setSelectedAmounts((current) => {
        if (!(obligationId in current)) return current;
        const rest = { ...current };
        delete rest[obligationId];
        return rest;
      });
      return;
    }

    if (!obligation) return;

    setSelectedAmounts((current) => ({
      ...current,
      [obligationId]: (obligation.remaining_cents / 100).toFixed(2),
    }));
  }

  function handlePayDialogOpen() {
    setPayMode("balance");
    setSelectedObligationIds([]);
    setSelectedAmounts({});
    setPayDialogOpen(true);
  }

  async function handleSubmitPayment() {
    if (!selectedPaymentMethod) {
      toast.error("Select a payment method before paying.");
      return;
    }

    if (
      selectedPaymentMethod.type === "us_bank_account" &&
      selectedPaymentMethod.usBankAccount?.verification?.state !== "verified"
    ) {
      toast.error("This bank account must be verified before payment.");
      return;
    }

    if (payMode === "balance" && outstandingCents <= 0) {
      toast.error("No balance due.");
      return;
    }

    if (payMode === "selected" && selectedTotalCents < MIN_PAYMENT_CENTS) {
      toast.error(`Minimum payment is ${formatCents(MIN_PAYMENT_CENTS)}.`);
      return;
    }

    try {
      setPaying(true);

      const response = await fetch("/api/finance/me/payments/stripe-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodId: selectedPaymentMethod.id,
          paymentMethodLabel: formatPaymentMethodLabel(selectedPaymentMethod),
          allocationMode:
            payMode === "balance" ? "auto_fifo" : "manual_selection",
          ...(payMode === "balance"
            ? { amountCents: outstandingCents }
            : {
                allocations: selectedAllocations,
                amountCents: selectedTotalCents,
              }),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to create payment.");
      }

      toast.success(
        "Payment submitted. Status will update once Stripe finalizes it.",
      );
      setPayDialogOpen(false);
      setSelectedObligationIds([]);
      setSelectedAmounts({});

      await loadOverview();
    } catch (paymentError) {
      toast.error(
        paymentError instanceof Error
          ? paymentError.message
          : "Failed to submit payment.",
      );
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="w-full h-full">
        <FinanceLoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!overview?.financeEnabled || !stripeCustomerId) {
    return (
      <div className="flex items-center justify-center h-full">
        <FinanceNotSetup
          onEnablePortal={handleEnablePortal}
          creatingCustomer={creatingCustomer}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-5">
      <div className="flex-none">
        <BalanceBar
          balanceCents={outstandingCents}
          payingBalance={paying}
          obligations={obligations}
          onPayBalanceClick={handlePayDialogOpen}
          onManagePaymentMethodsClick={() => setManageDialogOpen(true)}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <Ledger entries={ledgerEntries} loadingLedger={false} />
      </div>

      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-full overflow-x-hidden overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pay balance</DialogTitle>
            <DialogDescription>
              Pay the full outstanding balance or select specific charges to
              pay.
              {ALLOW_PARTIAL_PAYMENTS
                ? ""
                : " Partial payments are temporarily unavailable; each charge is paid in full."}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={payMode}
            onValueChange={(value) => {
              setPayMode(value as PayMode);
              if (value === "balance") {
                setSelectedObligationIds([]);
                setSelectedAmounts({});
              }
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="balance">Full Balance</TabsTrigger>
              <TabsTrigger value="selected">Select Charges</TabsTrigger>
            </TabsList>

            <TabsContent value="balance">
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">
                  Outstanding balance
                </p>
                <p className="text-2xl font-semibold">
                  {formatCents(outstandingCents)}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="selected">
              <div className="max-h-64 overflow-auto rounded-md border">
                {unpaidObligations.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    No unpaid charges.
                  </p>
                ) : (
                  <div className="divide-y">
                    {unpaidObligations.map((obligation) => {
                      const checked = selectedObligationIds.includes(
                        obligation.id,
                      );
                      return (
                        <label
                          key={obligation.id}
                          className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              handleToggleChargeSelection(
                                obligation.id,
                                e.target.checked,
                              )
                            }
                            className="size-4 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">
                              {obligation.chargeTitle}
                            </div>
                            {obligation.chargeDescription ? (
                              <div className="text-xs text-muted-foreground">
                                {obligation.chargeDescription}
                              </div>
                            ) : null}
                            <div className="text-xs text-muted-foreground">
                              Due: {formatDate(obligation.due_at)} · Remaining:{" "}
                              {formatCents(obligation.remaining_cents)}
                            </div>
                          </div>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 w-28"
                            disabled={!checked}
                            readOnly={!ALLOW_PARTIAL_PAYMENTS}
                            title={
                              ALLOW_PARTIAL_PAYMENTS
                                ? undefined
                                : "Partial payments are temporarily disabled"
                            }
                            placeholder="Amount"
                            value={selectedAmounts[obligation.id] ?? ""}
                            onChange={(e) =>
                              setSelectedAmounts((current) => ({
                                ...current,
                                [obligation.id]: e.target.value,
                              }))
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              {selectedTotalCents > 0 && (
                <div className="mt-2 text-sm text-right font-medium">
                  Selected total: {formatCents(selectedTotalCents)}
                </div>
              )}
            </TabsContent>
          </Tabs>
          <Separator />
          <ManagePaymentMethods
            stripeCustomerId={stripeCustomerId}
            selectedPaymentMethodId={selectedPaymentMethodId}
            onSelectedPaymentMethodChange={setSelectedPaymentMethodId}
            onPaymentMethodsChange={setPaymentMethods}
            isOpen={payDialogOpen}
            enforceVerifiedSelection
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPayDialogOpen(false)}
              disabled={paying}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleSubmitPayment();
              }}
              disabled={
                paying ||
                !selectedPaymentMethodId ||
                (payMode === "balance"
                  ? outstandingCents <= 0
                  : selectedTotalCents < MIN_PAYMENT_CENTS)
              }
            >
              {paying ? (
                <>
                  <Spinner className="size-4" />
                  Processing...
                </>
              ) : (
                `Pay ${formatCents(
                  payMode === "balance" ? outstandingCents : selectedTotalCents,
                )}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manageDialogOpen} onOpenChange={setManageDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Manage payment methods</DialogTitle>
            <DialogDescription>
              Add or remove cards and ACH accounts for finance payments.
            </DialogDescription>
          </DialogHeader>

          <ManagePaymentMethods
            stripeCustomerId={stripeCustomerId}
            selectedPaymentMethodId={selectedPaymentMethodId}
            onSelectedPaymentMethodChange={setSelectedPaymentMethodId}
            onPaymentMethodsChange={setPaymentMethods}
            allowDelete
            isOpen={manageDialogOpen}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
