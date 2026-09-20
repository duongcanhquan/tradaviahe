'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc } from "firebase/firestore";
import {
  Building2,
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
import { FieldLabel, SectionHeader, SettingsRow } from "@/components/ui/MobileUI";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import { seedDefaultCatalog } from "@/lib/products";
import { displayRoleLabel } from "@/lib/roles";

function PasswordForm({
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  changingPass,
  onSubmit,
  showLabels = true,
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        {showLabels ? <FieldLabel>Mật khẩu hiện tại</FieldLabel> : null}
        <input
          type="password"
          required
          autoComplete="current-password"
          className="field-input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder={showLabels ? "••••••••" : "Mật khẩu hiện tại"}
        />
      </label>
      <label className="block">
        {showLabels ? <FieldLabel>Mật khẩu mới</FieldLabel> : null}
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="field-input"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={showLabels ? "Tối thiểu 6 ký tự" : "Mật khẩu mới (≥6)"}
        />
      </label>
      <label className="block">
        {showLabels ? <FieldLabel>Xác nhận mật khẩu mới</FieldLabel> : null}
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="field-input"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={showLabels ? "Nhập lại mật khẩu mới" : "Nhập lại mật khẩu"}
        />
      </label>
      <button
        type="submit"
        disabled={changingPass}
        className="btn-primary h-14 disabled:opacity-50"
      >
        {changingPass ? "Đang đổi..." : "Lưu mật khẩu"}
      </button>
    </form>
  );
}

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
      if (profile?.role) payload.role = profile.role;
      await setDoc(doc(db, "users", user.uid), payload, { merge: true });
      showToast("Đã đồng bộ hồ sơ users", "success");
    } catch (error) {
      console.error(error);
      showToast("Không lưu được hồ sơ", "error");
    }
  };

  const passwordProps = {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    changingPass,
    onSubmit: handleChangePassword,
  };

  if (isEmployee) {
    return (
      <AppShell title="Tài khoản" subtitle="Nhân viên" employeeMode>
        <section className="mb-6 rounded-[1.25rem] bg-white px-5 py-6 text-center ring-1 ring-slate-200">
          <p className="text-xl font-bold text-slate-900">
            {profile?.name || "—"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            @{profile?.username || "—"} · Nhân viên
          </p>
        </section>

        <section className="card-panel mb-6 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-700" aria-hidden />
            <h2 className="section-title">Đổi mật khẩu</h2>
          </div>
          <PasswordForm {...passwordProps} showLabels={false} />
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="touch-btn h-14 w-full gap-2 border-2 border-slate-200 bg-white text-base font-bold text-slate-800"
        >
          <LogOut className="h-5 w-5" aria-hidden />
          Đăng xuất
        </button>
      </AppShell>
    );
  }

  return (
    <AppShell title="Cài đặt" subtitle="Tài khoản & tiện ích">
      <section className="mb-6 rounded-[1.25rem] bg-white px-5 py-5 ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">Đang đăng nhập</p>
        <p className="mt-1 text-xl font-bold text-slate-900">
          {profile?.name || "—"}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          @{profile?.username || profile?.email?.split("@")[0] || "—"}
        </p>
        <p className="mt-3 inline-flex rounded-2xl bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800">
          {displayRoleLabel(profile?.role)}
        </p>
      </section>

      <section className="card-panel mb-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand-700" aria-hidden />
          <h2 className="section-title">Đổi mật khẩu</h2>
        </div>
        <PasswordForm {...passwordProps} />
      </section>

      <section className="mb-6 space-y-2">
        <SectionHeader title="Truy cập nhanh" />
        {canOperateShop ? (
          <SettingsRow
            icon={QrCode}
            title="QR tài khoản chung"
            onClick={() => setShowQr(true)}
          />
        ) : null}

        {canManageUsers ? (
          <SettingsRow
            href="/admin/users"
            icon={UserCog}
            title="Người dùng · Admin"
          />
        ) : canManageEmployees ? (
          <SettingsRow href="/admin/users" icon={UserCog} title="Nhân viên" />
        ) : null}

        {canManageShop ? (
          <>
            <SettingsRow
              href="/manager/construction"
              icon={Building2}
              title="Mảng xây dựng"
            />
            <SettingsRow
              href="/manager/products"
              icon={Package}
              title="Món · công thức"
            />
            <SettingsRow
              href="/manager/expenses"
              icon={Wallet}
              title="Quỹ cửa hàng"
            />
            <SettingsRow
              href="/manager/inventory"
              icon={Package}
              title="Nhập hàng · tồn kho"
            />
            <SettingsRow
              href="/admin/products"
              icon={Package}
              title="Setup nhóm SP"
            />
          </>
        ) : null}
      </section>

      <section className="card-panel mb-6 space-y-3">
        <SectionHeader title="Hồ sơ" hint="Đồng bộ document users" />
        <button
          type="button"
          onClick={ensureUserProfile}
          className="btn-primary h-14"
        >
          <UserPlus className="h-5 w-5" aria-hidden />
          Đồng bộ hồ sơ hiện tại
        </button>
      </section>

      {canManageShop ? (
        <section className="card-panel mb-6 space-y-3">
          <SectionHeader
            title="Dữ liệu mẫu"
            hint="Chỉ khi chưa có sản phẩm"
          />
          <button
            type="button"
            disabled={seeding}
            onClick={seedProducts}
            className="btn-primary h-14 disabled:opacity-50"
          >
            <PackagePlus className="h-5 w-5" aria-hidden />
            {seeding ? "Đang seed..." : "Seed NL + Trà đá"}
          </button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={handleLogout}
        className="touch-btn h-14 w-full gap-2 border border-slate-200 bg-white text-slate-800"
      >
        <LogOut className="h-5 w-5" aria-hidden />
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
