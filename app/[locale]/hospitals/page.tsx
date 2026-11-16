import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogShell } from '@/components/blog/blog-shell';
import { DirectoryHero, HeroPhone } from '@/components/directory-hero';
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
 return <BlogShell dictionary={getDictionary(locale)}><DirectoryHero title={m.title} subtitle={<>{m.alert} <HeroPhone number="112"/> {m.or} <HeroPhone number="199"/></>}/><HospitalCatalog names={names} key={locale} locale={locale} initialDistrict={DISTRICT_SLUGS.includes(district as typeof DISTRICT_SLUGS[number])?district!:''}/></BlogShell>;
}
