import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Providers } from "./components/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://bridge.miden.xyz";
const SITE_DESCRIPTION =
  "Move value across Sepolia and Miden with wallet-native cross-chain receive and send flows.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Miden Bridge",
  description: SITE_DESCRIPTION,
  applicationName: "Miden Bridge",
  // Favicon is the Miden mark from src/app/icon.svg (Next file-based metadata).
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Miden Bridge",
    title: "Miden Bridge",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 2400,
        height: 1260,
        alt: "Miden Bridge — move value across Sepolia and Miden",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Miden Bridge",
    description: SITE_DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#14110d" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookies = (await headers()).get("cookie");

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground antialiased">
        <Providers cookies={cookies}>{children}</Providers>
      </body>
    </html>
  );
}
