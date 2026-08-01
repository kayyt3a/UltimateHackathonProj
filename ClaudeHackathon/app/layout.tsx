export const metadata = {
  title: "Cloudy's Second Opinion",
  description: "Reid Library sensor watchers + reconciliation agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
