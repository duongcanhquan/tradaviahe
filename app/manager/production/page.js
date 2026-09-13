"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Pha mẻ đã bỏ — chuyển về món / công thức. */
export default function ProductionRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/manager/products");
  }, [router]);
  return null;
}
