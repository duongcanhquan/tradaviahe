import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const AUTH_EMAIL_DOMAIN = "tradaviahe.app";
export const LOGIN_INDEX_COLLECTION = "login_index";

/** Ghi map username → email Auth (để đăng nhập bằng tên, không cần email) */
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

/**
 * Firebase Auth bắt buộc identifier dạng email phía sau.
 * Người dùng chỉ gõ tên — app tự ghép domain nội bộ (không hiện ra UI).
 */
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

/**
 * Lấy phần tên từ input (bỏ @domain nếu user dán nhầm).
 */
export function extractUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) {
    return normalizeUsername(raw.split("@")[0]);
  }
  return normalizeUsername(raw);
}

/**
 * Đăng nhập bằng tên tài khoản.
 * Ưu tiên email nội bộ tên@tradaviahe.app (ổn định, không cần Firestore).
 * login_index chỉ dùng khi có (tài khoản cũ).
 */
export async function resolveLoginIdentifier(input) {
  const username = extractUsername(input);
  if (!username) {
    throw new Error("Nhập tên đăng nhập");
  }
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error(
      "Tên đăng nhập chỉ gồm chữ không dấu, số, . _ - (không gõ email)"
    );
  }

  // Super Admin: luôn dùng email nội bộ cố định — không phụ thuộc index
  if (username === SUPERADMIN_USERNAME) {
    return SUPERADMIN_EMAIL;
  }

  const synthetic = usernameToEmail(username);

  try {
    const snap = await getDoc(doc(db, LOGIN_INDEX_COLLECTION, username));
    if (snap.exists()) {
      const email = snap.data()?.email;
      if (email) return String(email).toLowerCase();
    }
  } catch {
    // rules chặn khi chưa login — bỏ qua
  }

  return synthetic;
}
