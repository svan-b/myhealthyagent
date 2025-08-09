import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "myHealthyAgent",
  description: "Track symptoms in 7 seconds",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
