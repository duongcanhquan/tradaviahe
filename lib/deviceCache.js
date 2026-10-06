/** Nhớ dữ liệu trên máy để không đọc lại Firestore mỗi lần mở app. */
const PREFIX = "tradaviahe.cache.";
export const DEVICE_CACHE_TTL_MS = 8 * 60 * 60 * 1000;

export function readDeviceCache(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDeviceCache(key, rows) {
  const payload = { savedAt: Date.now(), rows: rows || [] };
  if (typeof window === "undefined") return payload;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(payload));
  } catch {
    /* bộ nhớ máy đầy — vẫn dùng bản trong RAM */
  }
  return payload;
}

export function cacheIsFresh(entry, ttl = DEVICE_CACHE_TTL_MS) {
  if (!entry?.savedAt) return false;
  return Date.now() - entry.savedAt < ttl;
}
