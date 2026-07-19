const AUTH_EMAIL_DOMAIN = "tradaviahe.app";

/** Tài khoản Super Admin mặc định */
export const SUPERADMIN_USERNAME = "canhquan";
export const SUPERADMIN_DEFAULT_PASSWORD = "canhquan";
export const SUPERADMIN_NAME = "Canh Quan";

/** Chuẩn hoá tên đăng nhập (không dùng email) */
export function normalizeUsername(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** Firebase Auth vẫn cần email nội bộ — không hiện cho người dùng */
export function usernameToEmail(username) {
  const u = normalizeUsername(username);
  return `${u}@${AUTH_EMAIL_DOMAIN}`;
}

export const SUPERADMIN_EMAIL = usernameToEmail(SUPERADMIN_USERNAME);

export function validateUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return "Nhập tên đăng nhập";
  if (u.includes("@")) return "Chỉ dùng tên đăng nhập, không dùng email";
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) {
    return "Tên đăng nhập 3–32 ký tự: a-z, 0-9, . _ -";
  }
  return null;
}

/** Mật khẩu mặc định khi admin reset (theo tên đăng nhập) */
export function defaultPasswordForUsername(username) {
  const u = normalizeUsername(username);
  if (u.length >= 6) return u;
  return `${u}123456`.slice(0, Math.max(6, u.length));
}

/** Đăng nhập chỉ bằng tên tài khoản → email nội bộ */
export function resolveLoginIdentifier(input) {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  if (raw.includes("@")) {
    throw new Error("Chỉ đăng nhập bằng tên tài khoản, không dùng email");
  }
  return usernameToEmail(raw);
}
