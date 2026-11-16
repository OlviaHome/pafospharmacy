'use client';
import { useState } from 'react';
import { HospitalFilterSelect } from '@/components/hospital-filter-select';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { filterHospitals } from '@/lib/hospitals/catalog';
import { hospitalMessages } from '@/lib/hospitals/messages';
import { DISTRICT_SLUGS } from '@/lib/i18n/district-pages';
import type { Locale } from '@/lib/i18n/types';
export function HospitalCatalog({locale, initialDistrict, names}: {locale: Locale; initialDistrict:string; names:Record<typeof DISTRICT_SLUGS[number],string>}) {
 const m = hospitalMessages[locale];
 const [district,setDistrict]=useState(initialDistrict); const [type,setType]=useState(''); const [emergency,setEmergency]=useState(false); const [query,setQuery]=useState('');
 const router=useRouter(); const pathname=usePathname(); const params=useSearchParams();
 const results=filterHospitals(district,type,emergency,query);
 return <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
 <Link href={`/${locale}`} className="inline-flex min-h-11 items-center font-bold text-[var(--brand)]">← {m.back}</Link>
 <section aria-label={m.search} className="grid gap-3 rounded-2xl bg-[var(--surface-muted)] p-4 sm:grid-cols-2 lg:grid-cols-4">
 <HospitalFilterSelect label={m.district} value={district} options={[{value:'',label:m.all},...DISTRICT_SLUGS.map(d=>({value:d,label:names[d]}))]} onChange={next=>{setDistrict(next);const p=new URLSearchParams(params);if(next)p.set('district',next);else p.delete('district');router.replace(`${pathname}${p.size?'?'+p:''}`,{scroll:false});}} />
 <HospitalFilterSelect label={m.type} value={type} options={[{value:'',label:m.any},{value:'public',label:m.public},{value:'private',label:m.private}]} onChange={setType} />
 <HospitalFilterSelect label={m.emergencyFilter} value={emergency?'emergency':''} options={[{value:'',label:m.allHospitals},{value:'emergency',label:m.emergency}]} onChange={next=>setEmergency(Boolean(next))} />
 <label className="block min-w-0"><span className="mb-2 block text-sm font-medium text-[var(--ink)]">{m.search}</span><input type="search" className="h-12 w-full min-w-0 rounded-xl border border-[var(--line-strong)] bg-white px-4 text-sm text-[var(--ink)] outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30" value={query} onChange={e=>setQuery(e.target.value)}/></label>
 </section>
 <p role="status" className="py-5 text-sm text-[var(--ink-muted)]">{m.results}: {results.length}</p>
 {results.length===0?<p className="py-8">{m.empty}</p>:<ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{results.map(h=><li key={h.id} className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
 <article className="flex h-full flex-col gap-3 break-words">
 <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-lg bg-[var(--surface-muted)] px-2 py-1">{h.type==='public'?m.public:m.private}</span>{h.emergency&&<span className="rounded-lg bg-[var(--amber-soft)] px-2 py-1 text-[var(--danger)]">{m.emergency}</span>}</div>
 <h2 className="text-xl font-bold leading-tight" dir="auto">{h.name}</h2>
 {m.profiles[h.profile as keyof typeof m.profiles]&&<p className="font-medium text-[var(--brand)]">{m.profiles[h.profile as keyof typeof m.profiles]}</p>}
 <p className="text-sm text-[var(--ink-muted)]">{names[h.district]}</p><p dir="auto" className="text-sm">{h.address}</p>
 {h.emergencyPhone&&<p className="text-sm font-bold text-[var(--danger)]">{m.ae}: <a className="inline-flex min-h-11 items-center focus-visible:outline" dir="ltr" href={`tel:${h.emergencyPhone}`}>{h.emergencyPhone}</a></p>}
 <p className="text-sm">{m.reception}: <a className="inline-flex min-h-11 items-center font-bold focus-visible:outline" dir="ltr" href={`tel:${h.phone}`}>{h.phone}</a></p>
 {h.reviewRequired&&<p className="text-xs leading-5 text-[var(--ink-muted)]">{m.review}</p>}
 <div className="mt-auto flex flex-wrap gap-x-5 text-sm font-bold text-[var(--brand)]"><a className="inline-flex min-h-11 items-center" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address+', Cyprus')}`}>{m.directions}</a>{h.website&&<a className="inline-flex min-h-11 items-center" href={h.website}>{m.website}</a>}</div>
 <p className="text-xs text-[var(--ink-muted)]"><a className="underline" href={h.source}>{m.source}</a> · {m.checked}: {new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(h.checkedAt))}</p>
 </article></li>)}</ul>}
 </div>;
}
