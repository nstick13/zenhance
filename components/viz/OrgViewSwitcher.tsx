import Link from "next/link";

/**
 * Which map you're looking at. The org page has carried alternate views on a
 * query string for a while (`?view=radial`), but with no way to reach them
 * except by typing the URL — so a new view was effectively invisible. This is
 * that missing affordance, and it lives on the page rather than in the app
 * nav because it switches *this* page's view, not the route.
 *
 * Pinned top-right: the canvas holds its own chrome in the other three
 * corners, and the orbital map keeps its controls along the bottom.
 */
const VIEWS: { id: string; label: string; href: string }[] = [
  { id: "orbital", label: "Orbital", href: "/org" },
  { id: "canvas", label: "Canvas", href: "/org?view=canvas" },
  { id: "radial", label: "Radial", href: "/org?view=radial" },
];

export function OrgViewSwitcher({ active }: { active: string }) {
  return (
    <nav
      aria-label="Map view"
      className="absolute right-3.5 top-3.5 z-20 flex gap-0.5 rounded-full border border-line bg-surface/90 p-1 shadow-sm backdrop-blur"
    >
      {VIEWS.map((v) => {
        const on = v.id === active;
        return (
          <Link
            key={v.id}
            href={v.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              on ? "bg-ink text-white" : "text-ink-soft hover:bg-paper hover:text-ink"
            }`}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}
