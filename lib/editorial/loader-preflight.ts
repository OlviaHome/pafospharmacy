import "server-only";

import net from "node:net";

import { factSentences } from "@/lib/editorial/facts";
import { checkSourceLinks } from "@/lib/editorial/links";
import { fetchSourceText, verifyClaims } from "@/lib/editorial/source-text";

const HTML = "https://www.phs.moh.gov.cy/index_en.html";
const PDF = "https://www.phs.moh.gov.cy/assets/files/guides/Shortage_Report_v1.0.pdf";
const MISSING = "https://www.phs.moh.gov.cy/assets/files/guides/does-not-exist-2026.pdf";
const GOV = "https://www.gov.cy/moh-phs";
const MOH_REDIRECT = "https://www.moh.gov.cy/MOH/phs/phs.nsf/All/091BC51661367EE1C225857B002F972D";
const BIG_PDF =
  "https://www.mof.gov.cy/mof/gpo/gazette.nsf/B8F7312559CEBBDBC2258856001F84D8/%24file/5706%203%206%202022%20PARARTIMA%203o%20MEROS%20I.pdf";

function middleQuote(text: string): string {
  const words = text.replace(/\s+/g, " ").split(" ");
  const start = Math.floor(words.length / 2);
  return words.slice(start, start + 9).join(" ");
}

function listen(host: string): Promise<{ port: number; hits: () => number; close: () => void } | null> {
  return new Promise((resolve) => {
    let hits = 0;
    const server = net.createServer((socket) => {
      hits += 1;
      socket.destroy();
    });
    server.on("error", () => resolve(null));
    server.listen(0, host, () => resolve({ port: (server.address() as net.AddressInfo).port, hits: () => hits, close: () => server.close() }));
  });
}

const brief = (r: Awaited<ReturnType<typeof fetchSourceText>>) =>
  r.state === "ok" ? { state: r.state, kind: r.kind, chars: r.text.length } : r;

async function timed<T>(run: () => Promise<T>): Promise<{ seconds: number; result: T }> {
  const started = Date.now();
  const result = await run();
  return { seconds: Math.round((Date.now() - started) / 100) / 10, result };
}

export async function runLoaderPreflight() {
  const out: Record<string, unknown> = { node: process.version, region: process.env.VERCEL_REGION ?? null, env: process.env.VERCEL_ENV ?? "sandbox" };

  // 1. Real sources.
  const [html, pdf] = await Promise.all([fetchSourceText(HTML), fetchSourceText(PDF)]);
  out.sources = {
    html: brief(html),
    pdf: brief(pdf),
    missing: brief(await fetchSourceText(MISSING)),
    govCy403: brief(await fetchSourceText(GOV)),
    mohRedirectsToGovCy: brief(await fetchSourceText(MOH_REDIRECT)),
    safeRedirectFollowed: brief(await fetchSourceText("https://pafospharmacy.vercel.app/ru")),
  };
  const claims = [
    { claim: "HTML: настоящая цитата", importance: "critical" as const, source_url: HTML, quote: html.state === "ok" ? middleQuote(html.text) : "" },
    { claim: "PDF: настоящая цитата", importance: "critical" as const, source_url: PDF, quote: pdf.state === "ok" ? middleQuote(pdf.text) : "" },
    { claim: "Выдуманная цитата", importance: "critical" as const, source_url: HTML, quote: "pharmacies must stay open every Sunday until midnight by law" },
    { claim: "Источник не существует", importance: "critical" as const, source_url: MISSING, quote: "this document does not exist on the ministry site" },
    { claim: "Официальный портал отвечает 403", importance: "critical" as const, source_url: GOV, quote: "the Pharmaceutical Services publish the list of pharmacies" },
  ];
  out.claims = (await verifyClaims(claims, [])).map((e) => ({ claim: e.claim, sourceUrl: e.sourceUrl, quote: e.quote, state: e.state, detail: e.detail }));
  out.linkCheck = (await checkSourceLinks([HTML, MISSING, GOV])).map((c) => ({ url: c.url, state: c.state, status: c.status }));

  // 2. SSRF: a listener on this machine's loopback; any hit is a failure.
  const v4 = await listen("127.0.0.1");
  const v6 = await listen("::1");
  const p4 = v4?.port ?? 9;
  const p6 = v6?.port ?? 9;
  const hits = () => (v4?.hits() ?? 0) + (v6?.hits() ?? 0);
  const targets = [
    `https://127.0.0.1.nip.io:${p4}/`,
    `https://localtest.me:${p4}/`,
    `https://--1.sslip.io:${p6}/`,
    "https://169.254.169.254.nip.io/latest/meta-data/",
    "https://10.0.0.1.nip.io/",
    "https://192.168.1.1.nip.io/",
    "https://169.254.169.254/latest/meta-data/",
    `https://127.0.0.1:${p4}/`,
    `https://[::1]:${p6}/`,
    "https://localhost/",
    `http://127.0.0.1.nip.io:${p4}/`,
    `https://postman-echo.com/redirect-to?url=${encodeURIComponent(`https://127.0.0.1.nip.io:${p4}/`)}`,
    `https://postman-echo.com/redirect-to?url=${encodeURIComponent(`http://169.254.169.254/latest/meta-data/`)}`,
    `https://postman-echo.com/redirect-to?url=${encodeURIComponent(`https://127.0.0.1:${p4}/`)}`,
  ];
  const ssrf: unknown[] = [];
  for (const url of targets) {
    const before = hits();
    const result = await fetchSourceText(url);
    ssrf.push({ url: url.replace(String(p4), "PORT").replace(String(p6), "PORT"), state: result.state, internalConnections: hits() - before });
  }
  const beforeLinks = hits();
  const linkStates = await checkSourceLinks([targets[0], targets[11]]);
  out.ssrf = ssrf;
  out.ssrfLinkChecker = { states: linkStates.map((c) => c.state), internalConnections: hits() - beforeLinks };
  // Control: the same address through a plain, unguarded request does reach the listener.
  const beforeControl = hits();
  await fetch(`https://127.0.0.1.nip.io:${p4}/`).catch(() => undefined);
  out.ssrfControlUnguardedFetchReachesListener = hits() - beforeControl;
  out.listeners = { ipv4: Boolean(v4), ipv6: Boolean(v6) };
  v4?.close();
  v6?.close();

  // 3. Limits.
  const [connectHang, headerHang, tooBig] = await Promise.all([
    timed(() => fetchSourceText("https://example.com:81/")),
    timed(() => fetchSourceText("https://httpbun.com/delay/25")),
    timed(() => fetchSourceText(BIG_PDF)),
  ]);
  out.limits = { connectHang, headerHang, tooBig };

  // 4. Figures.
  const sample = [
    "В 2026 году график опубликован на сайте ведомства.",
    "Шаг 2 занимает около минуты.",
    "Ночью аптека работает до 23:00, после этого по телефону 1410.",
    "Подайте заявление до 31 марта 2026 года.",
    "Доплата 1 евро за визит.",
  ];
  out.figures = sample.map((sentence) => ({ sentence, needsSource: factSentences(sentence).length > 0 }));
  return out;
}
