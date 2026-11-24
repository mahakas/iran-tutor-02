import type { Metadata } from "next";
import ImmersiveReaderPage from "@/components/ImmersiveReaderPage";

export const metadata: Metadata = {
  title: "مطالعهٔ غوطه‌ور | درسیار",
  robots: { index: false, follow: false },
};

export default async function StudyPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  return <ImmersiveReaderPage bookId={bookId} />;
}
