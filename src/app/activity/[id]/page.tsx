import type { Metadata } from "next";
import { ActivityDetail } from "../../components/ActivityDetail";

export const metadata: Metadata = {
  title: "Transfer activity | Miden Bridge",
  // Receipts live in the user's browser; there is no public transfer to index.
  robots: { index: false, follow: true },
};

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ActivityDetail id={id} />;
}
