/** Cấu hình mặc định tài khoản chung quán (VietQR). */
export const DEFAULT_BANK = {
  bankBin: "970436", // Vietcombank
  accountNumber: "0987654321",
  accountName: "QUAN_TRA_DA",
  bankName: "Vietcombank",
};

export function normalizeBank(partial = {}) {
  return {
    bankBin: String(partial.bankBin || DEFAULT_BANK.bankBin).trim(),
    accountNumber: String(
      partial.accountNumber || DEFAULT_BANK.accountNumber
    ).trim(),
    accountName: String(partial.accountName || DEFAULT_BANK.accountName)
      .trim()
      .replace(/\s+/g, "_"),
    bankName: String(partial.bankName || DEFAULT_BANK.bankName).trim(),
  };
}

/**
 * URL ảnh VietQR — amount tuỳ chọn (để trống = QR tài khoản chung).
 */
export function buildVietQrUrl({
  bankBin,
  accountNumber,
  accountName,
  amount,
  addInfo,
}) {
  const bank = normalizeBank({ bankBin, accountNumber, accountName });
  const base = `https://api.vietqr.io/image/${bank.bankBin}-${bank.accountNumber}-compact2.jpg`;
  const params = new URLSearchParams();
  params.set("accountName", bank.accountName);
  if (amount && Number(amount) > 0) {
    params.set("amount", String(Math.round(Number(amount))));
  }
  if (addInfo) {
    params.set("addInfo", String(addInfo));
  }
  return `${base}?${params.toString()}`;
}
