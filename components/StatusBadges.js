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
          "chip gap-1 bg-red-50 text-red-700 ring-1 ring-red-100",
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
          "chip gap-1 bg-amber-50 text-amber-700 ring-1 ring-amber-100",
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
    brand: "from-brand-700 to-brand-800 text-white",
    success: "from-emerald-600 to-emerald-700 text-white",
    danger: "from-rose-600 to-rose-700 text-white",
    muted: "from-slate-700 to-slate-800 text-white",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.25rem] bg-gradient-to-br p-4 shadow-md",
        tones[tone] || tones.brand
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/75">
        {label}
      </p>
      <p className="money mt-2 text-2xl font-extrabold leading-none">
        {formatCurrency(value)}
      </p>
    </div>
  );
}
