import { InformationPage } from "@/components/information-page";
import { CONTACT_EMAIL } from "@/lib/content/site";
import { CYPRUS_DUTY_RULE_SOURCE_URL } from "@/lib/domain/duty-hours";
import { CYPRUS_REGULAR_RULE_SOURCE_URL } from "@/lib/domain/regular-hours";
import type {
  ContentPageMessages,
  ContentToken,
  Locale,
  TranslationDictionary,
} from "@/lib/i18n/types";

const links: Record<ContentToken, { href: string; label: string; ltr?: boolean }> = {
  contact: { href: `mailto:${CONTACT_EMAIL}`, label: CONTACT_EMAIL, ltr: true },
  emergency: { href: "tel:112", label: "112", ltr: true },
  openData: {
    href: "https://www.data.gov.cy/en/dataset/817",
    label: "Cyprus Pharmaceutical Services 2026 open-data release",
    ltr: true,
  },
  ccBy: { href: "https://creativecommons.org/licenses/by/4.0/", label: "CC BY 4.0", ltr: true },
  regularRules: { href: CYPRUS_REGULAR_RULE_SOURCE_URL, label: "Cyprus pharmacy-hours order", ltr: true },
  dutyRules: {
    href: CYPRUS_DUTY_RULE_SOURCE_URL,
    label: "Cyprus Pharmaceutical Services 2026 duty-hours notice",
    ltr: true,
  },
  osm: { href: "https://www.openstreetmap.org/copyright", label: "© OpenStreetMap contributors", ltr: true },
  geoapify: { href: "https://www.geoapify.com/", label: "Powered by Geoapify", ltr: true },
  googleMaps: { href: "https://www.google.com/maps", label: "Google Maps", ltr: true },
  vercelPrivacy: { href: "https://vercel.com/legal/privacy-notice", label: "Vercel", ltr: true },
  supabasePrivacy: { href: "https://supabase.com/privacy", label: "Supabase", ltr: true },
  geoapifyPrivacy: { href: "https://www.geoapify.com/privacy-policy/", label: "Geoapify", ltr: true },
  googlePrivacy: { href: "https://policies.google.com/privacy", label: "Google Privacy Policy" },
};

function RichText({
  text,
  dictionary,
}: {
  text: string;
  dictionary: TranslationDictionary;
}) {
  return text
    .split(
      /(\{\{\w+\}\}|[0-9٠-٩]{2}:[0-9٠-٩]{2}(?:[–-][0-9٠-٩]{2}:[0-9٠-٩]{2})?|Europe\/Nicosia|paphos_locale|Paphos Pharmacy|Google Maps|OpenStreetMap Nominatim|Geoapify|Vercel|Supabase|IP)/g,
    )
    .map((part, index) => {
    if (
      /^(?:[0-9٠-٩]{2}:[0-9٠-٩]{2}(?:[–-][0-9٠-٩]{2}:[0-9٠-٩]{2})?|Europe\/Nicosia|paphos_locale|Paphos Pharmacy|Google Maps|OpenStreetMap Nominatim|Geoapify|Vercel|Supabase|IP)$/.test(
        part,
      )
    ) {
      return <bdi key={`${part}-${index}`} dir="ltr">{part}</bdi>;
    }
    const match = /^\{\{(\w+)\}\}$/.exec(part);
    if (!match || !(match[1] in links)) return part;
    const link = links[match[1] as ContentToken];
    const label =
      match[1] === "googlePrivacy"
        ? dictionary.googlePrivacyPolicyLabel
        : link.label;
    return (
      <a
        key={`${match[1]}-${index}`}
        className="font-bold underline"
        href={link.href}
        dir={link.ltr ? "ltr" : undefined}
      >
        {label}
      </a>
    );
  });
}

function Block({
  block,
  dictionary,
}: {
  block: ContentPageMessages["sections"][number]["blocks"][number];
  dictionary: TranslationDictionary;
}) {
  if (block.type === "paragraphs") {
    return block.items.map((item, index) => (
      <p key={index} className="mt-2"><RichText text={item} dictionary={dictionary} /></p>
    ));
  }
  const List = block.type === "steps" ? "ol" : "ul";
  return (
    <List className={`${block.type === "steps" ? "list-decimal" : "list-disc"} mt-2 space-y-2 ps-5`}>
      {block.items.map((item, index) => <li key={index}><RichText text={item} dictionary={dictionary} /></li>)}
    </List>
  );
}

export function LocalizedContentPage({
  locale,
  dictionary,
  page,
}: {
  locale: Locale;
  dictionary: TranslationDictionary;
  page: ContentPageMessages;
}) {
  return (
    <InformationPage
      title={page.title}
      introduction={page.introduction}
      locale={locale}
      languageLabel={dictionary.languageSelectorLabel}
      backLabel={dictionary.backToFinder}
      lastUpdated={dictionary.lastUpdated}
    >
      {page.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="text-xl font-extrabold">{section.heading}</h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} dictionary={dictionary} />
          ))}
        </section>
      ))}
    </InformationPage>
  );
}
