import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { subscribeDocument } from "./liveCollection";
import { DEFAULT_BANK, normalizeBank } from "./bank";

export const GLOBAL_SETTINGS_ID = "global";
export const DEFAULT_RELATION_FUND_PERCENT = 5;

export function getSettingsRef() {
  return doc(db, "settings", GLOBAL_SETTINGS_ID);
}

function parseSettings(data = {}) {
  return {
    relationFundPercent:
      Number(data.relationFundPercent) >= 0
        ? Number(data.relationFundPercent)
        : DEFAULT_RELATION_FUND_PERCENT,
    bank: normalizeBank({
      bankBin: data.bankBin,
      accountNumber: data.accountNumber,
      accountName: data.accountName,
      bankName: data.bankName,
    }),
  };
}

export async function fetchGlobalSettings() {
  const snap = await getDoc(getSettingsRef());
  if (!snap.exists()) {
    return parseSettings({
      relationFundPercent: DEFAULT_RELATION_FUND_PERCENT,
      ...DEFAULT_BANK,
    });
  }
  return parseSettings(snap.data());
}

export async function saveRelationFundPercent(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  await setDoc(
    getSettingsRef(),
    {
      relationFundPercent: value,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return value;
}

export async function saveBankAccount(bankInput) {
  const bank = normalizeBank(bankInput);
  await setDoc(
    getSettingsRef(),
    {
      bankBin: bank.bankBin,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      bankName: bank.bankName,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return bank;
}

export function subscribeGlobalSettings(callback, onError) {
  return subscribeDocument(
    getSettingsRef(),
    (snap) => {
      if (!snap.exists()) {
        callback(
          parseSettings({
            relationFundPercent: DEFAULT_RELATION_FUND_PERCENT,
            ...DEFAULT_BANK,
          })
        );
        return;
      }
      callback(parseSettings(snap.data()));
    },
    onError
  );
}
