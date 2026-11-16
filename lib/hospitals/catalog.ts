import registry from './registry.json';
import type { DistrictSlug } from '@/lib/i18n/district-pages';
export type Hospital = Omit<(typeof registry)[number], 'district'> & { district: DistrictSlug };
export const hospitals = registry as Hospital[];
export function filterHospitals(district: string, type: string, emergency: boolean, query: string) {
 const text = query.normalize('NFKC').toLocaleLowerCase().trim();
 return hospitals.filter(h => (!district || h.district === district) && (!type || h.type === type) && (!emergency || h.emergency) && `${h.name} ${h.officialName} ${h.address}`.normalize('NFKC').toLocaleLowerCase().includes(text));
}
