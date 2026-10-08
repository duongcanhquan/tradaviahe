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
];

/** Một hàng nút kỳ, giãn đều. Không có nút “tất cả”. */
export default function PeriodPresetBar({ active = "day", onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PRESETS.map((item) => {
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange?.(item.id)}
            className={`touch-btn h-12 w-full rounded-2xl px-1 text-sm font-bold ring-1 ${
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
