import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Cloudy's Second Opinion",
  description:
    "Cloudy's Second Opinion — an early-warning and evidence-reconciliation interface for Reid Library.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
