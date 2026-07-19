"use client";

import { useState } from "react";
import { CalendarDays, Loader2, Smartphone } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { recordBankingByDate } from "@/lib/sales";
import {
  formatCurrency,
  inputValueToDateKey,
  todayInputValue,
} from "@/lib/utils";

/**
 * Form gõ CK theo ngày — dùng ở Đối soát (không đặt trên POS).
 */
export default function BankingByDateForm({ className = "" }) {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [ckDate, setCkDate] = useState(todayInputValue);
  const [ckAmount, setCkAmount] = useState("");
  const [ckNote, setCkNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await recordBankingByDate({
        amount: ckAmount,
        dateInput: ckDate,
        note: ckNote,
        user,
        profile,
      });
      setCkAmount("");
      setCkNote("");
      showToast(
        `Đã ghi CK · ${result.businessDate} · ${formatCurrency(result.amount)}`,
        "success"
      );
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Ghi CK thất bại", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className={`rounded-[1.25rem] bg-white p-4 shadow-sm ring-1 ring-brand-100 ${className}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-brand-700" aria-hidden />
        <div>
          <h2 className="text-base font-extrabold text-slate-900">
            Nhập chuyển khoản theo ngày
          </h2>
          <p className="text-xs font-medium text-slate-500">
            Chọn ngày → gõ số tiền CK từ app ngân hàng
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Ngày nhận CK
          </span>
          <input
            type="date"
            className="field-input"
            max={todayInputValue()}
            value={ckDate}
            onChange={(e) => setCkDate(e.target.value || todayInputValue())}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Số tiền chuyển khoản
          </span>
          <input
            type="text"
            inputMode="numeric"
            className="field-input money text-xl font-extrabold"
            placeholder="0"
            value={ckAmount}
            onChange={(e) =>
              setCkAmount(e.target.value.replace(/[^\d]/g, ""))
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Ghi chú (tuỳ chọn)
          </span>
          <input
            type="text"
            className="field-input"
            placeholder="VD: CK khách / sao kê NH"
            value={ckNote}
            onChange={(e) => setCkNote(e.target.value)}
          />
        </label>

        <button
          type="button"
          disabled={submitting || !ckAmount}
          onClick={handleSubmit}
          className="touch-btn h-12 w-full gap-2 bg-brand-700 text-sm font-extrabold text-white disabled:opacity-35"
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <Smartphone className="h-5 w-5" aria-hidden />
              Ghi CK ngày {inputValueToDateKey(ckDate)}
            </>
          )}
        </button>
      </div>
    </section>
  );
}
