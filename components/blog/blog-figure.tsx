import { ImageOff } from "lucide-react";
import Image from "next/image";

import { fillTemplate, imageAlt } from "@/lib/blog/content";
import type { BlogImage } from "@/lib/blog/types";
import type { BlogMessages, Locale } from "@/lib/i18n/types";

const SOURCE_LABEL: Record<BlogImage["source"], string> = {
  pexels: "Pexels",
  unsplash: "Unsplash",
  openverse: "Openverse",
  upload: "",
  placeholder: "",
};

/** Unsplash requires its image URLs to be used directly, so they bypass the optimizer. */
export function isHotlinked(image: Pick<BlogImage, "source">): boolean {
  return image.source === "unsplash";
}

function ExternalLink({ href, children }: { href: string | null; children: string }) {
  if (!href) return <>{children}</>;
  return (
    <a className="underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Credit({ image, messages }: { image: BlogImage; messages: BlogMessages }) {
  const sourceLabel = SOURCE_LABEL[image.source];
  if (!image.creditName || !sourceLabel) return null;
  // "Photo: {name} / {source}" with each part linked, as stock licences ask.
  const [before, afterName] = messages.photoCredit.split("{name}");
  const [between, after] = (afterName ?? "").split("{source}");
  const showLicense = image.source === "openverse" && image.licenseName;
  return (
    <figcaption className="mt-2 text-xs text-[var(--ink-muted)]">
      {before}
      <ExternalLink href={image.creditUrl}>{image.creditName}</ExternalLink>
      {between}
      <ExternalLink href={image.sourcePageUrl}>{sourceLabel}</ExternalLink>
      {after}
      {showLicense && (
        <>
          {" · "}
          <ExternalLink href={image.licenseUrl}>{image.licenseName!}</ExternalLink>
        </>
      )}
    </figcaption>
  );
}

export function BlogFigure({
  image,
  locale,
  messages,
  showPlaceholder,
  preload = false,
  rounded = "rounded-2xl",
}: {
  image: BlogImage;
  locale: Locale;
  messages: BlogMessages;
  /** Placeholders are visible only in the editor's preview. */
  showPlaceholder: boolean;
  preload?: boolean;
  rounded?: string;
}) {
  if (!image.url) {
    if (!showPlaceholder) return null;
    return (
      <figure
        className={`flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--amber)] bg-[var(--amber-soft)] p-6 text-center text-sm font-semibold text-[var(--amber)] ${rounded}`}
      >
        <ImageOff className="size-7" aria-hidden="true" />
        <span>
          {fillTemplate(messages.imagePlaceholder, {
            note: image.placeholderNote || imageAlt(image, locale) || image.slot,
          })}
        </span>
        <code className="text-xs opacity-75">{image.slot}</code>
      </figure>
    );
  }

  const alt = imageAlt(image, locale);
  const hasDimensions = Boolean(image.width && image.height);
  const unoptimized = isHotlinked(image);

  return (
    <figure>
      {hasDimensions ? (
        <Image
          src={image.url}
          alt={alt}
          width={image.width!}
          height={image.height!}
          preload={preload}
          unoptimized={unoptimized}
          sizes="(max-width: 768px) 100vw, 768px"
          className={`h-auto w-full bg-[var(--surface-muted)] object-cover ${rounded}`}
        />
      ) : (
        <div className={`relative aspect-[16/9] w-full overflow-hidden bg-[var(--surface-muted)] ${rounded}`}>
          <Image
            src={image.url}
            alt={alt}
            fill
            preload={preload}
            unoptimized={unoptimized}
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
          />
        </div>
      )}
      <Credit image={image} messages={messages} />
    </figure>
  );
}
