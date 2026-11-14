import dns from "node:dns";
import net from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkSourceLinks } from "./links";
import { fetchSourceText, htmlToText, isFetchableSourceUrl, SOURCE_LIMITS, verifyClaims } from "./source-text";

/** Minimal one-page PDF with a text layer. */
function pdf(text: string): Uint8Array<ArrayBuffer> {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(new TextEncoder().encode(out));
}

function respond(body: BodyInit | null, type: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": type } });
}

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

const PUBLIC_IP = "93.184.216.34";

/** Scripted DNS answers: the tests never use the real network or the real resolver. */
function stubDns(answers: (host: string, call: number) => { v4?: string[]; v6?: string[] }) {
  const calls = new Map<string, number>();
  const noData = (host: string) => Object.assign(new Error(`queryA ENODATA ${host}`), { code: "ENODATA" });
  const answer = (host: string) => answers(host, calls.get(host) ?? 0);
  vi.spyOn(dns.promises.Resolver.prototype, "resolve4").mockImplementation((async (host: string) => {
    const result = answer(host).v4 ?? [];
    calls.set(host, (calls.get(host) ?? 0) + 1);
    if (result.length === 0) throw noData(host);
    return result;
  }) as never);
  vi.spyOn(dns.promises.Resolver.prototype, "resolve6").mockImplementation((async (host: string) => {
    const result = answer(host).v6 ?? [];
    if (result.length === 0) throw noData(host);
    return result;
  }) as never);
}

/** A listener on this machine's loopback address: any connection to it is an SSRF. */
async function internalService(): Promise<{ port: number; connections: () => number; close: () => Promise<void> }> {
  let count = 0;
  const server = net.createServer((socket) => {
    count += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    connections: () => count,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

beforeEach(() => stubDns(() => ({ v4: [PUBLIC_IP] })));
afterEach(() => vi.restoreAllMocks());

describe("isFetchableSourceUrl", () => {
  it("allows public https hosts only", () => {
    expect(isFetchableSourceUrl("https://www.gesy.org.cy/en-us/faq")).toBe(true);
    for (const bad of [
      "http://www.gesy.org.cy/",
      "ftp://www.gesy.org.cy/",
      "file:///etc/passwd",
      "https://localhost/x",
      "https://localhost./x",
      "https://127.0.0.1/x",
      "https://2130706433/x",
      "https://[::1]/x",
      "https://[::ffff:127.0.0.1]/x",
      "https://router.local/x",
      "https://db.internal/x",
      "https://user:pass@gov.cy/x",
      "not a url",
    ]) {
      expect([bad, isFetchableSourceUrl(bad)]).toEqual([bad, false]);
    }
  });
});

describe("htmlToText", () => {
  it("drops scripts and tags and decodes entities", () => {
    expect(htmlToText("<script>var a=1</script><p>Co&#8209;payment&nbsp;&euro;1 &amp; more</p>")).toBe("Co‑payment €1 & more");
  });
});

describe("fetchSourceText", () => {
  const LONG = "Beneficiaries pay a co-payment of 1 euro per visit to a personal doctor in Cyprus.";
  const via = (response: () => Response) => ({ transport: vi.fn(async () => response()) as unknown as typeof fetch });

  it("reads HTML pages", async () => {
    const options = via(() => respond(`<html><body><p>${LONG}</p></body></html>`, "text/html"));
    expect(await fetchSourceText("https://www.gesy.org.cy/en-us/faq", options)).toEqual({ state: "ok", kind: "html", text: LONG });
  });

  it("reads text PDFs from official sites", async () => {
    const result = await fetchSourceText("https://www.moh.gov.cy/fees.pdf", via(() => respond(pdf(LONG), "application/pdf")));
    expect(result).toMatchObject({ state: "ok", kind: "pdf" });
    expect(result.state === "ok" && result.text).toContain("co-payment of 1 euro");
  });

  it("does not parse PDFs from unofficial sites", async () => {
    const result = await fetchSourceText("https://example-blog.com/fees.pdf", via(() => respond(pdf(LONG), "application/pdf")));
    expect(result).toMatchObject({ state: "no_text" });
  });

  it("leaves a PDF without a text layer to the editor (no OCR)", async () => {
    const result = await fetchSourceText("https://www.moh.gov.cy/scan.pdf", via(() => respond(pdf(""), "application/pdf")));
    expect(result).toMatchObject({ state: "no_text" });
  });

  it("refuses oversized files and pages that need JavaScript", async () => {
    const big = new Uint8Array(SOURCE_LIMITS.maxPdfBytes + 1);
    expect(await fetchSourceText("https://www.moh.gov.cy/big.pdf", via(() => respond(big, "application/pdf")))).toMatchObject({
      state: "no_text",
      detail: "PDF больше 10 МБ",
    });
    const page = new Uint8Array(SOURCE_LIMITS.maxHtmlBytes + 1).fill(97);
    expect(await fetchSourceText("https://www.gesy.org.cy/huge", via(() => respond(page, "text/html")))).toMatchObject({
      state: "no_text",
      detail: "страница больше 3 МБ",
    });
    const app = via(() => respond("<div id=app></div><script>render()</script>", "text/html"));
    expect(await fetchSourceText("https://www.gesy.org.cy/app", app)).toMatchObject({ state: "no_text" });
  });

  it("reports a missing page and a site that refuses automated requests differently", async () => {
    expect(await fetchSourceText("https://www.gov.cy/missing", via(() => respond("missing", "text/html", 404)))).toEqual({
      state: "unreachable",
      detail: "HTTP 404",
    });
    expect(await fetchSourceText("https://www.gov.cy/moh-phs", via(() => respond("denied", "text/html", 403)))).toEqual({
      state: "unreachable",
      detail: "сайт не пускает автоматическую проверку (HTTP 403)",
    });
  });

  it("stops a response that hangs after the headers", async () => {
    vi.spyOn(SOURCE_LIMITS, "timeoutMs", "get").mockReturnValue(200);
    const hanging = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<p>start"));
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const response = hanging();
      const reader = response.body!.getReader();
      // Behave like a real transport: the request's signal aborts the body stream.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
          void reader.read().then(({ value }) => value && controller.enqueue(value));
        },
      });
      return new Response(body, { headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const started = Date.now();
    const result = await fetchSourceText("https://www.gesy.org.cy/slow", { transport });
    expect(result).toMatchObject({ state: "unreachable", detail: expect.stringContaining("прервалась") });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("SSRF protection", () => {
  const INTERNAL = [
    "127.0.0.1",
    "127.8.8.8",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
  ];
  const INTERNAL_V6 = ["::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.5", "64:ff9b::7f00:1", "2002:7f00:1::1"];

  it("never requests a public-looking host name that resolves to an internal IPv4 or IPv6 address", async () => {
    for (const address of [...INTERNAL, ...INTERNAL_V6]) {
      vi.restoreAllMocks();
      stubDns(() => (address.includes(":") ? { v6: [address] } : { v4: [address] }));
      const transport = vi.fn(async () => respond("<p>secret</p>", "text/html"));
      const result = await fetchSourceText("https://127.0.0.1.nip.io/latest/meta-data/", { transport: transport as unknown as typeof fetch });
      expect([address, result.state]).toEqual([address, "not_allowed"]);
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it("refuses a host with one internal record among public ones, and a host that does not resolve", async () => {
    const transport = vi.fn(async () => respond("<p>secret</p>", "text/html"));
    vi.restoreAllMocks();
    stubDns(() => ({ v4: [PUBLIC_IP, "10.0.0.5"] }));
    expect(await fetchSourceText("https://mixed.example.com/", { transport: transport as unknown as typeof fetch })).toMatchObject({ state: "not_allowed" });
    vi.restoreAllMocks();
    stubDns(() => ({ v4: [PUBLIC_IP], v6: ["::1"] }));
    expect(await fetchSourceText("https://mixed6.example.com/", { transport: transport as unknown as typeof fetch })).toMatchObject({ state: "not_allowed" });
    vi.restoreAllMocks();
    stubDns(() => ({}));
    expect(await fetchSourceText("https://no-such-host.example.com/", { transport: transport as unknown as typeof fetch })).toMatchObject({ state: "not_allowed" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("makes no connection to an internal service behind a host name (real transport)", async () => {
    const service = await internalService();
    try {
      vi.restoreAllMocks();
      stubDns(() => ({ v4: ["127.0.0.1"] }));
      const result = await fetchSourceText(`https://127.0.0.1.nip.io:${service.port}/`);
      expect(result.state).toBe("not_allowed");
      expect((await checkSourceLinks([`https://127.0.0.1.nip.io:${service.port}/`]))[0]).toMatchObject({ state: "broken", status: null });
      expect(service.connections()).toBe(0);
      // Control: the listener does notice a connection when one is made.
      await new Promise<void>((resolve) => net.connect(service.port, "127.0.0.1").on("close", () => resolve()));
      expect(service.connections()).toBe(1);
    } finally {
      await service.close();
    }
  });

  it("DNS rebinding: a public answer for the check and an internal one for the connection reaches nothing", async () => {
    const service = await internalService();
    try {
      vi.restoreAllMocks();
      // First answer (the check before the request) is public; every later answer is internal.
      stubDns((_host, call) => ({ v4: [call === 0 ? PUBLIC_IP : "127.0.0.1"] }));
      const result = await fetchSourceText(`https://rebind.example.com:${service.port}/`);
      // Refused by the second lookup, the one the socket itself uses: the name was resolved twice.
      expect(result.state).toBe("not_allowed");
      expect(vi.mocked(dns.promises.Resolver.prototype.resolve4)).toHaveBeenCalledTimes(2);
      expect(service.connections()).toBe(0);
    } finally {
      await service.close();
    }
  });

  it("checks every redirect hop and refuses internal, plain-http and IP-literal targets", async () => {
    vi.restoreAllMocks();
    stubDns((host) => ({ v4: [host === "intranet.example.com" ? "10.0.0.5" : PUBLIC_IP] }));
    for (const target of [
      "https://intranet.example.com/admin",
      "https://127.0.0.1/admin",
      "https://[::1]/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://www.gov.cy/plain",
      "file:///etc/passwd",
    ]) {
      const transport = vi.fn(async () => redirect(target));
      const result = await fetchSourceText("https://www.gov.cy/start", { transport: transport as unknown as typeof fetch });
      expect([target, result.state]).toEqual([target, "not_allowed"]);
      // Only the first, public address was requested; the redirect target never was.
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it("follows at most 5 redirects", async () => {
    const chain = (hops: number) => {
      let served = 0;
      return vi.fn(async () => {
        served += 1;
        return served <= hops ? redirect(`https://www.gov.cy/hop-${served}`) : respond("<p>" + "Final page text. ".repeat(5) + "</p>", "text/html");
      });
    };
    const five = chain(5);
    expect(await fetchSourceText("https://www.gov.cy/start", { transport: five as unknown as typeof fetch })).toMatchObject({ state: "ok" });
    expect(five).toHaveBeenCalledTimes(6);
    const six = chain(6);
    expect(await fetchSourceText("https://www.gov.cy/start", { transport: six as unknown as typeof fetch })).toMatchObject({
      state: "unreachable",
      detail: "больше 5 перенаправлений или неверное перенаправление",
    });
    expect(six).toHaveBeenCalledTimes(6);
  });

  it("does not request a URL that is not public https at all", async () => {
    const transport = vi.fn();
    for (const url of ["http://www.gov.cy/plain", "https://169.254.169.254/latest/meta-data/", "https://localhost/", "https://[fd00::1]/"]) {
      expect(await fetchSourceText(url, { transport: transport as unknown as typeof fetch })).toMatchObject({ state: "not_allowed" });
    }
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("verifyClaims", () => {
  it("downloads each source once and evaluates every quote against it", async () => {
    const transport = vi.fn(async () =>
      respond("<p>Beneficiaries pay a co-payment of €1 per visit to a personal doctor.</p>", "text/html"),
    );
    const url = "https://www.gesy.org.cy/en-us/faq";
    const entries = await verifyClaims(
      [
        { claim: "A", importance: "critical", source_url: url, quote: "pay a co-payment of €1 per visit" },
        { claim: "B", importance: "critical", source_url: url, quote: "Registration must be renewed every year" },
      ],
      [],
      { transport: transport as unknown as typeof fetch },
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(entries.map((e) => e.state)).toEqual(["quote_found", "quote_not_found"]);
  });

  it("keeps an official source that refuses automated requests: the claim and its link stay for a manual check", async () => {
    const url = "https://www.gov.cy/moh-phs";
    const transport = vi.fn(async () => respond("Access denied", "text/html", 403));
    const entries = await verifyClaims(
      [
        { claim: "Аптеки дежурят по графику Фармацевтической службы", importance: "critical", source_url: url, quote: "night pharmacies are published by the Pharmaceutical Services" },
        { claim: "Страницу не удалось прочитать при поиске", importance: "critical", source_url: url, quote: "" },
      ],
      [],
      { transport: transport as unknown as typeof fetch },
    );
    expect(entries.map((e) => [e.sourceUrl, e.state, e.detail])).toEqual([
      [url, "source_unavailable", "сайт не пускает автоматическую проверку (HTTP 403)"],
      [url, "no_quote", "нет цитаты из источника"],
    ]);
  });
});
