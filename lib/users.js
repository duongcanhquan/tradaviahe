import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Tạo user Auth bằng app phụ để không đăng xuất admin hiện tại,
 * rồi ghi hồ sơ vào collection users.
 */
export async function createManagedUser({
  email,
  password,
  name,
  role,
  phone = "",
  note = "",
  createdBy,
}) {
  const appName = `Secondary-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email.trim(),
      password
    );
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      uid,
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role,
      phone: phone.trim(),
      note: note.trim(),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: createdBy || null,
    });

    await signOut(secondaryAuth);
    return uid;
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function updateManagedUser(uid, data) {
  const payload = {
    updatedAt: serverTimestamp(),
  };
  if (data.name !== undefined) payload.name = String(data.name).trim();
  if (data.role !== undefined) payload.role = data.role;
  if (data.phone !== undefined) payload.phone = String(data.phone).trim();
  if (data.note !== undefined) payload.note = String(data.note).trim();
  if (data.active !== undefined) payload.active = Boolean(data.active);

  await updateDoc(doc(db, "users", uid), payload);
}

/**
 * Xóa hồ sơ Firestore.
 * Tài khoản Auth vẫn tồn tại trừ khi dùng Firebase Admin SDK.
 */
export async function deleteManagedUser(uid) {
  await deleteDoc(doc(db, "users", uid));
}

export function subscribeUsers(callback, onError) {
  return onSnapshot(
    collection(db, "users"),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) =>
          String(a.name || a.email || "").localeCompare(
            String(b.name || b.email || ""),
            "vi"
          )
        );
      callback(list);
    },
    onError
  );
}
