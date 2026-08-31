'use client';

import { useEffect, useMemo, useState } from "react";
import { QrCode, X, Copy, Check } from "lucide-react";
import { buildVietQrUrl, prefetchVietQrImage } from "@/lib/bank";
import {
  getCachedBank,
  subscribeGlobalSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import { dateInfoCode, formatCurrency } from "@/lib/utils";

const QUICK_AMOUNTS = [10000, 20000, 50000, 100000];

export function SharedQrSheet({ open, onClose, initialAmount = "" }) {
  const [bank, setBank] = useState(getCachedBank);
  const [amount, setAmount] = useState(initialAmount);
  const [copied, setCopied] = useState(false);

  // Luôn giữ bank nóng (kể cả khi đóng) — lần mở sau hiện QR ngay.
  useEffect(() => {
    const unsub = subscribeGlobalSettings(
      (settings) => setBank(settings.bank),
      () => setBank(getCachedBank())
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!open) return;
    setAmount(initialAmount || "");
  }, [open, initialAmount]);

  const qrUrl = useMemo(() => {
    if (!bank) return "";
    return buildVietQrUrl({
      ...bank,
      amount: amount && Number(amount) > 0 ? amount : undefined,
      addInfo: `Trada_${dateInfoCode()}`,
    });
  }, [bank, amount]);

  useEffect(() => {
    if (qrUrl) prefetchVietQrImage(qrUrl);
  }, [qrUrl]);

  const copyAccount = async () => {
    if (!bank?.accountNumber) return;
    try {
      await navigator.clipboard.writeText(bank.accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-slate-950/60 sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-qr-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer"
        aria-label="Đóng"
        onClick={onClose}
      />

      <div className="relative z-10 max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="shared-qr-title" className="text-xl font-extrabold text-slate-900">
              QR chuyển khoản
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Đưa màn hình cho khách quét — nhận tiền nhanh
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng QR"
            onClick={onClose}
            className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100 transition active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-3">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrUrl}
              alt="Mã VietQR tài khoản chung quán trà đá"
              width={360}
              height={360}
              decoding="async"
              fetchPriority="high"
              className="mx-auto h-auto w-full max-w-[340px]"
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-slate-400">
              Đang tải QR...
            </div>
          )}
        </div>

        <div className="mt-4 space-y-1 rounded-2xl bg-brand-50 px-4 py-3 text-sm">
          <p className="font-bold text-brand-900">
            {bank?.accountName?.replace(/_/g, " ") || "—"}
          </p>
          <p className="text-slate-600">
            {bank?.bankName || "Ngân hàng"} ·{" "}
            <span className="money font-semibold text-slate-900">
              {bank?.accountNumber || "—"}
            </span>
          </p>
          <button
            type="button"
            onClick={copyAccount}
            className="touch-btn mt-2 h-11 w-full gap-2 bg-white text-brand-800 ring-1 ring-brand-100"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Đã copy STK" : "Copy số tài khoản"}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Số tiền (tuỳ chọn)
            </span>
            <input
              type="number"
              inputMode="numeric"
              className="field-input money"
              placeholder="Để trống = QR không gắn số tiền"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amount && Number(amount) > 0 ? (
              <p className="mt-1.5 text-xs font-semibold text-brand-700">
                = {formatCurrency(amount)}
              </p>
            ) : null}
          </label>

          <div className="grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(String(v))}
                className={cn(
                  "touch-btn h-12 px-1 text-[11px] font-bold",
                  Number(amount) === v
                    ? "bg-brand-700 text-white"
                    : "bg-slate-100 text-slate-700"
                )}
              >
                {(v / 1000).toFixed(0)}k
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nút nổi góc phải dưới — bấm hiện QR ngay trên điện thoại */
export function SharedQrFab() {
  const [open, setOpen] = useState(false);

  // Warm bank + prefetch QR tài khoản ngay khi vào app (trước khi bấm).
  useEffect(() => {
    const unsub = subscribeGlobalSettings(
      (settings) => {
        prefetchVietQrImage(
          buildVietQrUrl({
            ...settings.bank,
            addInfo: `Trada_${dateInfoCode()}`,
          })
        );
      },
      () => {
        prefetchVietQrImage(
          buildVietQrUrl({
            ...getCachedBank(),
            addInfo: `Trada_${dateInfoCode()}`,
          })
        );
      }
    );
    return () => unsub();
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mở QR chuyển khoản"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-4 z-[55] flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-brand-700 text-white shadow-lg shadow-brand-900/30 transition duration-200 active:scale-95"
      >
        <QrCode className="h-7 w-7" aria-hidden />
      </button>
      <SharedQrSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
