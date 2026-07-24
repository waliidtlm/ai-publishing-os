import type { Metadata } from "next";

import "./styles.css";

export const metadata: Metadata = {
  title: "AI Publishing OS",
  description: "AI Publishing OS development dashboard",
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
