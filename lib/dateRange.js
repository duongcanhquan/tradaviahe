import {
  endOfDay,
  endOfMonth,
  format,
  isValid,
  parse,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { todayInputValue } from "./utils";

/** ms ngày nghiệp vụ: timestamp → businessDate dd/MM/yyyy */
export function rowBusinessMs(row) {
  const ms = row?.timestamp?.toMillis?.() ?? row?.createdAt?.toMillis?.() ?? 0;
  if (ms) return ms;
  const key = String(row?.businessDate || "").trim();
  if (!key) return 0;
  const d = parse(key, "dd/MM/yyyy", new Date());
  return isValid(d) ? startOfDay(d).getTime() : 0;
}

/** yyyy-MM-dd → ms đầu/cuối ngày */
export function parseRangeBound(inputValue, asEnd = false) {
  if (!inputValue) return null;
  const d = parseISO(String(inputValue));
  if (!isValid(d)) return null;
  return asEnd ? endOfDay(d).getTime() : startOfDay(d).getTime();
}

export function hasDateRange(fromInput, toInput) {
  return Boolean(fromInput || toInput);
}

export function rowInDateRange(row, fromInput, toInput) {
  const fromMs = parseRangeBound(fromInput, false);
  const toMs = parseRangeBound(toInput, true);
  if (fromMs == null && toMs == null) return true;
  const ms = rowBusinessMs(row);
  if (!ms) return false;
  if (fromMs != null && ms < fromMs) return false;
  if (toMs != null && ms > toMs) return false;
  return true;
}

export function filterRowsByDateRange(rows = [], fromInput, toInput) {
  if (!hasDateRange(fromInput, toInput)) return rows;
  return rows.filter((r) => rowInDateRange(r, fromInput, toInput));
}

/** Nhãn khoảng ngày cho UI */
export function formatRangeLabel(fromInput, toInput) {
  const fmt = (v) => {
    if (!v) return null;
    const d = parseISO(String(v));
    return isValid(d) ? format(d, "dd/MM/yyyy") : String(v);
  };
  const a = fmt(fromInput);
  const b = fmt(toInput);
  if (a && b) return a === b ? a : `${a} → ${b}`;
  if (a) return `Từ ${a}`;
  if (b) return `Đến ${b}`;
  return "Mọi ngày";
}

/** Đầu / cuối tháng → yyyy-MM-dd (to không vượt hôm nay) */
export function monthInputBounds(year, monthIndex) {
  const from = startOfMonth(new Date(year, monthIndex, 1));
  let to = endOfMonth(from);
  const today = startOfDay(new Date());
  if (to.getTime() > today.getTime()) to = today;
  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}

export function clampDateInput(value, max = todayInputValue()) {
  if (!value) return "";
  if (max && value > max) return max;
  return value;
}
