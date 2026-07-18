export const ROLES = {
  manager: "manager",
  employee: "employee",
  investor: "investor",
};

export const ROLE_LABELS = {
  manager: "Quản lý",
  employee: "Nhân viên",
  investor: "Chủ đầu tư",
};

export const ROLE_OPTIONS = [
  { value: "manager", label: "Quản lý" },
  { value: "employee", label: "Nhân viên" },
  { value: "investor", label: "Chủ đầu tư (theo dõi)" },
];

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "—";
}

/** Quản lý có quyền admin (CRUD người dùng) */
export function canManageUsers(role) {
  return role === "manager";
}

/** Nhân viên / quản lý được bán hàng & chốt ca */
export function canOperateShop(role) {
  return role === "manager" || role === "employee";
}

/** Quản lý / chủ đầu tư xem dashboard tài chính */
export function canViewDashboard(role) {
  return role === "manager" || role === "investor";
}

export function homePathForRole(role) {
  if (role === "investor") return "/dashboard";
  if (role === "employee") return "/manager/pos";
  return "/manager/pos";
}
