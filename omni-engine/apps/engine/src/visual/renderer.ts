import { chromium } from "playwright";

export interface RenderInput {
  title?: string;
  html: string;
  css: string;
  js: string;
  width?: number;
  height?: number;
}

export interface RenderDiagnostics {
  brokenImages: string[];
  consoleErrors: string[];
  pageErrors: string[];
  horizontalOverflow: boolean;
  visibleImages: number;
  visibleButtons: number;
  visibleSections: number;
  firstViewportElements: number;
  firstViewportImages: number;
  firstViewportButtons: number;
  bodyHeight: number;
  bodyWidth: number;
  textCharacters: number;
  hardFailures: string[];
}

export interface RenderResult {
  screenshotBase64: string;
  fullPageScreenshotBase64: string;
  diagnostics: RenderDiagnostics;
}

function safeScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

export async function renderWebsite(
  input: RenderInput
): Promise<RenderResult> {
  const width = input.width ?? 1440;
  const height = input.height ?? 900;

  const executablePath =
    process.env.VEYRA_CHROMIUM_EXECUTABLE || undefined;

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });

  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1
    });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", message => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    page.on("pageerror", error => {
      pageErrors.push(error.message);
    });

    const pageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${input.title ?? "Veyra Preview"}</title>
<style>
html,body{margin:0;min-height:100%}
*,*::before,*::after{box-sizing:border-box}
${input.css}
</style>
</head>
<body>
${input.html}
<script>
${safeScript(input.js)}
</script>
</body>
</html>`;

    await page.setContent(pageHtml, {
      waitUntil: "load",
      timeout: 30000
    });

    await page.waitForTimeout(1800);

    const diagnostics = await page.evaluate(
      `(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;

        const images = Array.from(document.querySelectorAll("img"));
        const all = Array.from(document.body.querySelectorAll("*"));

        const sections = Array.from(
          document.querySelectorAll(
            "main > section, body > section, main > div, [data-section]"
          )
        );

        const buttons = Array.from(
          document.querySelectorAll(
            'button, [role="button"], a[class*="btn"], a[class*="button"], a[class*="cta"]'
          )
        );

        const visibleImages = images.filter(el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            r.width > 1 &&
            r.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          );
        }).length;

        const visibleButtons = buttons.filter(el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            r.width > 1 &&
            r.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          );
        }).length;

        const visibleSections = sections.filter(el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            r.width > 1 &&
            r.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          );
        }).length;

        const firstViewportElements = all.filter(el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            r.width > 1 &&
            r.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0 &&
            r.bottom > 0 &&
            r.top < height &&
            r.right > 0 &&
            r.left < width
          );
        }).length;

        const firstViewportImages = images.filter(el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            r.width > 1 &&
            r.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0 &&
            r.bottom > 0 &&
            r.top < height &&
            r.right > 0 &&
            r.left < width
          );
        }).length;

        const firstViewportButtons = buttons.filter(el => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            r.width > 1 &&
            r.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0 &&
            r.bottom > 0 &&
            r.top < height &&
            r.right > 0 &&
            r.left < width
          );
        }).length;

        const brokenImages = images
          .filter(
            img =>
              !img.complete ||
              img.naturalWidth <= 1 ||
              img.naturalHeight <= 1
          )
          .map(
            img =>
              img.currentSrc ||
              img.src ||
              "[image without src]"
          );

        const bodyRect =
          document.body.getBoundingClientRect();

        return {
          brokenImages,

          horizontalOverflow:
            document.documentElement.scrollWidth >
            width + 4,

          visibleImages,
          visibleButtons,
          visibleSections,
          firstViewportElements,
          firstViewportImages,
          firstViewportButtons,

          bodyHeight:
            Math.round(bodyRect.height),

          bodyWidth:
            Math.round(bodyRect.width),

          textCharacters:
            (document.body.innerText || "")
              .replace(/\\s+/g, " ")
              .trim().length
        };
      })()`
    ) as {
      brokenImages: string[];
      horizontalOverflow: boolean;
      visibleImages: number;
      visibleButtons: number;
      visibleSections: number;
      firstViewportElements: number;
      firstViewportImages: number;
      firstViewportButtons: number;
      bodyHeight: number;
      bodyWidth: number;
      textCharacters: number;
    };

    const hardFailures: string[] = [];

    if (diagnostics.brokenImages.length) {
      hardFailures.push(
        `${diagnostics.brokenImages.length} broken image(s) detected`
      );
    }

    if (diagnostics.horizontalOverflow) {
      hardFailures.push("Page has horizontal viewport overflow");
    }

    if (diagnostics.bodyHeight < height * 1.8) {
      hardFailures.push("Page is visually too shallow");
    }

    if (diagnostics.textCharacters < 350) {
      hardFailures.push("Page lacks meaningful content");
    }

    if (diagnostics.firstViewportElements < 8) {
      hardFailures.push("First viewport is visually underdeveloped");
    }

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false
    });

    const fullPageScreenshot = await page.screenshot({
      type: "png",
      fullPage: true
    });

    return {
      screenshotBase64: screenshot.toString("base64"),
      fullPageScreenshotBase64: fullPageScreenshot.toString("base64"),

      diagnostics: {
        ...diagnostics,
        consoleErrors,
        pageErrors,
        hardFailures
      }
    };
  } finally {
    await browser.close();
  }
}
