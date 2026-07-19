'use client';

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  loginAsDefaultSuperAdmin,
  SUPERADMIN_DEFAULT_PASSWORD,
  SUPERADMIN_USERNAME,
} from "@/lib/bootstrap";
import { homePathForRole } from "@/lib/roles";

function friendlyAuthError(error) {
  const code = error?.code || "";
  const msg = String(error?.message || "");

  if (msg.includes("Nhập tên đăng nhập") || msg.includes("đã đổi")) {
    return msg;
  }
  if (
    code === "auth/user-not-found" ||
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-login-credentials" ||
    code === "auth/invalid-email"
  ) {
    return "Sai tên hoặc mật khẩu. Nhân viên: hỏi quản lý tên đã tạo. Admin: thử canhquan / canhquan hoặc nút xanh bên dưới.";
  }
  if (code === "auth/too-many-requests") {
    return "Thử quá nhiều lần — đợi rồi thử lại.";
  }
  if (code === "auth/network-request-failed") {
    return "Mất mạng — kiểm tra kết nối rồi thử lại.";
  }
  return "Không đăng nhập được. Gõ TÊN tài khoản (không gõ email) + mật khẩu.";
}

function LoginForm() {
  const { login, user, role, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    const next = searchParams.get("next");
    router.replace(next || homePathForRole(role));
  }, [authLoading, role, router, searchParams, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(identifier, password);
      showToast("Đăng nhập thành công", "success");
      // Redirect do useEffect khi AuthContext cập nhật
    } catch (error) {
      console.error(error);
      showToast(friendlyAuthError(error), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAdmin = async () => {
    setQuickLoading(true);
    try {
      await loginAsDefaultSuperAdmin();
      setIdentifier(SUPERADMIN_USERNAME);
      setPassword(SUPERADMIN_DEFAULT_PASSWORD);
      showToast("Đã vào Super Admin", "success");
    } catch (error) {
      console.error(error);
      showToast(friendlyAuthError(error), "error");
      setIdentifier(SUPERADMIN_USERNAME);
      setPassword("");
    } finally {
      setQuickLoading(false);
    }
  };

  const busy = loading || quickLoading || authLoading;

  return (
    <div className="relative flex min-h-dvh flex-col justify-end overflow-hidden bg-brand-800 px-4 pb-10 pt-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.45),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.18),transparent_35%)]" />

      <div className="relative z-10 mx-auto w-full max-w-lg">
        <div className="mb-8 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">
            Quản lý quán
          </p>
          <h1 className="mt-2 text-4xl font-extrabold leading-none">
            Trà Đá App
          </h1>
          <p className="mt-3 max-w-sm text-sm text-blue-100">
            Chỉ cần <strong>tên đăng nhập</strong> + mật khẩu.
            <br />
            Không dùng email.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[28px] bg-white p-5 shadow-2xl shadow-brand-900/30"
        >
          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Tên đăng nhập
            </span>
            <input
              type="text"
              name="username"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              enterKeyHint="next"
              value={identifier}
              onChange={(e) =>
                setIdentifier(
                  e.target.value.replace(/@.*/g, "").replace(/\s/g, "")
                )
              }
              className="field-input text-lg"
              placeholder="vd: nhanvien1"
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Mật khẩu
            </span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input text-lg"
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="touch-btn h-16 w-full bg-brand-700 text-lg text-white disabled:opacity-60"
          >
            {loading ? "Đang vào..." : "Đăng nhập"}
          </button>

          <div className="my-4 h-px bg-slate-100" />

          <p className="mb-2 text-center text-xs font-semibold text-slate-500">
            Dành cho Super Admin lần đầu
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={handleQuickAdmin}
            className="touch-btn h-14 w-full bg-emerald-600 text-white disabled:opacity-60"
          >
            {quickLoading
              ? "Đang vào..."
              : "Vào Super Admin (canhquan)"}
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            Nhân viên / quản lý: dùng đúng <strong>tên</strong> Admin đã tạo
            (không phải email).
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-brand-800">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
