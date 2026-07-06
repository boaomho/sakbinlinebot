import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "สากบิน",
  description: "LINE webhook service for ร้านสากบิน",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
