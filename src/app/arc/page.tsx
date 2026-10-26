import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  // This shortcut opens the landing page with the Arc receive flow selected.
  alternates: { canonical: "/" },
};

export default function ArcPage() {
  redirect("/?provider=xreserve&mode=receive");
}
