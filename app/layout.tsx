import type { Metadata, Viewport } from "next";
import { Manrope, IBM_Plex_Sans, Fraunces } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Login screen headline only — see docs/design/00_FOUNDATIONS.md §2.2's
// scoped display-typeface exception. Never used inside a working screen.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prosper Hotel Management System",
  description: "Stock, sales, and profit tracking for Prosper Hotel.",
  appleWebApp: {
    title: "Prosper Hotel",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#331642",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${ibmPlexSans.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
