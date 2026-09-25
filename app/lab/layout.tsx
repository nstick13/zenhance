import { notFound } from "next/navigation";
import { labPagesVisible } from "@/lib/env";

/**
 * The lab is reachable everywhere except production.
 *
 * Experiments live in the codebase on every branch, so anyone can open a
 * preview deployment and look at one. A customer must never find a
 * half-finished idea by guessing a URL.
 *
 * Gating beats deleting: nothing has to be stripped out before a release, so
 * nobody has to remember to strip it. `notFound()` rather than a redirect or
 * a message, because in production these pages genuinely do not exist.
 *
 * See docs/ENVIRONMENTS.md § The lab pages.
 */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  if (!labPagesVisible()) notFound();
  return <>{children}</>;
}
