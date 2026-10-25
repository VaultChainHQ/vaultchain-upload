"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Upload" },
  { href: "/files", label: "My files" },
  { href: "/contacts", label: "Contacts" },
  { href: "/account", label: "Account" },
];

export function SubNav() {
  const path = usePathname() || "/";
  return (
    <nav className="subnav" aria-label="Upload app sections">
      {ITEMS.map((i) => {
        const on = i.href === "/" ? path === "/" : path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
