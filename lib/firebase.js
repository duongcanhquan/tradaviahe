import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const CONFIG_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

/** Biến môi trường Firebase còn thiếu (dev local thường quên copy .env.local). */
export const missingFirebaseEnv = CONFIG_KEYS.filter((key) => !firebaseConfig[key]);

/** true khi đủ cấu hình để khởi tạo Firebase. */
export const firebaseConfigReady = missingFirebaseEnv.length === 0;

if (typeof window !== "undefined" && !firebaseConfigReady) {
  console.error(
    "[Trà Đá App] Thiếu biến Firebase:",
    missingFirebaseEnv.join(", "),
    "— copy .env.example → .env.local rồi chạy lại npm run dev."
  );
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/**
 * Firebase Web mặc định dùng local persistence trong trình duyệt.
 * Không gọi setPersistence ở mỗi lần tải app để tránh thêm một tác vụ IndexedDB
 * cạnh tranh với lúc khôi phục phiên / đăng nhập.
 */

export { app, auth, db, firebaseConfig };
