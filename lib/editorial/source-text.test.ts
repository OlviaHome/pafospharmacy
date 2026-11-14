import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

function respond(body: BodyInit | null, type: string, status = 200, url = "") {
  const response = new Response(body, { status, headers: { "content-type": type } });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
}

afterEach(() => vi.unstubAllGlobals());

describe("isFetchableSourceUrl", () => {
  it("allows public https hosts only", () => {
    expect(isFetchableSourceUrl("https://www.gesy.org.cy/en-us/faq")).toBe(true);
    for (const bad of [
      "http://www.gesy.org.cy/",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://router.local/x",
      "https://user:pass@gov.cy/x",
      "not a url",
    ]) {
      expect(isFetchableSourceUrl(bad)).toBe(false);
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

  it("reads HTML pages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(`<html><body><p>${LONG}</p></body></html>`, "text/html")));
    expect(await fetchSourceText("https://www.gesy.org.cy/en-us/faq")).toEqual({ state: "ok", kind: "html", text: LONG });
  });

  it("reads text PDFs from official sites", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(pdf(LONG), "application/pdf")));
    const result = await fetchSourceText("https://www.moh.gov.cy/fees.pdf");
    expect(result).toMatchObject({ state: "ok", kind: "pdf" });
    expect(result.state === "ok" && result.text).toContain("co-payment of 1 euro");
  });

  it("does not parse PDFs from unofficial sites", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(pdf(LONG), "application/pdf")));
    expect(await fetchSourceText("https://example-blog.com/fees.pdf")).toMatchObject({ state: "no_text" });
  });

  it("leaves a PDF without a text layer to the editor (no OCR)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(pdf(""), "application/pdf")));
    expect(await fetchSourceText("https://www.moh.gov.cy/scan.pdf")).toMatchObject({ state: "no_text" });
  });

  it("refuses oversized files and pages that need JavaScript", async () => {
    const big = new Uint8Array(SOURCE_LIMITS.maxPdfBytes + 1);
    vi.stubGlobal("fetch", vi.fn(async () => respond(big, "application/pdf")));
    expect(await fetchSourceText("https://www.moh.gov.cy/big.pdf")).toMatchObject({ state: "no_text", detail: "PDF больше 10 МБ" });

    vi.stubGlobal("fetch", vi.fn(async () => respond("<div id=app></div><script>render()</script>", "text/html")));
    expect(await fetchSourceText("https://www.gesy.org.cy/app")).toMatchObject({ state: "no_text" });
  });

  it("reports errors and redirects to disallowed hosts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond("missing", "text/html", 404)));
    expect(await fetchSourceText("https://www.gov.cy/missing")).toMatchObject({ state: "unreachable", detail: "HTTP 404" });

    vi.stubGlobal("fetch", vi.fn(async () => respond(LONG, "text/html", 200, "https://127.0.0.1/admin")));
    expect(await fetchSourceText("https://www.gov.cy/redirect")).toMatchObject({ state: "not_allowed" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSourceText("http://www.gov.cy/plain")).toMatchObject({ state: "not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyClaims", () => {
  it("downloads each source once and evaluates every quote against it", async () => {
    const fetchMock = vi.fn(async () =>
      respond("<p>Beneficiaries pay a co-payment of €1 per visit to a personal doctor.</p>", "text/html"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://www.gesy.org.cy/en-us/faq";
    const entries = await verifyClaims(
      [
        { claim: "A", importance: "critical", source_url: url, quote: "pay a co-payment of €1 per visit" },
        { claim: "B", importance: "critical", source_url: url, quote: "Registration must be renewed every year" },
      ],
      [],
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(entries.map((e) => e.state)).toEqual(["quote_found", "quote_not_found"]);
  });
});
