import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { isClerkEnabled } from "@/lib/auth/currentUser";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Zenhance — See your delivery org",
  description:
    "Visualize the real, cross-functional delivery organization — not the HR chart.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const body = (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );

  // ClerkProvider requires a publishable key; only wrap when configured.
  if (isClerkEnabled()) {
    const { ClerkProvider } = await import("@clerk/nextjs");
    return <ClerkProvider>{body}</ClerkProvider>;
  }
  return body;
}
