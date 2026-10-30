import type { Metadata } from "next";
import { RecordsView } from "./RecordsView";

export const metadata: Metadata = { title: "내 기록 | 지식와 도전" };

export default function RecordsPage() {
  return <RecordsView />;
}
