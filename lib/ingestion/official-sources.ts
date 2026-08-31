export const OFFICIAL_DATASET_PAGE = "https://www.data.gov.cy/en/dataset/817";
export const OFFICIAL_ORGANIZATION = "Cyprus Pharmaceutical Services";
export const OFFICIAL_LICENSE = "CC BY 4.0";
export const OFFICIAL_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

export interface OfficialCsvResource {
  id: string;
  kind: "pharmacy_directory" | "duty_rota";
  district: string | null;
  dataset: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  url: string;
  filename: string;
}

export const OFFICIAL_RESOURCES: OfficialCsvResource[] = [
  {
    id: "private-pharmacies-2026",
    kind: "pharmacy_directory",
    district: null,
    dataset: "Cyprus private pharmacies directory 2026",
    coverageStart: null,
    coverageEnd: null,
    url: "https://www.data.gov.cy/sites/default/files/%CE%9A%CE%B1%CF%84%CE%AC%CE%BB%CE%BF%CE%B3%CE%BF%CF%82%20%CE%99%CE%B4%CE%B9%CF%89%CF%84%CE%B9%CE%BA%CF%8E%CE%BD%20%CE%A6%CE%B1%CF%81%CE%BC%CE%B1%CE%BA%CE%B5%CE%AF%CF%89%CE%BD%202026.csv",
    filename: "private-pharmacies-2026.csv",
  },
  {
    id: "duty-famagusta-2026-05-09",
    kind: "duty_rota",
    district: "Famagusta",
    dataset: "Cyprus pharmacies on duty May–September 2026",
    coverageStart: "2026-05-01",
    coverageEnd: "2026-09-30",
    url: "https://www.data.gov.cy/sites/default/files/%CE%91%CE%9C%CE%9C%CE%9F%CE%A7%CE%A9%CE%A3%CE%A4%CE%9F%CE%A3%2005-09-2026%20Final.csv",
    filename: "famagusta-duty-2026.csv",
  },
  {
    id: "duty-larnaca-2026-05-09",
    kind: "duty_rota",
    district: "Larnaca",
    dataset: "Cyprus pharmacies on duty May–September 2026",
    coverageStart: "2026-05-01",
    coverageEnd: "2026-09-30",
    url: "https://www.data.gov.cy/sites/default/files/%CE%9B%CE%91%CE%A1%CE%9D%CE%91%CE%9A%CE%91%2005-09-2026%20Final.csv",
    filename: "larnaca-duty-2026.csv",
  },
  {
    id: "duty-limassol-2026-05-09",
    kind: "duty_rota",
    district: "Limassol",
    dataset: "Cyprus pharmacies on duty May–September 2026",
    coverageStart: "2026-05-01",
    coverageEnd: "2026-09-30",
    url: "https://www.data.gov.cy/sites/default/files/%CE%9B%CE%95%CE%9C%CE%95%CE%A3%CE%9F%CE%A3%2005-09-2026%20Final.csv",
    filename: "limassol-duty-2026.csv",
  },
  {
    id: "duty-nicosia-2026-05-09",
    kind: "duty_rota",
    district: "Nicosia",
    dataset: "Cyprus pharmacies on duty May–September 2026",
    coverageStart: "2026-05-01",
    coverageEnd: "2026-09-30",
    url: "https://www.data.gov.cy/sites/default/files/%CE%9B%CE%95%CE%A5%CE%9A%CE%A9%CE%A3%CE%99%CE%91%2005-09-2026%20Final.csv",
    filename: "nicosia-duty-2026.csv",
  },
  {
    id: "duty-paphos-2026-05-09",
    kind: "duty_rota",
    district: "Paphos",
    dataset: "Cyprus pharmacies on duty May–September 2026",
    coverageStart: "2026-05-01",
    coverageEnd: "2026-09-30",
    url: "https://www.data.gov.cy/sites/default/files/%CE%A0%CE%91%CE%A6%CE%9F%CE%A3%2005-09-2026%20Final.csv",
    filename: "paphos-duty-2026.csv",
  },
];
