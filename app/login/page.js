'use client';

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  ensureDefaultSuperAdmin,
  SUPERADMIN_DEFAULT_PASSWORD,
  SUPERADMIN_USERNAME,
} from "@/lib/bootstrap";
import { homePathForRole } from "@/lib/roles";

function LoginForm() {
  const { login, user, role, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState(SUPERADMIN_USERNAME);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    const next = searchParams.get("next");
    router.replace(next || homePathForRole(role));
  }, [authLoading, role, router, searchParams, user]);

  const handleBootstrap = async () => {
    setBootstrapping(true);
    try {
      const result = await ensureDefaultSuperAdmin();
      if (result.created) {
        showToast("Đã tạo Super Admin canhquan — hãy đăng nhập", "success");
        setIdentifier(SUPERADMIN_USERNAME);
        setPassword(SUPERADMIN_DEFAULT_PASSWORD);
      } else if (result.reason === "already_exists") {
        showToast("Hệ thống đã có Super Admin", "info");
      } else if (result.reason === "auth_exists_login") {
        showToast("Tài khoản đã có trên Auth — đăng nhập canhquan/canhquan", "info");
        setIdentifier(SUPERADMIN_USERNAME);
        setPassword(SUPERADMIN_DEFAULT_PASSWORD);
      }
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Khởi tạo Super Admin thất bại", "error");
    } finally {
      setBootstrapping(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Nếu lần đầu: thử bootstrap trước khi login
      try {
        await ensureDefaultSuperAdmin();
      } catch {
        // bỏ qua — có thể đã có tài khoản
      }

      await login(identifier.trim(), password);
      showToast("Đăng nhập thành công", "success");
      router.replace("/");
    } catch (error) {
      console.error(error);
      const code = error?.code || "";
      const msg = error?.message || "";
      if (msg.includes("không dùng email")) {
        showToast("Chỉ cần tên đăng nhập, không dùng email", "error");
      } else if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
        showToast(
          "Sai tài khoản. Bấm “Khởi tạo Super Admin” nếu lần đầu dùng app",
          "error"
        );
      } else {
        showToast("Tên đăng nhập hoặc mật khẩu không đúng", "error");
      }
    } finally {
      setLoading(false);
    }
  };

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
          <p className="mt-3 max-w-xs text-sm text-blue-100">
            Super Admin: <strong>canhquan</strong> / <strong>canhquan</strong>
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
              required
              autoComplete="username"
              inputMode="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.replace(/@.*$/, ""))}
              className="field-input"
              placeholder="canhquan"
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Mật khẩu
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input"
              placeholder="canhquan"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="touch-btn h-14 w-full bg-brand-700 text-white"
          >
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>

          <button
            type="button"
            disabled={bootstrapping}
            onClick={handleBootstrap}
            className="touch-btn mt-3 h-12 w-full border border-slate-200 bg-slate-50 text-slate-800"
          >
            {bootstrapping ? "Đang khởi tạo..." : "Khởi tạo Super Admin (lần đầu)"}
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            Sau khi vào app, vào <strong>Cài đặt</strong> để đổi mật khẩu.
            Trên điện thoại: Add to Home Screen để dùng như app.
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
