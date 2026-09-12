import Link from "next/link";

import { CONTACT_EMAIL } from "@/lib/content/site";

const footerLinks = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/data-sources", label: "Data Sources & Disclaimer" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 text-sm leading-6 text-[var(--ink-muted)] sm:px-6">
        <nav aria-label="Legal and information" className="flex flex-wrap gap-x-5 gap-y-2">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-bold text-[var(--brand-strong)] underline decoration-[var(--line-strong)] underline-offset-4"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="mt-4">Independent service using official Cyprus pharmacy data.</p>
        <p className="mt-2">
          Questions or corrections:{" "}
          <a className="font-bold underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="mt-2">
          Paphos Pharmacy is not an emergency service. In a serious or life-threatening
          emergency in Cyprus, call{" "}
          <a className="font-bold underline" href="tel:112">112</a>. This website does not
          replace a doctor, pharmacist, or emergency medical service.
        </p>
      </div>
    </footer>
  );
}
