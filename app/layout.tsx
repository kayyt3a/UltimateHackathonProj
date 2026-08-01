import type { ReactNode } from "react";

export const metadata = {
  title: "Cloudy's Second Opinion",
  description:
    "Reid Library night-watch: four deterministic watchers, one honest voice.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
