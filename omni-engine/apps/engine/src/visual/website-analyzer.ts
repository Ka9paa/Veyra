import { chromium, type Route } from "playwright-core";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export interface WebsiteReference {
  url: string;
  finalUrl: string;
  title: string;
  description: string;
  headings: string[];
  navigation: string[];
  buttons: string[];
  links: string[];
  images: string[];
  colors: string[];
  fonts: string[];
  visibleText: string;
  screenshotBase64: string;
  bodyHeight: number;
}

function extractFirstUrl(prompt: string): string | null {
  const match = String(prompt || "").match(/https?:\/\/[^\s<>"'`)\]}]+/i);

  if (!match) {
    return null;
  }

  return match[0].replace(/[.,;:!?]+$/, "");
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && parts[2] === 0) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isUnsafeHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  if (isIP(host) === 4 && isPrivateIPv4(host)) {
    return true;
  }

  if (isIP(host) === 6) {
    const normalized = host.toLowerCase();

    if (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    ) {
      return true;
    }
  }

  return false;
}

function validatePublicUrl(raw: string): URL {
  const parsed = new URL(raw);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Website Analyzer only supports HTTP(S) URLs.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Website Analyzer does not allow credentialed URLs.");
  }

  if (isUnsafeHostname(parsed.hostname)) {
    throw new Error("Website Analyzer rejected a local/private hostname.");
  }

  return parsed;
}

function isUnsafeAddress(address: string): boolean {
  const normalized = address.toLowerCase();

  if (isIP(normalized) === 4) {
    return isPrivateIPv4(normalized);
  }

  if (isIP(normalized) === 6) {
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
    );
  }

  return true;
}

async function assertPublicDestination(url: URL): Promise<void> {
  if (isUnsafeHostname(url.hostname)) {
    throw new Error("Website Analyzer rejected a local/private hostname.");
  }

  if (isIP(url.hostname)) {
    if (isUnsafeAddress(url.hostname)) {
      throw new Error("Website Analyzer rejected a private IP address.");
    }

    return;
  }

  const resolved = await lookup(url.hostname, {
    all: true,
    verbatim: true
  });

  if (!resolved.length) {
    throw new Error("Website Analyzer could not resolve the hostname.");
  }

  if (resolved.some(result => isUnsafeAddress(result.address))) {
    throw new Error(
      "Website Analyzer rejected a hostname resolving to a private/local address."
    );
  }
}

async function launchAnalyzerBrowser(): Promise<any> {
  const isVercel = Boolean(process.env.VERCEL);

  if (isVercel) {
    const [{ chromium: serverlessChromium }, { default: sparticuzChromium }] =
      await Promise.all([
        import("playwright-core"),
        import("@sparticuz/chromium")
      ]);

    sparticuzChromium.setGraphicsMode = false;

    const executablePath = await sparticuzChromium.executablePath();

    return serverlessChromium.launch({
      args: sparticuzChromium.args,
      executablePath,
      headless: true
    });
  }

  return chromium.launch({ headless: true });
}

export function findWebsiteReferenceUrl(prompt: string): string | null {
  return extractFirstUrl(prompt);
}

export async function analyzeWebsiteReference(
  prompt: string,
  width = 1440,
  height = 900
): Promise<WebsiteReference | null> {
  const detected = extractFirstUrl(prompt);

  if (!detected) {
    return null;
  }

  let requestedUrl: URL;

  try {
    requestedUrl = validatePublicUrl(detected);
    await assertPublicDestination(requestedUrl);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `[V4 WEBSITE ANALYZER] rejected | url=${detected} | error=${detail}`
    );

    return null;
  }

  console.error(
    `[V4 WEBSITE ANALYZER] analyzing ${requestedUrl.toString()}`
  );

  let browser: any = null;

  try {
    browser = await launchAnalyzerBrowser();

    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1
    });

    page.setDefaultNavigationTimeout(15000);
    page.setDefaultTimeout(10000);

    await page.route("**/*", async (route: Route) => {
      const requestUrl = route.request().url();

      if (
        requestUrl.startsWith("data:") ||
        requestUrl.startsWith("blob:") ||
        requestUrl === "about:blank"
      ) {
        await route.continue();
        return;
      }

      let target: URL;

      try {
        target = validatePublicUrl(requestUrl);
        await assertPublicDestination(target);
      } catch {
        console.error(
          `[V4 WEBSITE ANALYZER] blocked request | url=${requestUrl}`
        );

        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
    });

    const response = await page.goto(requestedUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 15000
    });

    if (response && response.status() >= 400) {
      throw new Error(
        `Website returned HTTP ${response.status()}.`
      );
    }

    await page.waitForTimeout(1500);

    const finalUrlObject = validatePublicUrl(page.url());
    await assertPublicDestination(finalUrlObject);
    const finalUrl = finalUrlObject.toString();

    const data = await page.evaluate(
      `(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const unique = values =>
          Array.from(new Set(values.map(clean).filter(Boolean)));

        const visible = element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);

          return (
            rect.width > 1 &&
            rect.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          );
        };

        const headings = unique(
          Array.from(document.querySelectorAll("h1,h2,h3"))
            .filter(visible)
            .map(el => el.textContent)
        ).slice(0, 30);

        const navigation = unique(
          Array.from(
            document.querySelectorAll(
              "nav a, header a, [role='navigation'] a"
            )
          )
            .filter(visible)
            .map(el => el.textContent)
        ).slice(0, 30);

        const buttons = unique(
          Array.from(
            document.querySelectorAll(
              "button, [role='button'], a[class*='btn'], a[class*='button'], a[class*='cta']"
            )
          )
            .filter(visible)
            .map(el => el.textContent)
        ).slice(0, 30);

        const links = unique(
          Array.from(document.querySelectorAll("a[href]"))
            .filter(visible)
            .map(el => {
              const label = clean(el.textContent);
              const href = el.href || "";
              return label ? label + " -> " + href : href;
            })
        ).slice(0, 50);

        const images = unique(
          Array.from(document.querySelectorAll("img"))
            .filter(visible)
            .map(img => {
              const alt = clean(img.alt);
              const src = img.currentSrc || img.src || "";
              return alt ? alt + " -> " + src : src;
            })
        ).slice(0, 30);

        const sampled = Array.from(
          document.querySelectorAll(
            "body,header,nav,main,section,article,aside,footer,h1,h2,h3,p,a,button"
          )
        )
          .filter(visible)
          .slice(0, 250);

        const colors = unique(
          sampled.flatMap(el => {
            const style = getComputedStyle(el);
            return [
              style.color,
              style.backgroundColor,
              style.borderColor
            ];
          })
        )
          .filter(
            value =>
              value &&
              value !== "rgba(0, 0, 0, 0)" &&
              value !== "transparent"
          )
          .slice(0, 24);

        const fonts = unique(
          sampled.map(el => getComputedStyle(el).fontFamily)
        ).slice(0, 12);

        const description =
          document.querySelector('meta[name="description"]')
            ?.getAttribute("content") || "";

        const visibleText = clean(document.body.innerText).slice(0, 12000);

        return {
          title: clean(document.title),
          description: clean(description),
          headings,
          navigation,
          buttons,
          links,
          images,
          colors,
          fonts,
          visibleText,
          bodyHeight: Math.round(
            document.documentElement.scrollHeight ||
            document.body.scrollHeight ||
            0
          )
        };
      })()`
    ) as Omit<
      WebsiteReference,
      "url" | "finalUrl" | "screenshotBase64"
    >;

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false
    });

    console.error(
      `[V4 WEBSITE ANALYZER] complete | title=${JSON.stringify(data.title)} | text=${data.visibleText.length}`
    );

    return {
      url: requestedUrl.toString(),
      finalUrl,
      ...data,
      screenshotBase64: screenshot.toString("base64")
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `[V4 WEBSITE ANALYZER] skipped | url=${requestedUrl.toString()} | error=${detail}`
    );

    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
