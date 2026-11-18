import type { Metadata } from "next";
import { RecoveryPage } from "../components/recovery/RecoveryPage";

export const metadata: Metadata = {
  title: "Recover Epoch deposits | Miden Bridge",
  alternates: { canonical: "/recovery" },
};

export default function Recovery() {
  return <RecoveryPage />;
}
