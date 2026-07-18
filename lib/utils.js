import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

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

export function dateInfoCode() {
  return format(new Date(), "ddMMyyyy");
}
