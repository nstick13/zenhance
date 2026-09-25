import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { isClerkEnabled } from "@/lib/auth/currentUser";
import { isProduction, stage } from "@/lib/env";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/**
 * Only production is for the public.
 *
 * Every other stage runs on a real, guessable URL. Search engines are told to
 * stay away so a half-built `lab` deployment never turns up in results next
 * to the real product — and `noarchive` so nothing is cached after the
 * deployment is gone.
 *
 * This keeps previews out of *search*; it does not keep anyone out who has
 * the link. That is Vercel Deployment Protection, which is a dashboard
 * setting — see docs/ENVIRONMENTS.md § Who can reach what.
 */
export const metadata: Metadata = {
  title: "Zenhance — See your delivery org",
  description:
    "Visualize the real, cross-functional delivery organization — not the HR chart.",
  robots: isProduction()
    ? undefined
    : { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const body = (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets data-palette before first paint to avoid a flash on load */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('zenhance-palette');if(p)document.documentElement.dataset.palette=p}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className="min-h-full flex flex-col bg-slate-950 text-slate-100"
        // Which stage you are looking at, for anyone debugging a URL and for
        // an agent checking it drove the right one. Not shown to a viewer.
        data-stage={stage()}
      >
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
