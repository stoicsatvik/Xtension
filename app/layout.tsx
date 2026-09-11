import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xtension — Browser Extension X-Ray",
  description: "See what a Chrome extension can technically access before you trust it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
