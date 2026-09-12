import Link from "next/link";

import { CONTACT_EMAIL } from "@/lib/content/site";
import { localePath } from "@/lib/i18n/config";
import type { FooterMessages, Locale } from "@/lib/i18n/types";

export function SiteFooter({ locale, messages }: { locale: Locale; messages: FooterMessages }) {
  const footerLinks = [
    { href: "/about", label: messages.about },
    { href: "/privacy", label: messages.privacy },
    { href: "/terms", label: messages.terms },
    { href: "/data-sources", label: messages.dataSources },
  ] as const;
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 text-sm leading-6 text-[var(--ink-muted)] sm:px-6">
        <nav aria-label={messages.navigation} className="flex flex-wrap gap-x-5 gap-y-2">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={localePath(locale, link.href)}
              className="font-bold text-[var(--brand-strong)] underline decoration-[var(--line-strong)] underline-offset-4"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="mt-4">{messages.independent}</p>
        <p className="mt-2">
          {messages.corrections}{" "}
          <a className="font-bold underline" dir="ltr" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="mt-2">
          {messages.emergencyBefore}{" "}
          <a className="font-bold underline" dir="ltr" href="tel:112">112</a>.{" "}
          {messages.emergencyAfter}
        </p>
      </div>
    </footer>
  );
}
