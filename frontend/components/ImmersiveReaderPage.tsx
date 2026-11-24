"use client";

import AccountShell from "@/components/AccountShell";
import ImmersiveReader from "@/components/ImmersiveReader";

export default function ImmersiveReaderPage({ bookId }: { bookId: string }) {
  const id = Number(bookId);
  return (
    <AccountShell title="مطالعهٔ غوطه‌ور" subtitle="نمایشگر صفحه‌ها و فهرست کتاب کنار گفتگوی مستند به متن کتاب.">
      {Number.isInteger(id) && id > 0 ? (
        <ImmersiveReader bookId={id} />
      ) : (
        <div className="glass-panel" style={{ padding: 24 }}>شناسهٔ کتاب معتبر نیست.</div>
      )}
    </AccountShell>
  );
}
