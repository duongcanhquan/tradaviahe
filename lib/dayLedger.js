import { parseRangeBound, presetRange } from "./dateRange";
import {
  readTransactionsInRange,
  readTransactionsSince,
} from "./liveCollection";

const KEY = "tradaviahe.doisoat.day.v1";

function readStore() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "");
    if (!parsed || parsed.day == null || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(entry) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* bộ nhớ máy đầy */
  }
}

function packRow(row) {
  const ms = row?.timestamp?.toMillis?.() || Number(row?.timestampMs) || 0;
  const out = { id: row.id, timestampMs: ms };
  for (const [key, value] of Object.entries(row || {})) {
    if (key === "id" || key === "timestamp" || key === "timestampMs") continue;
    if (value && typeof value.toMillis === "function") continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function hydrate(row) {
  const ms = Number(row?.timestampMs) || 0;
  return {
    ...row,
    timestamp: { toMillis: () => ms },
  };
}

export function peekDoisoatToday() {
  const { from } = presetRange("day");
  const stored = readStore();
  if (!stored || stored.day !== from) return [];
  return stored.rows.map(hydrate);
}

export function dropDoisoatTx(id) {
  const stored = readStore();
  if (!stored || !id) return;
  writeStore({
    ...stored,
    rows: stored.rows.filter((row) => row.id !== id),
  });
}

/** Hôm nay: lần đầu đọc cả ngày, lần sau chỉ phiếu mới hơn mốc đã nhớ. */
export async function loadDoisoatToday() {
  const { from, to } = presetRange("day");
  const endMs = parseRangeBound(to, true);
  const stored = readStore();
  const sameDay = stored?.day === from && Array.isArray(stored.rows);

  if (sameDay && Number(stored.cursorMs) > 0) {
    const fresh = await readTransactionsSince(stored.cursorMs, endMs, 400);
    const byId = new Map(stored.rows.map((row) => [row.id, row]));
    for (const row of fresh) byId.set(row.id, packRow(row));
    const rows = [...byId.values()];
    const cursorMs = rows.reduce(
      (max, row) => Math.max(max, Number(row.timestampMs) || 0),
      Number(stored.cursorMs) || 0
    );
    writeStore({ day: from, cursorMs, rows });
    return rows.map(hydrate);
  }

  const full = await readTransactionsInRange(from, to);
  const rows = full.map(packRow);
  const cursorMs =
    rows.reduce((max, row) => Math.max(max, row.timestampMs), 0) || Date.now();
  writeStore({ day: from, cursorMs, rows });
  return rows.map(hydrate);
}
