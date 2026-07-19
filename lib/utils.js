import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, isValid, parse, parseISO, startOfDay } from "date-fns";
import { Timestamp } from "firebase/firestore";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount) {
  const value = Number(amount) || 0;
  return `${value.toLocaleString("vi-VN")} đ`;
}

export function todayKey() {
  return format(new Date(), "dd/MM/yyyy");
}

/** Giá trị cho <input type="date"> — yyyy-MM-dd */
export function todayInputValue() {
  return format(new Date(), "yyyy-MM-dd");
}

export function dateInfoCode() {
  return format(new Date(), "ddMMyyyy");
}

/** dd/MM/yyyy từ input yyyy-MM-dd */
export function inputValueToDateKey(inputValue) {
  if (!inputValue) return todayKey();
  const d = parseISO(String(inputValue));
  if (!isValid(d)) return todayKey();
  return format(d, "dd/MM/yyyy");
}

/**
 * Timestamp Firestore gắn đúng ngày nghiệp vụ (CK theo ngày).
 * Giữ giờ phút hiện tại để thứ tự trong ngày vẫn ổn; không cho ngày tương lai.
 */
export function timestampForBusinessDate(inputValue) {
  const now = new Date();
  let day = inputValue ? parseISO(String(inputValue)) : now;
  if (!isValid(day)) day = now;

  const todayStart = startOfDay(now);
  if (startOfDay(day).getTime() > todayStart.getTime()) {
    day = now;
  }

  const at = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
  return Timestamp.fromDate(at);
}

export function parseDateKey(dateKey) {
  const d = parse(String(dateKey || ""), "dd/MM/yyyy", new Date());
  return isValid(d) ? d : null;
}
