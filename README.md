# Trà Đá App (PWA)

Ứng dụng PWA quản lý bán hàng, tồn kho và đối chiếu dòng tiền cho quán trà đá (4 cổ đông).

## Tech stack
- Next.js 14 (App Router) + JavaScript
- Tailwind CSS (mobile-first)
- Firebase Auth + Firestore
- next-pwa, lucide-react, recharts, date-fns

## Chạy local
```bash
npm install
npm run dev
```

Mở http://localhost:3000

## Firebase setup
1. Bật Email/Password trong Authentication.
2. Tạo user trên Firebase Auth.
3. Tạo document `users/{uid}` với fields:
   - `uid`, `email`, `name`, `role` (`manager` | `investor`)
4. (Tuỳ chọn) Seed sản phẩm trong app: Cài đặt → Seed sản phẩm mẫu.
5. Rules Firestore tối thiểu cho dev (siết lại khi production):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Cho phép đọc map tên đăng nhập → Auth (trước khi login)
    match /login_index/{username} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Đăng nhập chỉ cần **tên tài khoản + mật khẩu** (không dùng email). App tạo email nội bộ `tên@tradaviahe.app` phía sau.

## Modules
- `/login` — Đăng nhập
- `/manager/pos` — Bán hàng + VietQR
- `/manager/inventory` — Kiểm kê & chốt ca
- `/dashboard` — Thu/Chi/Lợi nhuận + lịch sử chốt ca + biểu đồ
- `/settings` — Hồ sơ, seed data, ghi chi, đăng xuất

## PWA
Build production rồi cài Add to Home Screen:
```bash
npm run build && npm start
```
Manifest: `display: standalone`, `theme_color: #1e40af`.

## Webhook n8n (tuỳ chọn)
Thêm vào `.env.local`:
```
NEXT_PUBLIC_N8N_WEBHOOK_URL=https://your-n8n/webhook/...
```
