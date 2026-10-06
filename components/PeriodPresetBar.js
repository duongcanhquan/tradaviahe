"use client";

import { ChipRow, FilterChip } from "@/components/ui/MobileUI";

const PRESETS = [
  { id: "day", label: "Hôm nay" },
  { id: "week", label: "Tuần" },
  { id: "month", label: "Tháng" },
];

/** Chọn kỳ rồi mới query. Không có nút “tất cả”. */
export default function PeriodPresetBar({ active = "day", onChange }) {
  return (
    <ChipRow>
      {PRESETS.map((item) => (
        <FilterChip
          key={item.id}
          active={active === item.id}
          onClick={() => onChange?.(item.id)}
        >
          {item.label}
        </FilterChip>
      ))}
    </ChipRow>
  );
}
