'use client';

import { cn, todayInputValue } from "@/lib/utils";
import { formatRangeLabel, hasDateRange } from "@/lib/dateRange";
import { FieldLabel } from "@/components/ui/MobileUI";

/**
 * Bộ lọc Từ ngày → Đến ngày + chỗ tổng kết kỳ.
 */
export default function DateRangeFilter({
  dateFrom = "",
  dateTo = "",
  onFromChange,
  onToChange,
  onClear,
  summary = null,
  className,
  dense = false,
}) {
  const active = hasDateRange(dateFrom, dateTo);
  const today = todayInputValue();

  return (
    <div
      className={cn(
        "rounded-2xl bg-white ring-1 ring-slate-200",
        dense ? "space-y-2 p-3" : "space-y-3 p-4",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800">Lọc theo ngày</p>
        {active ? (
          <p className="text-xs font-bold text-slate-500">
            {formatRangeLabel(dateFrom, dateTo)}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block min-w-0">
          <FieldLabel>Từ ngày</FieldLabel>
          <input
            type="date"
            className={cn("field-input", dense && "!h-12")}
            value={dateFrom}
            max={dateTo || today}
            onChange={(e) => onFromChange?.(e.target.value)}
          />
        </label>
        <label className="block min-w-0">
          <FieldLabel>Đến ngày</FieldLabel>
          <input
            type="date"
            className={cn("field-input", dense && "!h-12")}
            value={dateTo}
            min={dateFrom || undefined}
            max={today}
            onChange={(e) => onToChange?.(e.target.value)}
          />
        </label>
        {active ? (
          <button
            type="button"
            onClick={() => onClear?.()}
            className="touch-btn h-12 shrink-0 rounded-2xl bg-slate-100 px-4 text-sm font-bold text-slate-700 sm:h-14"
          >
            Xóa lọc
          </button>
        ) : null}
      </div>

      {summary ? (
        <div className="border-t border-slate-100 pt-3">{summary}</div>
      ) : null}
    </div>
  );
}
