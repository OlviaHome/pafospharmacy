import { ImageOff } from "lucide-react";
import Image from "next/image";

import { fillTemplate, imageAlt } from "@/lib/blog/content";
import type { BlogImage } from "@/lib/blog/types";
import type { BlogMessages, Locale } from "@/lib/i18n/types";

const SOURCE_LABEL: Record<BlogImage["source"], string> = {
  pexels: "Pexels",
  upload: "",
  placeholder: "",
};

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
  const sourceLabel = SOURCE_LABEL[image.source];
  const hasDimensions = Boolean(image.width && image.height);

  return (
    <figure>
      {hasDimensions ? (
        <Image
          src={image.url}
          alt={alt}
          width={image.width!}
          height={image.height!}
          preload={preload}
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
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
          />
        </div>
      )}
      {image.creditName && sourceLabel && (
        <figcaption className="mt-2 text-xs text-[var(--ink-muted)]">
          {image.creditUrl ? (
            <a className="underline underline-offset-2" href={image.creditUrl} target="_blank" rel="noopener noreferrer">
              {fillTemplate(messages.photoCredit, { name: image.creditName, source: sourceLabel })}
            </a>
          ) : (
            fillTemplate(messages.photoCredit, { name: image.creditName, source: sourceLabel })
          )}
        </figcaption>
      )}
    </figure>
  );
}
