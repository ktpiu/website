export type FinanceMember = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  roleIds: string[];
  roleNames: string[];
  financeEnabled: boolean;
  outstandingCents: number;
  overdueCount: number;
  avatar: string | null;
  grade: string | null;
  isAlumni: boolean;
  isInactive: boolean;
  isDisaffiliated: boolean;
  hasPledgeClass: boolean;
  pledgeClass: string | null;
};

export type FinanceRole = {
  id: string;
  name: string;
  type: string | null;
};

export type ChargeSummary = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  defaultAmountCents: number | null;
  currency: string;
  createdAt: string | null;
  totalAssigned: number;
  totalCents: number;
  paidCents: number;
  unpaidCount: number;
  overdueCount: number;
  outstandingCents: number;
};

export function formatCents(amountCents: number) {
  return amountCents % 100 === 0
    ? `$${(amountCents / 100).toLocaleString("en-US")}`
    : `$${(amountCents / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

export function parseDollarsToCents(input: string) {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function formatDate(dateValue: string | null, fallback = "No due date") {
  if (!dateValue) return fallback;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function daysOverdue(dueAt: string | null) {
  if (!dueAt) return 0;
  const diff = Date.now() - new Date(dueAt).getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}
