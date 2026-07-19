import { doc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const AUTH_EMAIL_DOMAIN = "tradaviahe.app";
export const LOGIN_INDEX_COLLECTION = "login_index";

/** Tài khoản Super Admin mặc định */
export const SUPERADMIN_USERNAME = "canhquan";
export const SUPERADMIN_DEFAULT_PASSWORD = "canhquan";
export const SUPERADMIN_NAME = "Canh Quan";

/** Chuẩn hoá tên đăng nhập */
export function normalizeUsername(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * Firebase Auth cần chuỗi dạng email phía sau.
 * User chỉ gõ tên — app tự ghép (không hiện trên UI).
 */
export function usernameToEmail(username) {
  const u = normalizeUsername(username);
  if (!u) return "";
  return `${u}@${AUTH_EMAIL_DOMAIN}`;
}

export const SUPERADMIN_EMAIL = usernameToEmail(SUPERADMIN_USERNAME);

export function validateUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return "Nhập tên đăng nhập";
  if (u.includes("@")) return "Chỉ dùng tên đăng nhập";
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) {
    return "Tên 3–32 ký tự: a-z, 0-9, . _ - (không dấu)";
  }
  return null;
}

export function defaultPasswordForUsername(username) {
  const u = normalizeUsername(username);
  if (u.length >= 6) return u;
  return `${u}123456`.slice(0, Math.max(6, u.length));
}

/** Bỏ phần @... nếu user dán nhầm */
export function extractUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const local = raw.includes("@") ? raw.split("@")[0] : raw;
  return normalizeUsername(local);
}

/**
 * Đồng bộ: tên → email Auth nội bộ.
 * Không đọc Firestore (tránh chặn khi chưa login).
 */
export function resolveLoginIdentifier(input) {
  const username = extractUsername(input);
  if (!username) {
    throw new Error("Nhập tên đăng nhập");
  }
  return usernameToEmail(username);
}

export async function writeLoginIndex({ username, email, uid }) {
  const u = normalizeUsername(username);
  if (!u || !email) return;
  await setDoc(
    doc(db, LOGIN_INDEX_COLLECTION, u),
    {
      username: u,
      email: String(email).toLowerCase(),
      uid: uid || null,
    },
    { merge: true }
  );
}
