'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc } from "firebase/firestore";
import Link from "next/link";
import {
  KeyRound,
  LogOut,
  Package,
  PackagePlus,
  QrCode,
  UserCog,
  UserPlus,
  Wallet,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { SharedQrSheet } from "@/components/SharedQr";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import { seedDefaultCatalog } from "@/lib/products";
import { displayRoleLabel } from "@/lib/roles";

function SettingsContent() {
  const {
    profile,
    logout,
    changePassword,
    canManageShop,
    canManageUsers,
    canManageEmployees,
    canOperateShop,
    isEmployee,
    user,
  } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPass, setChangingPass] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      showToast("Mật khẩu mới tối thiểu 6 ký tự", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("Xác nhận mật khẩu không khớp", "error");
      return;
    }

    setChangingPass(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Đã đổi mật khẩu thành công", "success");
    } catch (error) {
      console.error(error);
      const code = error?.code || "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        showToast("Mật khẩu hiện tại không đúng", "error");
      } else if (code === "auth/too-many-requests") {
        showToast("Thử quá nhiều lần — đợi rồi thử lại", "error");
      } else {
        showToast(error?.message || "Đổi mật khẩu thất bại", "error");
      }
    } finally {
      setChangingPass(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      showToast("Đã đăng xuất — máy quên tài khoản này", "info");
      router.replace("/login");
    } catch (error) {
      console.error(error);
      showToast("Đăng xuất thất bại", "error");
    }
  };

  const seedProducts = async () => {
    setSeeding(true);
    try {
      await seedDefaultCatalog();
      showToast("Đã tạo danh mục mẫu (NL + công thức)", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Seed sản phẩm thất bại", "error");
    } finally {
      setSeeding(false);
    }
  };

  const ensureUserProfile = async () => {
    try {
      const username =
        profile?.username || user.email?.split("@")[0] || "user";
      const payload = {
        uid: user.uid,
        email: user.email,
        username,
        name: profile?.name || username || "Người dùng",
      };
      // Không tự gán role cao hơn — giữ role hiện có nếu đã có
      if (profile?.role) payload.role = profile.role;
      await setDoc(doc(db, "users", user.uid), payload, { merge: true });
      showToast("Đã đồng bộ hồ sơ users", "success");
    } catch (error) {
      console.error(error);
      showToast("Không lưu được hồ sơ", "error");
    }
  };

  if (isEmployee) {
    return (
      <AppShell title="Tài khoản" subtitle="Nhân viên" employeeMode>
        <section className="card-panel mb-4 space-y-1 text-center">
          <p className="text-xl font-extrabold text-slate-900">
            {profile?.name || "—"}
          </p>
          <p className="text-sm text-slate-500">
            @{profile?.username || "—"} · Nhân viên
          </p>
        </section>

        <section className="card-panel mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-700" aria-hidden />
            <h2 className="section-title">Đổi mật khẩu</h2>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <input
              type="password"
              required
              autoComplete="current-password"
              className="field-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Mật khẩu hiện tại"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="field-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mật khẩu mới (≥6 ký tự)"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="field-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
            />
            <button
              type="submit"
              disabled={changingPass}
              className="touch-btn h-14 w-full bg-slate-900 text-white"
            >
              {changingPass ? "Đang đổi..." : "Lưu mật khẩu"}
            </button>
          </form>
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="touch-btn h-16 w-full gap-2 border-2 border-slate-200 bg-white text-base font-bold text-slate-800"
        >
          <LogOut className="h-6 w-6" />
          Đăng xuất
        </button>
      </AppShell>
    );
  }

  return (
    <AppShell title="Cài đặt" subtitle="Tài khoản & tiện ích">
      <section className="card-panel mb-4 space-y-2">
        <p className="text-sm text-slate-500">Đang đăng nhập</p>
        <p className="text-lg font-bold">{profile?.name || "—"}</p>
        <p className="text-sm text-slate-600">
          @{profile?.username || profile?.email?.split("@")[0] || "—"}
        </p>
        <p className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
          Vai trò: {displayRoleLabel(profile?.role)}
        </p>
      </section>

      <section className="card-panel mb-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand-700" aria-hidden />
          <h2 className="section-title">Đổi mật khẩu</h2>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Mật khẩu hiện tại
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="field-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Mật khẩu mới
            </span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="field-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Xác nhận mật khẩu mới
            </span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="field-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
            />
          </label>
          <button
            type="submit"
            disabled={changingPass}
            className="touch-btn h-14 w-full bg-slate-900 text-white"
          >
            {changingPass ? "Đang đổi..." : "Lưu mật khẩu mới"}
          </button>
        </form>
      </section>

      {canOperateShop ? (
        <button
          type="button"
          onClick={() => setShowQr(true)}
          className="touch-btn mb-4 h-14 w-full bg-brand-700 text-white"
        >
          <QrCode className="h-5 w-5" aria-hidden />
          QR tài khoản chung — đưa khách quét
        </button>
      ) : null}

      {canManageUsers ? (
        <Link
          href="/admin/users"
          className="touch-btn mb-4 h-14 w-full justify-between gap-2 bg-brand-700 px-5 text-white"
        >
          <span className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Người dùng · Admin
          </span>
          <span className="text-sm text-white/80">Mở →</span>
        </Link>
      ) : canManageEmployees ? (
        <Link
          href="/admin/users"
          className="touch-btn mb-4 h-14 w-full justify-between gap-2 bg-emerald-700 px-5 text-white"
        >
          <span className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Nhân viên
          </span>
          <span className="text-sm text-white/80">Mở →</span>
        </Link>
      ) : null}

      <section className="card-panel mb-4 space-y-3">
        <h2 className="font-bold">Hồ sơ Firestore</h2>
        <p className="text-sm text-slate-500">
          Document <code>users/{user?.uid}</code> dùng role:{" "}
          <code>superadmin</code>, <code>manager</code>, <code>employee</code>,
          hoặc <code>investor</code>.
        </p>
        <button
          type="button"
          onClick={ensureUserProfile}
          className="touch-btn h-12 w-full gap-2 bg-slate-900 text-white"
        >
          <UserPlus className="h-5 w-5" />
          Đồng bộ hồ sơ hiện tại
        </button>
      </section>

      {canManageShop ? (
        <>
          <Link
            href="/manager/expenses"
            className="touch-btn mb-4 h-14 w-full gap-2 bg-rose-600 text-white"
          >
            <Wallet className="h-5 w-5" />
            Quỹ cửa hàng · nạp & chi
          </Link>

          <Link
            href="/manager/products"
            className="touch-btn mb-4 h-14 w-full gap-2 bg-slate-900 text-white"
          >
            <Package className="h-5 w-5" />
            Món · giá bán
          </Link>

          <Link
            href="/admin/products"
            className="touch-btn mb-4 h-14 w-full gap-2 bg-amber-600 text-white"
          >
            <Package className="h-5 w-5" />
            Setup món · giá · nhóm SP
          </Link>

          <section className="card-panel mb-4 space-y-3">
            <h2 className="font-bold">Dữ liệu mẫu</h2>
            <button
              type="button"
              disabled={seeding}
              onClick={seedProducts}
              className="touch-btn h-12 w-full gap-2 bg-brand-700 text-white disabled:opacity-50"
            >
              <PackagePlus className="h-5 w-5" />
              {seeding ? "Đang seed..." : "Seed NL + Trà đá (công thức)"}
            </button>
            <p className="text-xs text-slate-500">
              Tạo nguyên liệu (trà, đường, ly…) và thành phẩm có giá bán + cost
              (công thức hoặc nhập tay). Chỉ khi chưa có sản phẩm.
            </p>
          </section>
        </>
      ) : null}

      <button
        type="button"
        onClick={handleLogout}
        className="touch-btn h-14 w-full gap-2 border border-slate-200 bg-white text-slate-800"
      >
        <LogOut className="h-5 w-5" />
        Đăng xuất
      </button>

      <SharedQrSheet open={showQr} onClose={() => setShowQr(false)} />
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "employee", "investor"]}>
      <SettingsContent />
    </ProtectedRoute>
  );
}
