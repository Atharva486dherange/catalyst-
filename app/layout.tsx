import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./saathi.css";

export const metadata: Metadata = {
  title: "Saathi | My Care Circle",
  description: "Manage scheduled doses and coordinate follow-ups with your Care Circle.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
