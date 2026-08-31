'use client';

import { cn, todayInputValue } from "@/lib/utils";
import { formatRangeLabel, hasDateRange } from "@/lib/dateRange";

/**
 * Bộ lọc Từ ngày → Đến ngày + chỗ tổng kết kỳ (children / summary).
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
        dense ? "space-y-2 p-2.5" : "space-y-2.5 p-3",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Lọc theo ngày
        </p>
        {active ? (
          <p className="text-[11px] font-medium text-slate-500">
            {formatRangeLabel(dateFrom, dateTo)}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Từ ngày
          </span>
          <input
            type="date"
            className={cn("field-input text-sm", dense && "!h-10 !py-1.5")}
            value={dateFrom}
            max={dateTo || today}
            onChange={(e) => onFromChange?.(e.target.value)}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Đến ngày
          </span>
          <input
            type="date"
            className={cn("field-input text-sm", dense && "!h-10 !py-1.5")}
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
            className={cn(
              "touch-btn shrink-0 rounded-xl bg-slate-100 px-2.5 text-xs font-semibold text-slate-700",
              dense ? "h-10" : "h-11"
            )}
          >
            Xóa
          </button>
        ) : (
          <span
            className={cn("shrink-0", dense ? "h-10 w-10" : "h-11 w-10")}
            aria-hidden
          />
        )}
      </div>

      {summary ? <div className="border-t border-slate-100 pt-2">{summary}</div> : null}
    </div>
  );
}
