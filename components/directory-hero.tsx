import type { ReactNode } from "react";

/**
 * Shared static hero for the Pharmacies and Hospitals directories.
 * Pharmacies is the visual reference: same background, padding, desktop
 * min-height (22rem), vertical centering, H1 and subtitle typography.
 */
export function DirectoryHero({
  title,
  subtitle,
  subtitleAs: Subtitle = "p",
  subtitleNoWrapOnDesktop = false,
  className = "",
  children,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  subtitleAs?: "h2" | "p";
  /** Keep the subtitle on one line from lg up (short schedule line on Pharmacies). */
  subtitleNoWrapOnDesktop?: boolean;
  /** Extra classes for the outer section (e.g. page-specific space reservations). */
  className?: string;
  /** Optional content under the subtitle, e.g. the PWA install button. */
  children?: ReactNode;
}) {
  return (
    <section
      className={`relative bg-[linear-gradient(120deg,var(--hero-dark),var(--brand-strong))] text-white ${className}`}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col justify-center px-4 py-12 sm:px-6 sm:py-16 lg:min-h-[22rem] lg:px-8 lg:py-16">
        <h1 className="max-w-5xl [overflow-wrap:anywhere] text-balance text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[0.98] tracking-[-0.035em]">
          {title}
        </h1>
        <Subtitle
          className={`mt-4 max-w-6xl text-balance text-[clamp(1.125rem,2vw,1.5rem)] font-normal leading-[1.2] text-white/65 ${
            subtitleNoWrapOnDesktop ? "lg:whitespace-nowrap" : ""
          }`}
        >
          {subtitle}
        </Subtitle>
        {children}
      </div>
    </section>
  );
}

/**
 * Large orange emergency number inside the hero subtitle (inline link, tel:).
 * From lg up the subtitle is a single line, so a zero line-height keeps the
 * line box, and therefore the H1 position, identical to Pharmacies. Below lg
 * the subtitle may wrap, so a normal line-height avoids overlapping lines.
 */
export function HeroPhone({ number }: { number: string }) {
  return (
    <a
      href={`tel:${number}`}
      dir="ltr"
      className="text-[1.6em] font-bold leading-none text-[#FF956A] lg:leading-[0] no-underline hover:text-[#FFB08F] focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF956A]"
    >
      {number}
    </a>
  );
}
