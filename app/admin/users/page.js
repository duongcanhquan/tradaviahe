'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  BottomSheet,
  ChipRow,
  EmptyState,
  FieldLabel,
  FilterChip,
  SectionHeader,
} from "@/components/ui/MobileUI";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { defaultPasswordForUsername } from "@/lib/authIdentity";
import {
  createManagedUser,
  deleteManagedUser,
  resetAllManagedPasswords,
  resetManagedUserPassword,
  subscribeUsers,
  syncLoginIndexes,
  updateManagedUser,
} from "@/lib/users";
import {
  assignableRolesFor,
  canEditTargetUser,
  quickAddRolesFor,
  roleLabel,
} from "@/lib/roles";
import { cn } from "@/lib/utils";

const emptyForm = {
  name: "",
  username: "",
  password: "",
  role: "employee",
  phone: "",
  note: "",
};

function roleBadgeClass(role) {
  if (role === "superadmin") return "bg-brand-50 text-brand-900 ring-1 ring-brand-200";
  if (role === "manager") return "bg-brand-50 text-brand-800 ring-1 ring-brand-100";
  if (role === "employee") return "bg-slate-100 text-slate-800 ring-1 ring-slate-200";
  if (role === "investor") return "bg-slate-50 text-slate-800 ring-1 ring-slate-200";
  return "bg-slate-100 text-slate-700";
}

function PasswordReveal({ value }) {
  const [show, setShow] = useState(false);
  if (!value) {
    return <span className="text-slate-400">Chưa lưu MK</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm">
      <span className="max-w-[140px] truncate">{show ? value : "••••••••"}</span>
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="touch-btn inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 p-0 text-slate-600"
        aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  );
}

function AdminUsersContent() {
  const {
    user,
    profile,
    role: actorRole,
    isSuperAdmin,
    canManageUsers,
    canManageProducts,
  } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [resettingId, setResettingId] = useState(null);
  const [resettingAll, setResettingAll] = useState(false);
  const [syncingLogin, setSyncingLogin] = useState(false);

  const roleOptions = useMemo(
    () => assignableRolesFor(actorRole),
    [actorRole]
  );
  const quickAdds = useMemo(() => quickAddRolesFor(actorRole), [actorRole]);

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

  /** Quản lý chỉ thấy nhân viên; Chủ ĐT/SA thấy theo quyền sửa */
  const visibleUsers = useMemo(() => {
    return users.filter((u) => canEditTargetUser(actorRole, u.role) || (u.uid || u.id) === user?.uid);
  }, [actorRole, user?.uid, users]);

  const filtered = useMemo(() => {
    if (filter === "all") return visibleUsers;
    return visibleUsers.filter((u) => u.role === filter);
  }, [filter, visibleUsers]);

  const counts = useMemo(
    () => ({
      all: visibleUsers.length,
      superadmin: visibleUsers.filter((u) => u.role === "superadmin").length,
      manager: visibleUsers.filter((u) => u.role === "manager").length,
      employee: visibleUsers.filter((u) => u.role === "employee").length,
      investor: visibleUsers.filter((u) => u.role === "investor").length,
    }),
    [visibleUsers]
  );

  const openCreate = (role = "employee") => {
    const allowed = roleOptions.some((r) => r.value === role)
      ? role
      : roleOptions[0]?.value || "employee";
    setEditing(null);
    setForm({ ...emptyForm, role: allowed });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      username: row.username || row.email?.split("@")[0] || "",
      password: row.password || "",
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
      (!form.username.trim() || !form.password || form.password.length < 6)
    ) {
      showToast("Tên đăng nhập và mật khẩu (≥6 ký tự) bắt buộc", "error");
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
            { currentUserId: user.uid, users, actorRole }
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
            { currentUserId: user.uid, users, actorRole }
          );
        }
        showToast("Đã cập nhật người dùng", "success");
      } else {
        await createManagedUser({
          username: form.username,
          password: form.password,
          name: form.name,
          role: form.role,
          phone: form.phone,
          note: form.note,
          createdBy: user.uid,
          actorRole,
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
        showToast("Tên đăng nhập đã tồn tại trên Auth", "error");
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
    const label = row.name || row.username || row.email;
    const ok = window.confirm(`Xóa "${label}" khỏi hệ thống?`);
    if (!ok) return;

    setDeletingId(id);
    try {
      await deleteManagedUser(id, {
        users,
        currentUserId: user.uid,
        actorRole,
      });
      showToast("Đã xóa người dùng", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetOne = async (row) => {
    if (!canManageUsers) return;
    const id = row.uid || row.id;
    const username = row.username || row.email?.split("@")[0] || "";
    const next = defaultPasswordForUsername(username);
    const ok = window.confirm(
      `Reset mật khẩu của "${row.name || username}" về "${next}"?`
    );
    if (!ok) return;

    setResettingId(id);
    try {
      await resetManagedUserPassword(id, next, { users, actorRole });
      showToast(`Đã reset MK → ${next}`, "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Reset mật khẩu thất bại", "error");
    } finally {
      setResettingId(null);
    }
  };

  const handleSyncLoginIndex = async () => {
    setSyncingLogin(true);
    try {
      const count = await syncLoginIndexes(users);
      showToast(
        `Đã đồng bộ ${count} tên đăng nhập — quản lý đăng nhập bằng tên, không cần email`,
        "success"
      );
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Đồng bộ thất bại", "error");
    } finally {
      setSyncingLogin(false);
    }
  };

  const handleResetAll = async () => {
    if (!canManageUsers) return;
    const ok = window.confirm(
      `Reset mật khẩu TẤT CẢ ${users.length} tài khoản về tên đăng nhập (hoặc tên+số nếu <6 ký tự)?\nKhông thể hoàn tác.`
    );
    if (!ok) return;

    setResettingAll(true);
    try {
      const result = await resetAllManagedPasswords({ users, actorRole });
      if (result.failed.length === 0) {
        showToast(`Đã reset ${result.ok.length} mật khẩu`, "success");
      } else {
        showToast(
          `OK ${result.ok.length}, lỗi ${result.failed.length}: ${result.failed[0]?.reason || ""}`,
          "error"
        );
      }
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Reset tất cả thất bại", "error");
    } finally {
      setResettingAll(false);
    }
  };

  const pageTitle = canManageUsers
    ? "Admin"
    : actorRole === "manager"
      ? "Nhân viên"
      : "Người dùng";
  const pageSubtitle = canManageUsers
    ? "Admin · Phân quyền · Xem/reset mật khẩu"
    : actorRole === "manager"
      ? "Thêm · Sửa · Xóa nhân viên"
      : "Quản lý toàn hệ thống";

  const filterTabs = [
    { key: "all", label: "Tất cả", count: counts.all },
    ...(canManageUsers
      ? [{ key: "superadmin", label: "Super", count: counts.superadmin }]
      : []),
    ...(canManageUsers || actorRole === "investor"
      ? [
          { key: "manager", label: "Quản lý", count: counts.manager },
          { key: "investor", label: "Chủ ĐT", count: counts.investor },
        ]
      : []),
    { key: "employee", label: "Nhân viên", count: counts.employee },
  ];

  return (
    <AppShell title={pageTitle} subtitle={pageSubtitle}>
      <div className="space-y-4">
      {isSuperAdmin ? (
        <p className="text-sm leading-snug text-slate-500">
          {profile?.name || profile?.username} — xem / reset mật khẩu từng người hoặc tất cả.
        </p>
      ) : actorRole === "investor" ? (
        <p className="text-sm leading-snug text-slate-500">
          Cổ đông — xem sổ vốn, cổ tức, món giá, người dùng và vận hành quán.
        </p>
      ) : actorRole === "manager" ? (
        <p className="text-sm leading-snug text-slate-500">
          Quản lý — setup món/giá, POS, nhân viên, tồn kho · không xem cổ tức.
        </p>
      ) : null}

      {canManageProducts ? (
        <Link
          href="/admin/products"
          className="touch-btn h-14 w-full gap-2 bg-brand-700 text-white"
        >
          <Package className="h-5 w-5" />
          Setup món & giá để bán
        </Link>
      ) : null}

      <button
        type="button"
        disabled={syncingLogin || users.length === 0}
        onClick={handleSyncLoginIndex}
        className="touch-btn h-12 w-full gap-2 border border-sky-200 bg-sky-50 text-sky-900 disabled:opacity-40"
      >
        <RefreshCw className={cn("h-5 w-5", syncingLogin && "animate-spin")} />
        {syncingLogin
          ? "Đang đồng bộ..."
          : "Đồng bộ đăng nhập bằng tên"}
      </button>

      {canManageUsers ? (
        <button
          type="button"
          disabled={resettingAll || users.length === 0}
          onClick={handleResetAll}
          className="touch-btn h-12 w-full gap-2 border border-rose-200 bg-rose-50 text-rose-800 disabled:opacity-40"
        >
          <RefreshCw className={cn("h-5 w-5", resettingAll && "animate-spin")} />
          {resettingAll ? "Đang reset tất cả..." : "Reset tất cả mật khẩu"}
        </button>
      ) : null}

      <ChipRow>
        {filterTabs.map((item) => (
          <FilterChip
            key={item.key}
            active={filter === item.key}
            onClick={() => setFilter(item.key)}
          >
            {item.label} ({item.count})
          </FilterChip>
        ))}
      </ChipRow>

      <section className="space-y-2">
        <SectionHeader title="Thêm nhanh theo loại" />
        <div className="grid grid-cols-1 gap-2">
          {quickAdds.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => openCreate(item.value)}
              className="touch-btn h-14 w-full justify-start bg-brand-700 px-4 text-white"
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
        className="touch-btn h-12 w-full border border-slate-200 bg-white text-slate-800"
      >
        <Plus className="h-5 w-5" aria-hidden />
        Thêm người dùng khác
      </button>

      <section className="space-y-3">
        <SectionHeader title="Danh sách tài khoản" />
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-panel h-24 animate-pulse bg-slate-100" />
          ))
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Chưa có người dùng"
            description="Chưa có tài khoản trong nhóm lọc này."
            action={
              <button
                type="button"
                onClick={() => openCreate("employee")}
                className="touch-btn h-11 w-full bg-brand-700 text-sm font-bold text-white"
              >
                <Plus className="h-4 w-4" /> Thêm người dùng
              </button>
            }
          />
        ) : (
          filtered.map((row) => {
            const id = row.uid || row.id;
            const isSelf = id === user.uid;
            const isSA = row.role === "superadmin";
            const canEdit = canEditTargetUser(actorRole, row.role);
            const username = row.username || row.email?.split("@")[0] || "—";
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
                    <p className="truncate text-sm text-slate-500">
                      @{username}
                    </p>
                    {canManageUsers ? (
                      <div className="mt-1 flex items-center gap-2 text-slate-600">
                        <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <PasswordReveal value={row.password} />
                      </div>
                    ) : null}
                    {row.phone ? (
                      <p className="text-sm text-slate-400">{row.phone}</p>
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
                  <p className="text-sm text-slate-500">{row.note}</p>
                ) : null}

                <div
                  className={cn(
                    "grid gap-2",
                    canManageUsers ? "grid-cols-3" : "grid-cols-2"
                  )}
                >
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => openEdit(row)}
                    className="touch-btn h-12 gap-1 bg-slate-900 text-white disabled:opacity-40"
                  >
                    <Pencil className="h-4 w-4" />
                    Sửa
                  </button>
                  {canManageUsers ? (
                    <button
                      type="button"
                      disabled={resettingId === id}
                      onClick={() => handleResetOne(row)}
                      className="touch-btn h-12 gap-1 bg-brand-700 text-white disabled:opacity-40"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {resettingId === id ? "..." : "Reset MK"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      isSelf || isSA || !canEdit || deletingId === id
                    }
                    onClick={() => handleDelete(row)}
                    className="touch-btn h-12 gap-1 bg-rose-600 text-white disabled:opacity-40"
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
      </div>

      <BottomSheet
        open={modalOpen}
        onClose={() => closeModal()}
        title={editing ? "Sửa người dùng" : `Thêm ${roleLabel(form.role)}`}
        labelledBy="admin-users-sheet"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => closeModal()}
              disabled={saving}
              className="touch-btn h-12 flex-1 border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
            >
              Hủy
            </button>
            <button
              type="submit"
              form="admin-users-form"
              disabled={saving}
              className="touch-btn h-12 flex-[1.4] bg-brand-700 text-white disabled:opacity-50"
            >
              {saving
                ? "Đang lưu..."
                : editing
                  ? "Lưu thay đổi"
                  : "Tạo tài khoản"}
            </button>
          </div>
        }
      >
        <form id="admin-users-form" onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <FieldLabel>Họ tên</FieldLabel>
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
            <div className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-brand-100">
              Vai trò: <strong>Super Admin</strong> (không đổi được)
            </div>
          ) : (
            <div>
              <FieldLabel>Vai trò / quyền</FieldLabel>
              <div className="space-y-2">
                {roleOptions.map((opt) => (
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
                    <p className="mt-0.5 text-sm text-slate-500">
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
                <FieldLabel>Tên đăng nhập</FieldLabel>
                <input
                  type="text"
                  required
                  autoComplete="off"
                  className="field-input"
                  value={form.username}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, username: e.target.value }))
                  }
                  placeholder="vd: nhanvien1"
                />
              </label>
              <label className="block">
                <FieldLabel>Mật khẩu</FieldLabel>
                <input
                  type="text"
                  required
                  minLength={6}
                  autoComplete="new-password"
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
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p>
                Tên đăng nhập:{" "}
                <strong className="text-slate-900">@{form.username}</strong>
              </p>
              {canManageUsers ? (
                <>
                  <p className="mt-1">
                    Mật khẩu:{" "}
                    <strong className="font-mono text-slate-900">
                      {form.password || "—"}
                    </strong>
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    Dùng nút Reset MK trên danh sách để đặt lại mật khẩu.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  Chỉ Super Admin xem/reset được mật khẩu.
                </p>
              )}
            </div>
          )}

          <label className="block">
            <FieldLabel optional>Số điện thoại</FieldLabel>
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
            <FieldLabel optional>Ghi chú</FieldLabel>
            <input
              className="field-input"
              value={form.note}
              onChange={(e) =>
                setForm((f) => ({ ...f, note: e.target.value }))
              }
              placeholder="VD: ca tối, cổ đông 25%..."
            />
          </label>
        </form>
      </BottomSheet>
    </AppShell>
  );
}

export default function AdminUsersPage() {
  return (
    <ProtectedRoute allowRoles={["superadmin", "investor", "manager"]}>
      <AdminUsersContent />
    </ProtectedRoute>
  );
}
