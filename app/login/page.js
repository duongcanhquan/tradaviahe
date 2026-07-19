'use client';

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  ensureDefaultSuperAdmin,
  loginAsDefaultSuperAdmin,
  SUPERADMIN_DEFAULT_PASSWORD,
  SUPERADMIN_USERNAME,
} from "@/lib/bootstrap";
import { homePathForRole } from "@/lib/roles";

function friendlyAuthError(error) {
  const code = error?.code || "";
  const msg = String(error?.message || "");

  if (
    msg.includes("Nhập tên đăng nhập") ||
    msg.includes("không gõ email") ||
    msg.includes("chữ không dấu")
  ) {
    return msg;
  }

  if (
    code === "auth/user-not-found" ||
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-login-credentials" ||
    code === "auth/invalid-email"
  ) {
    return "Sai tên hoặc mật khẩu. Thử canhquan / canhquan, hoặc bấm “Vào Super Admin”.";
  }

  if (code === "auth/too-many-requests") {
    return "Thử quá nhiều lần — đợi vài phút rồi thử lại.";
  }

  if (code === "permission-denied" || msg.includes("permission")) {
    return "Firestore chặn ghi dữ liệu. Kiểm tra Rules cho phép user đã login ghi users/.";
  }

  // Không hiện lỗi Firebase kiểu “email…” ra UI
  return "Không đăng nhập được. Dùng tên tài khoản (không cần email), hoặc bấm “Vào Super Admin”.";
}

function LoginForm() {
  const { login, user, role, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState(SUPERADMIN_USERNAME);
  const [password, setPassword] = useState(SUPERADMIN_DEFAULT_PASSWORD);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    const next = searchParams.get("next");
    router.replace(next || homePathForRole(role));
  }, [authLoading, role, router, searchParams, user]);

  const goHome = () => {
    showToast("Đăng nhập thành công", "success");
    router.replace(searchParams.get("next") || "/");
  };

  const handleBootstrap = async () => {
    setBootstrapping(true);
    try {
      const result = await ensureDefaultSuperAdmin();
      if (result.created || result.reason === "created") {
        showToast("Đã tạo Super Admin — đang đăng nhập…", "success");
        setIdentifier(SUPERADMIN_USERNAME);
        setPassword(SUPERADMIN_DEFAULT_PASSWORD);
        await login(SUPERADMIN_USERNAME, SUPERADMIN_DEFAULT_PASSWORD);
        goHome();
        return;
      }
      if (result.reason === "already_exists") {
        showToast("Super Admin đã sẵn sàng — đăng nhập canhquan / canhquan", "info");
        setIdentifier(SUPERADMIN_USERNAME);
        setPassword(SUPERADMIN_DEFAULT_PASSWORD);
      } else if (result.reason === "auth_exists_login") {
        showToast(
          result.message ||
            "Tài khoản canhquan đã có — nhập mật khẩu hiện tại (hoặc mật khẩu mặc định canhquan)",
          "info"
        );
        setIdentifier(SUPERADMIN_USERNAME);
      }
    } catch (error) {
      console.error(error);
      showToast(friendlyAuthError(error), "error");
    } finally {
      setBootstrapping(false);
    }
  };

  /** Một chạm: tạo (nếu cần) + đăng nhập Super Admin */
  const handleQuickSuperAdmin = async () => {
    setBootstrapping(true);
    try {
      await loginAsDefaultSuperAdmin();
      setIdentifier(SUPERADMIN_USERNAME);
      setPassword(SUPERADMIN_DEFAULT_PASSWORD);
      goHome();
    } catch (error) {
      console.error(error);
      // Mật khẩu đã đổi — thử form thường / khởi tạo
      if (
        error?.code === "auth/wrong-password" ||
        error?.code === "auth/invalid-credential" ||
        error?.code === "auth/invalid-login-credentials"
      ) {
        showToast(
          "Mật khẩu Super Admin đã đổi. Nhập tên canhquan + mật khẩu hiện tại.",
          "info"
        );
        setIdentifier(SUPERADMIN_USERNAME);
        setPassword("");
      } else {
        showToast(friendlyAuthError(error), "error");
      }
    } finally {
      setBootstrapping(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const name = identifier.trim();
      // Super Admin: tự bootstrap nhẹ trước khi login
      if (name.toLowerCase() === SUPERADMIN_USERNAME) {
        try {
          await ensureDefaultSuperAdmin();
        } catch {
          // bỏ qua — vẫn thử login
        }
      }

      await login(name, password);
      goHome();
    } catch (error) {
      console.error(error);
      showToast(friendlyAuthError(error), "error");
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
          <p className="mt-3 max-w-sm text-sm text-blue-100">
            Đăng nhập bằng <strong>tên tài khoản</strong> — không cần email.
            <br />
            Super Admin: <strong>canhquan</strong> / <strong>canhquan</strong>
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[28px] bg-white p-5 shadow-2xl shadow-brand-900/30"
          autoComplete="on"
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
              value={identifier}
              onChange={(e) => {
                // Chặn @ — chỉ giữ tên
                const v = e.target.value.replace(/@.*/g, "").replace(/\s/g, "");
                setIdentifier(v);
              }}
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
              name="password"
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
            disabled={loading || bootstrapping}
            className="touch-btn h-14 w-full bg-brand-700 text-white"
          >
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>

          <button
            type="button"
            disabled={loading || bootstrapping}
            onClick={handleQuickSuperAdmin}
            className="touch-btn mt-3 h-14 w-full bg-emerald-600 text-white"
          >
            {bootstrapping ? "Đang xử lý..." : "Vào Super Admin (canhquan)"}
          </button>

          <button
            type="button"
            disabled={loading || bootstrapping}
            onClick={handleBootstrap}
            className="touch-btn mt-3 h-12 w-full border border-slate-200 bg-slate-50 text-slate-800"
          >
            Khởi tạo lại Super Admin
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            Chỉ gõ <strong>canhquan</strong> — đừng gõ email.
            Nếu lần đầu, bấm nút xanh <strong>Vào Super Admin</strong>.
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
