'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Loader2,
  Percent,
  QrCode,
  Save,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { SharedQrSheet } from "@/components/SharedQr";
import { useToast } from "@/components/Toast";
import { DEFAULT_BANK } from "@/lib/bank";
import {
  DEFAULT_RELATION_FUND_PERCENT,
  saveBankAccount,
  saveRelationFundPercent,
  subscribeGlobalSettings,
} from "@/lib/settings";

function FundSettingsContent() {
  const { showToast } = useToast();
  const [percent, setPercent] = useState(String(DEFAULT_RELATION_FUND_PERCENT));
  const [bank, setBank] = useState({
    bankBin: DEFAULT_BANK.bankBin,
    accountNumber: DEFAULT_BANK.accountNumber,
    accountName: DEFAULT_BANK.accountName.replace(/_/g, " "),
    bankName: DEFAULT_BANK.bankName,
  });
  const [loading, setLoading] = useState(true);
  const [savingFund, setSavingFund] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [previewQr, setPreviewQr] = useState(false);

  useEffect(() => {
    const unsub = subscribeGlobalSettings(
      (settings) => {
        setPercent(String(settings.relationFundPercent));
        setBank({
          bankBin: settings.bank.bankBin,
          accountNumber: settings.bank.accountNumber,
          accountName: settings.bank.accountName.replace(/_/g, " "),
          bankName: settings.bank.bankName,
        });
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được cấu hình", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const handleSaveFund = async (e) => {
    e.preventDefault();
    const value = Number(percent);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      showToast("Nhập tỷ lệ từ 0 đến 100", "error");
      return;
    }

    setSavingFund(true);
    try {
      const saved = await saveRelationFundPercent(value);
      setPercent(String(saved));
      showToast("Đã lưu cấu hình quỹ đối ngoại", "success");
    } catch (error) {
      console.error(error);
      showToast("Lưu cấu hình thất bại", "error");
    } finally {
      setSavingFund(false);
    }
  };

  const handleSaveBank = async (e) => {
    e.preventDefault();
    if (!bank.accountNumber.trim() || !bank.accountName.trim()) {
      showToast("Nhập đủ số TK và tên chủ TK", "error");
      return;
    }

    setSavingBank(true);
    try {
      const saved = await saveBankAccount(bank);
      setBank({
        ...saved,
        accountName: saved.accountName.replace(/_/g, " "),
      });
      showToast("Đã lưu tài khoản QR chung", "success");
    } catch (error) {
      console.error(error);
      showToast("Lưu tài khoản thất bại", "error");
    } finally {
      setSavingBank(false);
    }
  };

  return (
    <AppShell title="Cấu hình" subtitle="Quỹ đối ngoại · QR chung">
      <Link
        href="/dashboard/monthly"
        className="mb-4 inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Về tổng kết tháng
      </Link>

      <button
        type="button"
        onClick={() => setPreviewQr(true)}
        className="touch-btn mb-4 h-14 w-full bg-brand-700 text-white"
      >
        <QrCode className="h-5 w-5" aria-hidden />
        Xem QR tài khoản chung
      </button>

      <section className="card-panel mb-4 space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-brand-700" aria-hidden />
          <h2 className="section-title">Tài khoản QR chung</h2>
        </div>
        <p className="text-sm text-slate-500">
          Dùng cho nút QR nổi trên điện thoại — khách quét nhận tiền nhanh.
        </p>

        <form onSubmit={handleSaveBank} className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Ngân hàng
            </span>
            <input
              className="field-input"
              value={bank.bankName}
              disabled={loading}
              onChange={(e) =>
                setBank((b) => ({ ...b, bankName: e.target.value }))
              }
              placeholder="Vietcombank"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Mã BIN ngân hàng (VietQR)
            </span>
            <input
              className="field-input"
              value={bank.bankBin}
              disabled={loading}
              onChange={(e) =>
                setBank((b) => ({ ...b, bankBin: e.target.value }))
              }
              placeholder="970436"
              required
            />
            <p className="mt-1 text-[11px] text-slate-400">
              VD: Vietcombank = 970436, MB = 970422, Techcombank = 970407
            </p>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Số tài khoản
            </span>
            <input
              className="field-input"
              inputMode="numeric"
              value={bank.accountNumber}
              disabled={loading}
              onChange={(e) =>
                setBank((b) => ({ ...b, accountNumber: e.target.value }))
              }
              placeholder="0987654321"
              required
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Tên chủ tài khoản
            </span>
            <input
              className="field-input"
              value={bank.accountName}
              disabled={loading}
              onChange={(e) =>
                setBank((b) => ({ ...b, accountName: e.target.value }))
              }
              placeholder="QUAN TRA DA"
              required
            />
          </label>
          <button
            type="submit"
            disabled={savingBank || loading}
            className="touch-btn h-14 w-full bg-slate-900 text-white"
          >
            {savingBank ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" aria-hidden />
            )}
            {savingBank ? "Đang lưu..." : "Lưu tài khoản QR"}
          </button>
        </form>
      </section>

      <section className="card-panel space-y-4">
        <div className="flex items-center gap-2">
          <Percent className="h-5 w-5 text-brand-700" aria-hidden />
          <h2 className="section-title">Tỷ lệ trích lập</h2>
        </div>

        <p className="text-sm text-slate-500">
          Mỗi tháng, nếu có lợi nhuận gộp dương, hệ thống trích{" "}
          <strong>{percent || 0}%</strong> vào Quỹ đối ngoại trước khi chia cổ
          tức cho cổ đông.
        </p>

        <form onSubmit={handleSaveFund} className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Phần trăm (%) trích lập Quỹ đối ngoại / Tháng
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.1"
              className="field-input money"
              value={percent}
              disabled={loading}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="5"
              required
            />
          </label>

          <button
            type="submit"
            disabled={savingFund || loading}
            className="touch-btn h-14 w-full bg-brand-700 text-white"
          >
            {savingFund ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" aria-hidden />
            )}
            {savingFund ? "Đang lưu..." : "Lưu cấu hình quỹ"}
          </button>
        </form>
      </section>

      <SharedQrSheet open={previewQr} onClose={() => setPreviewQr(false)} />
    </AppShell>
  );
}

export default function DashboardSettingsPage() {
  return (
    <ProtectedRoute allowRoles={["investor", "superadmin"]}>
      <FundSettingsContent />
    </ProtectedRoute>
  );
}
