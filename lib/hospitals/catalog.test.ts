import { describe, expect, it } from 'vitest';
import { hospitals, filterHospitals } from './catalog';
import { hospitalMessages } from './messages';
describe('approved hospitals directory',()=>{
 it('contains exactly the approved 9 public and 26 private candidates across five districts',()=>{
 expect(hospitals).toHaveLength(35);expect(new Set(hospitals.map(h=>h.id)).size).toBe(35);
 expect(hospitals.filter(h=>h.type==='public')).toHaveLength(9);
 expect(['nicosia','limassol','larnaca','paphos','famagusta'].map(d=>filterHospitals(d,'',false,'').length)).toEqual([14,6,4,7,4]);
 });
 it('combines district, type, emergency and name/address search',()=>{
 expect(filterHospitals('famagusta','private',true,'Napa').map(h=>h.name)).toEqual(['Napa Olympic Private Hospital']);
 expect(filterHospitals('nicosia','private',true,'')).toEqual([]);
 expect(filterHospitals('limassol','public',true,'kyperounta')).toHaveLength(1);
 expect(filterHospitals('paphos','',false,'impossible')).toEqual([]);
 });
 it('requires explicit provenance for every emergency claim and invents no GPS points',()=>{
 expect(hospitals.filter(h=>h.emergency&&h.type==='public')).toHaveLength(7);
 for(const h of hospitals){expect(h.source).toMatch(/^https:/);expect(h.checkedAt).toBeTruthy();expect(h).not.toHaveProperty('latitude');if(h.emergency){expect(h.emergencySource).toMatch(/^https:/);expect(h.emergencyPhone).toBeTruthy();}}
 });
 it('provides complete localized controls and specialist labels',()=>{
 for(const messages of Object.values(hospitalMessages)){expect(Object.keys(messages).sort()).toEqual(Object.keys(hospitalMessages.en).sort());for(const h of hospitals)expect(messages.profiles).toHaveProperty(h.profile);}
 });
});
