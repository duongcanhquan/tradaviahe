import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";

/**
 * Config public của web app (cùng giá trị trên Vercel).
 * Dùng làm fallback khi .env.local / env Vercel thiếu — tránh projectId = undefined.
 */
const FALLBACK_CONFIG = {
  apiKey: "AIzaSyDX8sx2Y_wzKGib-LXH41SogrNLV7TovRY",
  authDomain: "tradaviahe-218ca.firebaseapp.com",
  projectId: "tradaviahe-218ca",
  storageBucket: "tradaviahe-218ca.firebasestorage.app",
  messagingSenderId: "705615903999",
  appId: "1:705615903999:web:8172803c8762cac92c20ca",
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || FALLBACK_CONFIG.apiKey,
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || FALLBACK_CONFIG.authDomain,
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || FALLBACK_CONFIG.projectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    FALLBACK_CONFIG.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    FALLBACK_CONFIG.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || FALLBACK_CONFIG.appId,
};

const CONFIG_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

export const missingFirebaseEnv = CONFIG_KEYS.filter((key) => !firebaseConfig[key]);
export const firebaseConfigReady = missingFirebaseEnv.length === 0;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

/**
 * Long polling: mạng VN / proxy / PWA hay chặn WebChannel của onSnapshot,
 * khiến mọi listener fail dù Auth vẫn đăng nhập được.
 */
let db;
try {
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
} catch {
  db = getFirestore(app);
}

export { app, auth, db, firebaseConfig };
