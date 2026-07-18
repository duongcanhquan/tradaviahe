'use client';

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { homePathForRole } from "@/lib/roles";

function LoginForm() {
  const { login, user, role, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    const next = searchParams.get("next");
    router.replace(next || homePathForRole(role));
  }, [authLoading, role, router, searchParams, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email.trim(), password);
      showToast("Đăng nhập thành công", "success");
      router.replace("/");
    } catch (error) {
      console.error(error);
      showToast("Email hoặc mật khẩu không đúng", "error");
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
            Bán hàng, chốt ca và đối chiếu dòng tiền cho nhóm 4 cổ đông.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[28px] bg-white p-5 shadow-2xl shadow-brand-900/30"
        >
          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input"
              placeholder="you@email.com"
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
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="touch-btn h-14 w-full bg-brand-700 text-white"
          >
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            Dùng trên điện thoại: sau khi đăng nhập, chọn{" "}
            <strong>Add to Home Screen</strong> để chạy như app (ẩn thanh địa chỉ).
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
