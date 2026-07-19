/**
 * Ghi nhớ đăng nhập trên máy (máy tính tiền / điện thoại nhân viên).
 * Firebase Auth vẫn giữ phiên; đây là lớp dự phòng khi phiên hết hạn.
 */

const DEVICE_LOGIN_KEY = "tradaviahe.deviceLogin";
const LAST_USERNAME_KEY = "tradaviahe.lastUsername";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function saveDeviceLogin({ username, password }) {
  if (!canUseStorage()) return;
  const clean = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/@.*/g, "")
    .replace(/\s/g, "");
  if (!clean || !password) return;

  localStorage.setItem(LAST_USERNAME_KEY, clean);
  localStorage.setItem(
    DEVICE_LOGIN_KEY,
    JSON.stringify({
      username: clean,
      password: String(password),
      savedAt: Date.now(),
    })
  );
}

export function loadDeviceLogin() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(DEVICE_LOGIN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.username || !data?.password) return null;
    return {
      username: String(data.username),
      password: String(data.password),
      savedAt: Number(data.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function clearDeviceLogin() {
  if (!canUseStorage()) return;
  localStorage.removeItem(DEVICE_LOGIN_KEY);
}

export function peekSavedUsername() {
  if (!canUseStorage()) return "";
  const saved = loadDeviceLogin();
  if (saved?.username) return saved.username;
  return localStorage.getItem(LAST_USERNAME_KEY) || "";
}

export function rememberLastUsername(username) {
  if (!canUseStorage()) return;
  const clean = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/@.*/g, "")
    .replace(/\s/g, "");
  if (clean) localStorage.setItem(LAST_USERNAME_KEY, clean);
}
