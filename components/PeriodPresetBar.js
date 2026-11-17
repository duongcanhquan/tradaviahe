"use client";

const PRESETS = [
  {
    id: "day",
    label: "Hôm nay",
    idle: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    on: "bg-emerald-600 text-white ring-emerald-700",
  },
  {
    id: "week",
    label: "Tuần",
    idle: "bg-sky-50 text-sky-900 ring-sky-200",
    on: "bg-sky-600 text-white ring-sky-700",
  },
  {
    id: "month",
    label: "Tháng",
    idle: "bg-amber-50 text-amber-950 ring-amber-200",
    on: "bg-amber-500 text-white ring-amber-600",
  },
  {
    id: "all",
    label: "Từ đầu",
    idle: "bg-violet-50 text-violet-950 ring-violet-200",
    on: "bg-violet-700 text-white ring-violet-800",
  },
];

/** Một hàng nút kỳ. “Từ đầu” = chốt tháng trước + phiếu tháng này. */
export default function PeriodPresetBar({ active = "day", onChange }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {PRESETS.map((item) => {
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange?.(item.id)}
            className={`touch-btn h-12 w-full rounded-2xl px-0.5 text-[11px] font-bold ring-1 sm:text-sm ${
              selected ? item.on : item.idle
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
