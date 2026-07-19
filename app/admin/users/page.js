'use client';

import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  Crown,
  Pencil,
  Plus,
  Shield,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  createManagedUser,
  deleteManagedUser,
  subscribeUsers,
  updateManagedUser,
} from "@/lib/users";
import {
  QUICK_ADD_ROLES,
  ROLE_OPTIONS,
  roleLabel,
} from "@/lib/roles";
import { cn } from "@/lib/utils";

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "employee",
  phone: "",
  note: "",
};

function roleBadgeClass(role) {
  if (role === "superadmin") return "bg-violet-100 text-violet-900 ring-1 ring-violet-200";
  if (role === "manager") return "bg-brand-50 text-brand-800 ring-1 ring-brand-100";
  if (role === "employee") return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100";
  if (role === "investor") return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
  return "bg-slate-100 text-slate-700";
}

function AdminUsersContent() {
  const { user, profile, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    const unsub = subscribeUsers(
      (list) => {
        setUsers(list);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được danh sách người dùng", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const filtered = useMemo(() => {
    if (filter === "all") return users;
    return users.filter((u) => u.role === filter);
  }, [filter, users]);

  const counts = useMemo(
    () => ({
      all: users.length,
      superadmin: users.filter((u) => u.role === "superadmin").length,
      manager: users.filter((u) => u.role === "manager").length,
      employee: users.filter((u) => u.role === "employee").length,
      investor: users.filter((u) => u.role === "investor").length,
    }),
    [users]
  );

  const openCreate = (role = "employee") => {
    setEditing(null);
    setForm({ ...emptyForm, role });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      email: row.email || "",
      password: "",
      role: row.role === "superadmin" ? "superadmin" : row.role || "employee",
      phone: row.phone || "",
      note: row.note || "",
    });
    setModalOpen(true);
  };

  const closeModal = (force = false) => {
    if (saving && !force) return;
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("Nhập họ tên", "error");
      return;
    }
    if (
      !editing &&
      (!form.email.trim() || !form.password || form.password.length < 6)
    ) {
      showToast("Email và mật khẩu (≥6 ký tự) bắt buộc khi thêm mới", "error");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const id = editing.uid || editing.id;
        if (editing.role === "superadmin") {
          await updateManagedUser(
            id,
            {
              name: form.name,
              phone: form.phone,
              note: form.note,
            },
            { currentUserId: user.uid, users }
          );
        } else {
          await updateManagedUser(
            id,
            {
              name: form.name,
              role: form.role,
              phone: form.phone,
              note: form.note,
            },
            { currentUserId: user.uid, users }
          );
        }
        showToast("Đã cập nhật người dùng", "success");
      } else {
        await createManagedUser({
          email: form.email,
          password: form.password,
          name: form.name,
          role: form.role,
          phone: form.phone,
          note: form.note,
          createdBy: user.uid,
        });
        showToast(`Đã thêm ${roleLabel(form.role)}`, "success");
      }
      setSaving(false);
      closeModal(true);
    } catch (error) {
      console.error(error);
      const code = error?.code || "";
      const msg = error?.message || "";
      if (code === "auth/email-already-in-use") {
        showToast("Email đã tồn tại trên Auth", "error");
      } else if (code === "auth/invalid-email") {
        showToast("Email không hợp lệ", "error");
      } else if (code === "auth/weak-password") {
        showToast("Mật khẩu quá yếu", "error");
      } else if (msg) {
        showToast(msg, "error");
      } else {
        showToast(editing ? "Cập nhật thất bại" : "Thêm người dùng thất bại", "error");
      }
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    const id = row.uid || row.id;
    if (id === user.uid) {
      showToast("Không thể xóa chính bạn", "error");
      return;
    }
    if (row.role === "superadmin") {
      showToast("Không thể xóa Super Admin", "error");
      return;
    }
    const ok = window.confirm(
      `Xóa "${row.name || row.email}" khỏi hệ thống?\n(Hồ sơ Firestore sẽ bị xóa; tài khoản Auth có thể vẫn còn.)`
    );
    if (!ok) return;

    setDeletingId(id);
    try {
      await deleteManagedUser(id, { users, currentUserId: user.uid });
      showToast("Đã xóa người dùng", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell title="Admin" subtitle="Phân quyền · Nhân viên · Chủ đầu tư">
      {isSuperAdmin ? (
        <div className="card-panel mb-4 flex items-start gap-3 border-violet-200 bg-violet-50">
          <Crown className="mt-0.5 h-5 w-5 shrink-0 text-violet-700" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-bold text-violet-900">Bạn là Super Admin duy nhất</p>
            <p className="mt-1 text-violet-800/80">
              {profile?.name || profile?.email} — có toàn quyền thêm nhân viên,
              quản lý, chủ đầu tư. Không thể tạo thêm Super Admin khác.
            </p>
          </div>
        </div>
      ) : null}

      <section className="mb-4 grid grid-cols-2 gap-2">
        {[
          { key: "all", label: "Tất cả", count: counts.all },
          { key: "superadmin", label: "Super", count: counts.superadmin },
          { key: "manager", label: "Quản lý", count: counts.manager },
          { key: "employee", label: "Nhân viên", count: counts.employee },
          { key: "investor", label: "Chủ ĐT", count: counts.investor },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={cn(
              "card-panel flex min-h-14 cursor-pointer items-center justify-between gap-2 py-3 transition duration-200 active:scale-95",
              filter === item.key &&
                "border-brand-700 bg-brand-50 ring-2 ring-brand-700/20"
            )}
          >
            <span className="text-sm font-semibold">{item.label}</span>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
              {item.count}
            </span>
          </button>
        ))}
      </section>

      <section className="mb-4 space-y-2">
        <p className="text-sm font-semibold text-slate-700">Thêm nhanh theo loại</p>
        <div className="grid grid-cols-1 gap-2">
          {QUICK_ADD_ROLES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => openCreate(item.value)}
              className={cn(
                "touch-btn h-14 w-full justify-start px-4",
                item.tone === "emerald" && "bg-emerald-600 text-white",
                item.tone === "amber" && "bg-amber-600 text-white",
                item.tone === "brand" && "bg-brand-700 text-white"
              )}
            >
              {item.value === "employee" ? (
                <UserPlus className="h-5 w-5" aria-hidden />
              ) : item.value === "investor" ? (
                <Briefcase className="h-5 w-5" aria-hidden />
              ) : (
                <Shield className="h-5 w-5" aria-hidden />
              )}
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => openCreate("employee")}
        className="touch-btn mb-4 h-12 w-full border border-slate-200 bg-white text-slate-800"
      >
        <Plus className="h-5 w-5" aria-hidden />
        Thêm người dùng khác
      </button>

      <section className="space-y-3">
        <h2 className="section-title">Danh sách tài khoản</h2>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-panel h-24 animate-pulse bg-slate-100" />
          ))
        ) : filtered.length === 0 ? (
          <div className="card-panel flex flex-col items-center gap-2 py-10 text-slate-500">
            <Users className="h-8 w-8" />
            <p>Chưa có người dùng trong nhóm này</p>
          </div>
        ) : (
          filtered.map((row) => {
            const id = row.uid || row.id;
            const isSelf = id === user.uid;
            const isSA = row.role === "superadmin";
            return (
              <article key={id} className="card-panel space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">
                      {row.name || "Không tên"}
                      {isSelf ? (
                        <span className="ml-2 text-xs font-medium text-slate-400">
                          (bạn)
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-slate-500">{row.email}</p>
                    {row.phone ? (
                      <p className="text-xs text-slate-400">{row.phone}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "chip shrink-0",
                      roleBadgeClass(row.role)
                    )}
                  >
                    {isSA ? <Crown className="h-3.5 w-3.5" aria-hidden /> : null}
                    {roleLabel(row.role)}
                  </span>
                </div>

                {row.note ? (
                  <p className="text-xs text-slate-500">{row.note}</p>
                ) : null}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="touch-btn h-12 flex-1 gap-2 bg-slate-900 text-white"
                  >
                    <Pencil className="h-4 w-4" />
                    Sửa
                  </button>
                  <button
                    type="button"
                    disabled={isSelf || isSA || deletingId === id}
                    onClick={() => handleDelete(row)}
                    className="touch-btn h-12 flex-1 gap-2 bg-rose-600 text-white disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                    {deletingId === id ? "..." : "Xóa"}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-950/50 p-4 sm:items-center sm:justify-center">
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-brand-700" />
                <h2 className="text-lg font-bold">
                  {editing ? "Sửa người dùng" : `Thêm ${roleLabel(form.role)}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => closeModal()}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 transition active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Họ tên
                </span>
                <input
                  required
                  className="field-input"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="Nguyễn Văn A"
                />
              </label>

              {editing?.role === "superadmin" ? (
                <div className="rounded-2xl bg-violet-50 px-4 py-3 text-sm text-violet-900">
                  Vai trò: <strong>Super Admin</strong> (không đổi được)
                </div>
              ) : (
                <div>
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    Vai trò / quyền
                  </span>
                  <div className="space-y-2">
                    {ROLE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, role: opt.value }))
                        }
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99]",
                          form.role === opt.value
                            ? "border-brand-700 bg-brand-50 ring-2 ring-brand-700/20"
                            : "border-slate-200 bg-white"
                        )}
                      >
                        <p className="font-bold text-slate-900">{opt.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {opt.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!editing ? (
                <>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Email đăng nhập
                    </span>
                    <input
                      type="email"
                      required
                      className="field-input"
                      value={form.email}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, email: e.target.value }))
                      }
                      placeholder="email@example.com"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Mật khẩu tạm
                    </span>
                    <input
                      type="password"
                      required
                      minLength={6}
                      className="field-input"
                      value={form.password}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, password: e.target.value }))
                      }
                      placeholder="Tối thiểu 6 ký tự"
                    />
                  </label>
                </>
              ) : (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Email:{" "}
                  <strong className="text-slate-700">{form.email}</strong>
                  <br />
                  (Không đổi email / mật khẩu tại đây)
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Số điện thoại
                </span>
                <input
                  className="field-input"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  placeholder="09..."
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Ghi chú
                </span>
                <input
                  className="field-input"
                  value={form.note}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, note: e.target.value }))
                  }
                  placeholder="VD: ca tối, cổ đông 25%..."
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="touch-btn h-14 w-full bg-brand-700 text-white"
              >
                {saving
                  ? "Đang lưu..."
                  : editing
                    ? "Lưu thay đổi"
                    : "Tạo tài khoản"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function AdminUsersPage() {
  return (
    <ProtectedRoute allowRoles={["superadmin"]}>
      <AdminUsersContent />
    </ProtectedRoute>
  );
}
