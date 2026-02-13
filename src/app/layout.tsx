import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Marvel Review",
  description: "Webapp de notation et mini-critiques Marvel"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <div className="min-h-screen">
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-5 md:py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
