import type { Metadata } from "next";
import { BridgeExperience } from "./components/BridgeExperience";

export const metadata: Metadata = {
  // Provider, mode, and activity-tab query parameters share this landing page.
  alternates: { canonical: "/" },
  robots: { "max-image-preview": "large" },
};

export default function Home() {
  return <BridgeExperience />;
}
