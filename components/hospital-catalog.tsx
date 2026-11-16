'use client';
import { useState } from 'react';
import { Globe, MapPin, Navigation, Phone, Search } from 'lucide-react';
import { HospitalFilterSelect } from '@/components/hospital-filter-select';
import { RevealItem, RevealScope, useRevealScope } from '@/components/reveal-on-scroll';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { filterHospitals } from '@/lib/hospitals/catalog';
import { hospitalMessages } from '@/lib/hospitals/messages';
import { DISTRICT_SLUGS, DISTRICT_TAB_ORDER } from '@/lib/i18n/district-pages';
import type { Locale } from '@/lib/i18n/types';
export function HospitalCatalog({locale, initialDistrict, names}: {locale: Locale; initialDistrict:string; names:Record<typeof DISTRICT_SLUGS[number],string>}) {
 const m = hospitalMessages[locale];
 const [district,setDistrict]=useState(initialDistrict); const [type,setType]=useState(''); const [emergency,setEmergency]=useState(false); const [query,setQuery]=useState('');
 const router=useRouter(); const pathname=usePathname(); const params=useSearchParams();
 const results=filterHospitals(district,type,emergency,query);
 const reveal=useRevealScope(results.map(h=>h.id).join('|'));
 function chooseDistrict(next: string) { setDistrict(next); const p = new URLSearchParams(params); if (next) p.set('district', next); else p.delete('district'); router.replace(`${pathname}${p.size ? '?' + p : ''}`, { scroll: false }); }
 return <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
 <nav aria-label={m.district} className="overflow-x-auto border-b border-[var(--line)] bg-white">
   <div className="mx-auto flex min-w-max justify-between gap-6 sm:gap-10 lg:max-w-5xl">
     {[{value:'',label:m.all},...DISTRICT_TAB_ORDER.map(d=>({value:d,label:names[d]}))].map(option=><button key={option.value} type="button" aria-pressed={district===option.value} onClick={()=>chooseDistrict(option.value)} className={`relative flex min-h-16 min-w-11 shrink-0 items-center justify-center whitespace-nowrap px-1 text-sm font-bold transition-colors sm:text-base ${district===option.value ? 'text-[var(--ink)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--brand)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}>{option.label}</button>)}
   </div>
 </nav>
 <section aria-label={m.search} className="relative z-10 -mx-1 -mt-px mb-8 grid gap-3 bg-white px-1 py-4 sm:mx-0 sm:grid-cols-2 sm:rounded-b-2xl sm:px-5 sm:shadow-[var(--shadow)] lg:grid-cols-[15rem_15rem_minmax(0,1fr)] lg:items-end">
 <HospitalFilterSelect label={m.type} value={type} options={[{value:'',label:m.any},{value:'public',label:m.public},{value:'private',label:m.private}]} onChange={setType} />
 <HospitalFilterSelect label={m.emergencyFilter} value={emergency?'emergency':''} options={[{value:'',label:m.allHospitals},{value:'emergency',label:m.emergency}]} onChange={next=>setEmergency(Boolean(next))} />
 <label className="block min-w-0 sm:col-span-2 lg:col-span-1"><span className="mb-2 block text-sm font-medium text-[var(--ink)]">{m.search}</span><span className="relative flex min-w-0 items-center"><Search className="pointer-events-none absolute start-3 size-5 text-[var(--ink-muted)]" aria-hidden="true"/><input type="search" className="h-12 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] pe-14 ps-11 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand)] focus:bg-white" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" onClick={()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur()} aria-label={m.search} className="absolute end-0.5 grid size-11 place-items-center rounded-[0.65rem] bg-[var(--brand)] text-white transition-colors hover:bg-[var(--brand-strong)]"><Search className="size-4" aria-hidden="true"/></button></span></label>
 </section>
 <p role="status" className="sr-only">{m.results}: {results.length}</p>
 {results.length===0?<p className="py-8">{m.empty}</p>:<RevealScope scope={reveal}><ul className="grid gap-4 md:grid-cols-2">{results.map(h=><RevealItem as="li" key={h.id} className="min-w-0"><article className="flex h-full min-w-0 flex-col rounded-[1.25rem] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-6">
 <div className="mb-4 flex min-h-6 flex-wrap gap-2"><span className="rounded-full bg-[rgb(190,255,80)] px-3 py-1.5 text-[0.68rem] font-extrabold uppercase tracking-[0.08em] text-[#17210b]">{h.type==='public'?m.public:m.private}</span>{h.emergency&&<span className="rounded-full bg-[#FF956A] px-3 py-1.5 text-[0.68rem] font-extrabold uppercase tracking-[0.08em] text-[#3d170b]">{m.emergency}</span>}</div>
 <h2 className="text-xl font-extrabold tracking-[-0.025em] text-[var(--ink)]" dir="auto">{h.name}</h2>
 {m.profiles[h.profile as keyof typeof m.profiles]&&<p className="mt-2 text-sm font-bold text-[var(--brand)]">{m.profiles[h.profile as keyof typeof m.profiles]}</p>}
 <div className="mt-3 flex items-start gap-2 text-sm leading-5 text-[var(--ink-muted)]"><MapPin className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" aria-hidden="true"/><span className="min-w-0"><span>{names[h.district]}</span><span aria-hidden="true"> · </span><bdi dir="auto" className="break-words">{h.address}</bdi></span></div>
 <div className="mt-auto pt-5">
 {h.reviewRequired&&<p className="mb-3 text-xs leading-5 text-[var(--ink-muted)]">{m.review}</p>}
 <div className="rounded-xl bg-[var(--surface-muted)] p-4 text-sm"><div className="flex items-start gap-3"><Phone className="mt-0.5 size-5 shrink-0 text-[var(--brand)]" aria-hidden="true"/><div className="min-w-0"><span className="block text-xs font-bold text-[var(--ink-muted)]">{m.reception}</span><a className="inline-flex min-h-10 items-center font-extrabold text-[var(--brand-strong)]" dir="ltr" href={`tel:${h.phone}`}>{h.phone}</a></div></div>{h.emergencyPhone&&<div className="mt-3 flex items-start gap-3 border-t border-[var(--line-strong)] pt-3"><Phone className="mt-0.5 size-5 shrink-0 text-[var(--danger)]" aria-hidden="true"/><div className="min-w-0"><span className="block text-xs font-bold text-[var(--ink-muted)]">{m.ae}</span><a className="inline-flex min-h-10 items-center font-extrabold text-[var(--danger)]" dir="ltr" href={`tel:${h.emergencyPhone}`}>{h.emergencyPhone}</a></div></div>}</div>
 </div>
 <div className={`grid gap-3 pt-5 ${h.website?'grid-cols-2':'grid-cols-1'}`}><a className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-3 text-center text-sm font-extrabold text-white transition-colors hover:bg-[var(--brand-strong)]" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address+', Cyprus')}`} target="_blank" rel="noreferrer"><Navigation className="size-5 shrink-0" aria-hidden="true"/>{m.directions}</a>{h.website&&<a className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-[var(--line-strong)] bg-white px-3 text-center text-sm font-extrabold text-[var(--brand-strong)] transition-colors hover:bg-[var(--surface-muted)]" href={h.website}><Globe className="size-5 shrink-0" aria-hidden="true"/>{m.website}</a>}</div>
 <p className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-muted)]"><a className="underline" href={h.source}>{m.source}</a> · {m.checked}: {new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(h.checkedAt))}</p>
 </article></RevealItem>)}</ul></RevealScope>}
 </div>;
}
