export type Locale = "en" | "el" | "ru" | "ar";

export type ContentToken =
  | "contact"
  | "emergency"
  | "openData"
  | "ccBy"
  | "regularRules"
  | "dutyRules"
  | "osm"
  | "geoapify"
  | "googleMaps"
  | "vercelPrivacy"
  | "supabasePrivacy"
  | "geoapifyPrivacy"
  | "googlePrivacy";

export interface ContentBlock {
  type: "paragraphs" | "bullets" | "steps";
  items: string[];
}

export interface ContentSection {
  heading: string;
  blocks: ContentBlock[];
}

export interface ContentPageMessages {
  title: string;
  description: string;
  introduction: string;
  sections: ContentSection[];
}

export interface FinderMessages {
  heroDescription: string;
  loading: string;
  developmentTitle: string;
  developmentBody: string;
  attributionPrefix: string;
  attributionSourcesSuffix: string;
  attributionWarning: string;
  dataSources: string;
  searchControls: string;
  today: string;
  tomorrow: string;
  all: string;
  openNow: string;
  onDuty: string;
  availabilityFilter: string;
  openNowExplanation: string;
  findNear: string;
  browseWithoutLocation: string;
  near: string;
  change: string;
  clear: string;
  yourLocation: string;
  findingLocation: string;
  locationUnavailable: string;
  updateLocation: string;
  useLocation: string;
  enterArea: string;
  locationInputLabel: string;
  locationPlaceholder: string;
  searching: string;
  search: string;
  chooseLocation: string;
  minimumSearch: string;
  noLocationMatch: string;
  searchUnavailable: string;
  searchRateLimited: string;
  distanceCoverage: string;
  locationOptional: string;
  locationDenied: string;
  browseAllInstead: string;
  todayInPaphos: string;
  tomorrowSchedule: string;
  pharmacyResults: string;
  resultOne: string;
  resultFew: string;
  resultMany: string;
  resultOther: string;
  showingResults: string;
  showAllPharmacies: string;
  noMatches: string;
  noMatchesHelp: string;
  showAll: string;
  scheduleLocationNotes: string;
  scheduleNote: string;
  locationData: string;
  officialAddressesUnchanged: string;
  hoursUnavailableBadge: string;
  openNowBadge: string;
  closedBadge: string;
  onDutyTodayBadge: string;
  onDutyBadge: string;
  onCallBadge: string;
  dutyHoursUnavailableBadge: string;
  recordedRegularOpen: string;
  recordedDutyOpen: string;
  recordedDutyOnCall: string;
  recordedDutyUnknown: string;
  conflictTitle: string;
  conflictBody: string;
  dutyOpenUntil: string;
  regularOpenUntil: string;
  afternoonBreak: string;
  regularOpensAt: string;
  closedPublicHoliday: string;
  closedRegularSchedule: string;
  regularHoursEnded: string;
  scheduledGapTitle: string;
  dutyStartsAt: string;
  dutyNotOpenNow: string;
  overnightPhone: string;
  todayHours: string;
  tomorrowHours: string;
  regularPharmacyHours: string;
  dutyPharmacyHours: string;
  afterTwentyThree: string;
  nextDay: string;
  hoursUnavailable: string;
  hoursUnavailableForDay: string;
  sunday: string;
  call: string;
  phoneUnavailable: string;
  directions: string;
}

export interface FooterMessages {
  navigation: string;
  about: string;
  privacy: string;
  terms: string;
  dataSources: string;
  independent: string;
  corrections: string;
  emergencyBefore: string;
  emergencyAfter: string;
}

export interface TranslationDictionary {
  locale: Locale;
  languageSelectorLabel: string;
  siteTitle: string;
  metadataDescription: string;
  backToFinder: string;
  lastUpdated: string;
  googlePrivacyPolicyLabel: string;
  finder: FinderMessages;
  footer: FooterMessages;
  pages: {
    about: ContentPageMessages;
    privacy: ContentPageMessages;
    terms: ContentPageMessages;
    dataSources: ContentPageMessages;
  };
}
