'use client';

import { cn, formatCurrency } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";

export function Money({ amount, className }) {
  return (
    <span className={cn("money", className)}>{formatCurrency(amount)}</span>
  );
}

export function DiscrepancyBadge({ value, className }) {
  const amount = Number(value) || 0;

  if (amount < 0) {
    return (
      <span
        className={cn(
          "chip gap-1 bg-rose-50 text-rose-700 ring-1 ring-rose-100",
          className
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Thất thoát: <Money amount={Math.abs(amount)} />
      </span>
    );
  }

  if (amount > 0) {
    return (
      <span
        className={cn(
          "chip gap-1 bg-amber-50 text-amber-800 ring-1 ring-amber-100",
          className
        )}
      >
        <TrendingUp className="h-3.5 w-3.5" aria-hidden />
        Dư quỹ: <Money amount={amount} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "chip gap-1 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
        className
      )}
    >
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      Khớp sổ
    </span>
  );
}

export function StatCard({ label, value, tone = "brand" }) {
  const tones = {
    brand: "bg-brand-700 text-white",
    success: "bg-emerald-700 text-white",
    danger: "bg-rose-700 text-white",
    muted: "bg-slate-800 text-white",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.25rem] p-4 shadow-soft-md",
        tones[tone] || tones.brand
      )}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10"
        aria-hidden
      />
      <p className="relative text-xs font-bold uppercase tracking-[0.1em] text-white/75">
        {label}
      </p>
      <p className="money relative mt-2 text-2xl font-bold leading-none">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

/** Metric phụ — nền trắng, không cầu vồng */
export function MetricTile({ label, value, className }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200",
        className
      )}
    >
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="money mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}
