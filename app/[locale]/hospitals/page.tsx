import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogShell } from '@/components/blog/blog-shell';
import { HospitalCatalog } from '@/components/hospital-catalog';
import { hospitalMessages } from '@/lib/hospitals/messages';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { isLocale } from '@/lib/i18n/config';
import { DISTRICT_SLUGS } from '@/lib/i18n/district-pages';
import { metadataBase, localizedAlternates } from '@/lib/i18n/metadata';
export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata>{
 const {locale}=await params;if(!isLocale(locale))return {}; const m=hospitalMessages[locale];
 return {metadataBase,title:`${m.title} | HealthGuide.cy`,description:m.description,alternates:localizedAlternates(locale,'/hospitals'),openGraph:{title:m.title,description:m.description},twitter:{title:m.title,description:m.description}};
}
export default async function HospitalsPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{district?:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();const m=hospitalMessages[locale];const {district}=await searchParams;const f=getDictionary(locale).finder;const names={nicosia:f.districtNicosia,limassol:f.districtLimassol,larnaca:f.districtLarnaca,paphos:f.districtPaphos,famagusta:f.districtFamagusta};
 return <BlogShell dictionary={getDictionary(locale)}><section className="bg-[linear-gradient(120deg,var(--hero-dark),var(--brand-strong))] text-white"><div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8"><h1 className="max-w-5xl [overflow-wrap:anywhere] text-balance text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[0.98] tracking-[-0.035em]">{m.title}</h1><p className="mt-5 max-w-4xl text-lg leading-relaxed">{m.alert} <a className="inline-block text-3xl font-bold text-[#FF956A] focus-visible:outline" href="tel:112" dir="ltr">112</a> {m.or} <a className="inline-block text-3xl font-bold text-[#FF956A] focus-visible:outline" href="tel:199" dir="ltr">199</a></p></div></section><HospitalCatalog names={names} key={locale} locale={locale} initialDistrict={DISTRICT_SLUGS.includes(district as typeof DISTRICT_SLUGS[number])?district!:''}/></BlogShell>;
}
