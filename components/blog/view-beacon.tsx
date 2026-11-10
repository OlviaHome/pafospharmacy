"use client";

import { useEffect } from "react";

/** Reports one view per article per browser tab session. Renders nothing. */
export function ViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    if (navigator.webdriver) return;
    const key = `blog-viewed:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage can be unavailable (private mode); count the view anyway.
    }
    void fetch("/api/blog/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => undefined);
  }, [slug]);
  return null;
}
