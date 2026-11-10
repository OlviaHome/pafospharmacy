import "server-only";

import { imageSize } from "image-size";

import { supabaseAdminConfig, unsplashKey } from "./config";
import { adminClient } from "./store";

export const BLOG_IMAGE_BUCKET = "blog-images";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const USER_AGENT = "HealthGuideCyprusEditorialBot/1.0 (+https://healthguide.cy)";
const UTM = "utm_source=healthguide_cyprus&utm_medium=referral";

export interface StockCandidate {
  provider: "unsplash" | "openverse";
  id: string;
  /** Unsplash: hotlink URL. Openverse: original file URL to copy into our bucket. */
  url: string;
  width: number;
  height: number;
  creditName: string;
  creditUrl: string | null;
  sourcePageUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  downloadLocation?: string;
}

function withUtm(url: string | null | undefined): string | null {
  if (!url) return null;
  return `${url}${url.includes("?") ? "&" : "?"}${UTM}`;
}

function httpsOrNull(url: string | null | undefined): string | null {
  return url && /^https:\/\//.test(url) ? url : null;
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { raw: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

async function searchUnsplash(key: string, query: string, exclude: Set<string>): Promise<StockCandidate | null> {
  const params = new URLSearchParams({
    query,
    orientation: "landscape",
    per_page: "15",
    content_filter: "high",
  });
  const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Unsplash search failed: ${response.status}`);
  const json = (await response.json()) as { results?: UnsplashPhoto[] };
  const photo = (json.results ?? []).find((result) => !exclude.has(`unsplash:${result.id}`));
  if (!photo) return null;
  return {
    provider: "unsplash",
    id: photo.id,
    // Unsplash requires hotlinking its URLs; size parameters are allowed.
    url: `${photo.urls.raw}${photo.urls.raw.includes("?") ? "&" : "?"}w=1600&q=80&fm=jpg&fit=max`,
    width: photo.width,
    height: photo.height,
    creditName: photo.user.name,
    creditUrl: withUtm(photo.user.links.html),
    sourcePageUrl: withUtm("https://unsplash.com/"),
    licenseName: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
    downloadLocation: photo.links.download_location,
  };
}

interface OpenverseImage {
  id: string;
  url: string;
  width?: number | null;
  height?: number | null;
  creator?: string | null;
  creator_url?: string | null;
  license: string;
  license_version?: string | null;
  license_url?: string | null;
  foreign_landing_url?: string | null;
  filetype?: string | null;
}

function openverseLicenseName(license: string, version?: string | null): string {
  if (license === "cc0") return "CC0";
  if (license === "pdm") return "Public Domain Mark";
  return `CC ${license.toUpperCase()}${version ? ` ${version}` : ""}`;
}

async function searchOpenverse(query: string, exclude: Set<string>): Promise<StockCandidate | null> {
  const params = new URLSearchParams({
    q: query,
    license: "cc0,pdm,by,by-sa",
    page_size: "20",
    mature: "false",
    aspect_ratio: "wide",
    size: "large",
  });
  const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Openverse search failed: ${response.status}`);
  const json = (await response.json()) as { results?: OpenverseImage[] };
  const image = (json.results ?? []).find(
    (result) =>
      !exclude.has(`openverse:${result.id}`) &&
      /^https:\/\//.test(result.url) &&
      (!result.filetype || result.filetype.toLowerCase() in ACCEPTED_TYPES) &&
      (result.width ?? 0) >= 1000,
  );
  if (!image) return null;
  return {
    provider: "openverse",
    id: image.id,
    url: image.url,
    width: image.width ?? 0,
    height: image.height ?? 0,
    creditName: image.creator?.trim() || "Unknown author",
    creditUrl: httpsOrNull(image.creator_url),
    sourcePageUrl: httpsOrNull(image.foreign_landing_url),
    licenseName: openverseLicenseName(image.license, image.license_version),
    licenseUrl: image.license_url ?? null,
  };
}

/** Finds a stock photo not tried before. Unsplash when a key is configured, otherwise Openverse. */
export async function searchStock(query: string, tried: string[]): Promise<StockCandidate | null> {
  const exclude = new Set(tried);
  const key = unsplashKey();
  if (key) {
    try {
      const found = await searchUnsplash(key, query, exclude);
      if (found) return found;
    } catch (error) {
      console.error("editorial: unsplash search failed, trying openverse", error);
    }
  }
  return searchOpenverse(query, exclude);
}

function publicUrl(path: string): string {
  const { url } = supabaseAdminConfig();
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${BLOG_IMAGE_BUCKET}/${path}`;
}

export interface StoredImage {
  url: string;
  storagePath: string | null;
  width: number;
  height: number;
}

/** Validates image bytes and stores them in the public bucket. */
export async function storeImageBytes(postId: string, slot: string, bytes: Uint8Array): Promise<StoredImage> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Картинка больше 10 МБ.");
  let size: { width?: number; height?: number; type?: string };
  try {
    size = imageSize(bytes);
  } catch {
    throw new Error("Это не картинка (нужен JPG, PNG или WebP).");
  }
  const contentType = size.type ? ACCEPTED_TYPES[size.type] : undefined;
  if (!contentType || !size.width || !size.height) throw new Error("Нужен JPG, PNG или WebP.");
  const extension = size.type === "jpeg" ? "jpg" : size.type!;
  const storagePath = `posts/${postId}/${slot}-${Date.now()}.${extension}`;
  const { error } = await adminClient()
    .storage.from(BLOG_IMAGE_BUCKET)
    .upload(storagePath, bytes, { contentType, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`Не удалось сохранить картинку: ${error.message}`);
  return { url: publicUrl(storagePath), storagePath, width: size.width, height: size.height };
}

/** Turns a candidate into a usable image: hotlink for Unsplash, a copy in our bucket for Openverse. */
export async function materializeStock(candidate: StockCandidate, postId: string, slot: string): Promise<StoredImage> {
  if (candidate.provider === "unsplash") {
    const key = unsplashKey();
    if (key && candidate.downloadLocation) {
      // Required by the Unsplash API guidelines whenever a photo is used.
      await fetch(candidate.downloadLocation, {
        headers: { Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
    return { url: candidate.url, storagePath: null, width: candidate.width, height: candidate.height };
  }
  const response = await fetch(candidate.url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES) throw new Error("Image too large");
  return storeImageBytes(postId, slot, new Uint8Array(await response.arrayBuffer()));
}

export async function removeStoredImage(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  await adminClient().storage.from(BLOG_IMAGE_BUCKET).remove([storagePath]).catch(() => undefined);
}
