import { chromium } from "playwright-core";

export interface RequiredVisualInput {
  id: string;
  url: string;
  intendedSection?: string;
}

export interface RenderInput {
  title?: string;
  html: string;
  css: string;
  js: string;
  width?: number;
  height?: number;
  requiredSectionIds?: string[];
  requiredActionIds?: string[];
  requiredVisuals?: RequiredVisualInput[];
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

  deadHashLinks: string[];
  emptyLinks: string[];
  missingInternalTargets: string[];
  inertButtons: string[];
  duplicateIds: string[];
  emptySections: string[];

  requiredSectionIds: string[];
  foundSectionIds: string[];
  missingSectionIds: string[];
  duplicateSectionMarkers: string[];
  hiddenSectionMarkers: string[];

  requiredActionIds: string[];
  foundActionIds: string[];
  missingActionIds: string[];

  requiredVisualUrls: string[];
  foundRequiredVisualUrls: string[];
  missingRequiredVisualUrls: string[];
  hiddenRequiredVisualUrls: string[];
  brokenRequiredVisualUrls: string[];
  heroRequiredVisualUrls: string[];
  heroProminentVisualUrls: string[];
  heroUnderProminentVisualUrls: string[];
  duplicateActionMarkers: string[];
  hiddenActionMarkers: string[];
  invalidActionMarkers: string[];

  interactionTestedActionIds: string[];
  interactionPassedActionIds: string[];
  interactionFailedActionIds: string[];
  interactionFailures: string[];

  completionFailures: string[];

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

  console.error("[V4 BROWSER] chromium.launch START");

  const isVercel = Boolean(process.env.VERCEL);

  let browser;

  if (isVercel) {
    const [{ chromium: serverlessChromium }, { default: sparticuzChromium }] =
      await Promise.all([
        import("playwright-core"),
        import("@sparticuz/chromium")
      ]);

    // Veyra renders standard HTML/CSS websites and does not require WebGL.
    // Disabling Sparticuz graphics mode avoids extracting/loading SwiftShader
    // in Vercel's constrained /tmp filesystem, leaving more room for screenshots.
    sparticuzChromium.setGraphicsMode = false;

    const executablePath = await sparticuzChromium.executablePath();

    console.error(
      `[V4 BROWSER] serverless executable=${executablePath} | graphicsMode=disabled`
    );

    browser = await serverlessChromium.launch({
      args: sparticuzChromium.args,
      executablePath,
      headless: true
    });
  } else {
    browser = await chromium.launch({ headless: true });
  }

  console.error("[V4 BROWSER] chromium.launch DONE");

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

        const requiredSectionIds = ${JSON.stringify(
          input.requiredSectionIds ?? []
        )};

        const requiredActionIds = ${JSON.stringify(
          input.requiredActionIds ?? []
        )};

        const requiredVisuals = ${JSON.stringify(
          input.requiredVisuals ?? []
        )};

        const requiredVisualUrls =
          requiredVisuals.map(item => item.url);

        const images = Array.from(document.querySelectorAll("img"));
        const all = Array.from(document.body.querySelectorAll("*"));

        const backgroundVisuals = all
          .map(el => {
            const style = getComputedStyle(el);
            const backgroundImage = style.backgroundImage || "";

            const urls = [];
            const urlPattern = /url\\((?:["']?)(.*?)(?:["']?)\\)/g;
            let match;

            while ((match = urlPattern.exec(backgroundImage)) !== null) {
              const raw = String(match[1] || "")
                .trim()
                .replace(/^["']|["']$/g, "");

              if (raw) {
                urls.push(raw);
              }
            }

            return {
              el,
              urls
            };
          })
          .filter(item => item.urls.length > 0);

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

        const normalizeLabel = el =>
          (
            el.getAttribute("aria-label") ||
            el.textContent ||
            el.id ||
            el.getAttribute("href") ||
            el.tagName
          )
            .replace(/\\s+/g, " ")
            .trim()
            .slice(0, 120);

        const links = Array.from(
          document.querySelectorAll("a")
        );

        const deadHashLinks = links
          .filter(a => (a.getAttribute("href") || "").trim() === "#")
          .map(normalizeLabel);

        const emptyLinks = links
          .filter(a => {
            const href = (a.getAttribute("href") || "").trim();
            return !href;
          })
          .map(normalizeLabel);

        const missingInternalTargets = links
          .filter(a => {
            const href = (a.getAttribute("href") || "").trim();

            if (
              !href.startsWith("#") ||
              href === "#" ||
              href.length < 2
            ) {
              return false;
            }

            try {
              const id = decodeURIComponent(href.slice(1));
              return !document.getElementById(id);
            } catch {
              return true;
            }
          })
          .map(a => {
            const href = (a.getAttribute("href") || "").trim();
            return normalizeLabel(a) + " -> " + href;
          });

        const clickableButtons = Array.from(
          document.querySelectorAll(
            'button, [role="button"]'
          )
        );

        const inertButtons = clickableButtons
          .filter(el => {
            if (
              el.hasAttribute("disabled") ||
              el.getAttribute("aria-disabled") === "true"
            ) {
              return false;
            }

            if (el.tagName.toLowerCase() === "button") {
              const type =
                (el.getAttribute("type") || "submit").toLowerCase();

              if (type === "submit" && el.closest("form")) {
                return false;
              }
            }

            if (el.closest("a[href]")) {
              return false;
            }

            const inlineHandler =
              el.getAttribute("onclick") ||
              el.getAttribute("onpointerup") ||
              el.getAttribute("onmouseup");

            if (inlineHandler) {
              return false;
            }

            const behaviorHints = [
              "data-veyra-action",
              "data-action",
              "data-target",
              "data-toggle",
              "data-modal",
              "aria-controls"
            ];

            if (
              behaviorHints.some(name =>
                Boolean(el.getAttribute(name))
              )
            ) {
              return false;
            }

            /*
             * addEventListener handlers cannot be reliably discovered from
             * DOM attributes. Avoid false positives for common JS-controlled
             * navigation/menu controls and only flag buttons with no obvious
             * semantic or structural behavior.
             */
            const idClass = ((el.id || "") + " " + (el.className || "")).toLowerCase();

            if (
              /menu|nav|toggle|close|open|modal|accordion|tab|carousel|slider|review|prev|next|previous|pagination|pager/.test(
                idClass
              )
            ) {
              return false;
            }

            return true;
          })
          .map(normalizeLabel);

        const ids = Array.from(
          document.querySelectorAll("[id]")
        )
          .map(el => el.id)
          .filter(Boolean);

        const duplicateIds = Array.from(
          new Set(
            ids.filter(
              (id, index) => ids.indexOf(id) !== index
            )
          )
        );

        const semanticSections = Array.from(
          document.querySelectorAll(
            "section, [data-section]"
          )
        );

        const emptySections = semanticSections
          .filter(el => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              rect.width <= 1 ||
              rect.height <= 1
            ) {
              return false;
            }

            const meaningfulText =
              (el.textContent || "")
                .replace(/\\s+/g, " ")
                .trim().length;

            const meaningfulMedia =
              el.querySelector(
                "img,svg,video,canvas,picture,iframe"
              );

            return meaningfulText < 20 && !meaningfulMedia;
          })
          .map(el =>
            (
              el.id ||
              el.getAttribute("data-section") ||
              el.getAttribute("aria-label") ||
              el.tagName
            )
              .toString()
              .slice(0, 120)
          );

        /*
         * PHOTOGRAPHIC SUBJECT QA
         *
         * Large SVG/canvas artwork must not silently stand in for real
         * photographic subject matter in the first viewport.
         *
         * Small SVG icons/logos remain allowed. This only flags dominant
         * first-viewport vector/canvas compositions when there is no
         * meaningful raster/photo treatment competing with them.
         */
        const viewportArea = Math.max(
          1,
          window.innerWidth * window.innerHeight
        );

        const firstViewportMedia = Array.from(
          document.querySelectorAll("img,picture,svg,canvas")
        ).filter(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            rect.width > 1 &&
            rect.height > 1 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          );
        });

        const meaningfulFirstViewportRasterImages =
          firstViewportMedia.filter(el => {
            const tag = el.tagName.toLowerCase();

            if (tag !== "img" && tag !== "picture") {
              return false;
            }

            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;

            return (
              rect.width >= 220 &&
              rect.height >= 160 &&
              area / viewportArea >= 0.08
            );
          });

        const dominantFirstViewportSyntheticVisuals =
          firstViewportMedia
            .filter(el => {
              const tag = el.tagName.toLowerCase();

              if (tag !== "svg" && tag !== "canvas") {
                return false;
              }

              const rect = el.getBoundingClientRect();
              const area = rect.width * rect.height;

              // Deliberately high enough that ordinary icons/logos do not
              // trigger this rule. We are targeting hero-scale artwork.
              return (
                rect.width >= 320 &&
                rect.height >= 260 &&
                area / viewportArea >= 0.16
              );
            })
            .map(el => {
              const rect = el.getBoundingClientRect();

              return {
                tag: el.tagName.toLowerCase(),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                areaRatio: Number(
                  (
                    (rect.width * rect.height) /
                    viewportArea
                  ).toFixed(3)
                ),
                id: (el.id || "").slice(0, 120),
                className:
                  typeof el.className === "string"
                    ? el.className.slice(0, 160)
                    : ""
              };
            });

        const dominantSyntheticWithoutPhotography =
          dominantFirstViewportSyntheticVisuals.length > 0 &&
          meaningfulFirstViewportRasterImages.length === 0;

        const isVisible = el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);

          return (
            rect.width > 1 &&
            rect.height > 1 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0
          );
        };

        const sectionMarkers = Array.from(
          document.querySelectorAll("[data-veyra-section]")
        );

        const actionMarkers = Array.from(
          document.querySelectorAll("[data-veyra-action]")
        );

        const foundSectionIds = Array.from(
          new Set(
            sectionMarkers
              .map(el =>
                (el.getAttribute("data-veyra-section") || "").trim()
              )
              .filter(Boolean)
          )
        );

        const foundActionIds = Array.from(
          new Set(
            actionMarkers
              .map(el =>
                (el.getAttribute("data-veyra-action") || "").trim()
              )
              .filter(Boolean)
          )
        );

        const missingSectionIds = requiredSectionIds.filter(
          id => !foundSectionIds.includes(id)
        );

        const missingActionIds = requiredActionIds.filter(
          id => !foundActionIds.includes(id)
        );

        const duplicateSectionMarkers = requiredSectionIds.filter(
          id =>
            document.querySelectorAll(
              '[data-veyra-section="' +
                CSS.escape(id) +
                '"]'
            ).length > 1
        );

        const duplicateActionMarkers = requiredActionIds.filter(
          id =>
            document.querySelectorAll(
              '[data-veyra-action="' +
                CSS.escape(id) +
                '"]'
            ).length > 1
        );

        const hiddenSectionMarkers = requiredSectionIds.filter(
          id => {
            const el = document.querySelector(
              '[data-veyra-section="' +
                CSS.escape(id) +
                '"]'
            );

            return Boolean(el) && !isVisible(el);
          }
        );

        const hiddenActionMarkers = requiredActionIds.filter(
          id => {
            const el = document.querySelector(
              '[data-veyra-action="' +
                CSS.escape(id) +
                '"]'
            );

            return Boolean(el) && !isVisible(el);
          }
        );

        const invalidActionMarkers = requiredActionIds.filter(
          id => {
            const el = document.querySelector(
              '[data-veyra-action="' +
                CSS.escape(id) +
                '"]'
            );

            if (!el) {
              return false;
            }

            const tag = el.tagName.toLowerCase();

            if (tag === "a") {
              const href =
                (el.getAttribute("href") || "").trim();

              return !href || href === "#";
            }

            if (tag === "button") {
              if (
                el.hasAttribute("disabled") ||
                el.getAttribute("aria-disabled") === "true"
              ) {
                return true;
              }

              const type =
                (el.getAttribute("type") || "submit").toLowerCase();

              if (type === "submit" && el.closest("form")) {
                return false;
              }

              const hints = [
                "onclick",
                "onpointerup",
                "onmouseup",
                "data-action",
                "data-target",
                "data-toggle",
                "data-modal",
                "aria-controls"
              ];

              if (
                hints.some(name =>
                  Boolean(el.getAttribute(name))
                )
              ) {
                return false;
              }

              const idClass =
                ((el.id || "") +
                  " " +
                  (el.className || "")).toLowerCase();

              if (
                /menu|nav|toggle|close|open|modal|accordion|tab|carousel|slider/.test(
                  idClass
                )
              ) {
                return false;
              }

              return true;
            }

            return !(
              el.getAttribute("role") === "button" ||
              el.hasAttribute("onclick")
            );
          }
        );

        const normalizeRequiredVisualUrl = value => {
          try {
            return new URL(value, document.baseURI).href;
          } catch {
            return value;
          }
        };

        const foundRequiredVisualUrls = [];
        const hiddenRequiredVisualUrls = [];
        const brokenRequiredVisualUrls = [];
        const heroRequiredVisualUrls = [];
        const heroProminentVisualUrls = [];
        const heroUnderProminentVisualUrls = [];

        const isHeroVisualRequirement = item => {
          const section =
            String(item.intendedSection || "").toLowerCase();

          const id =
            String(item.id || "").toLowerCase();

          return (
            /(^|[-_\s])hero($|[-_\s])/.test(section) ||
            /(^|[-_\s])hero($|[-_\s])/.test(id) ||
            section === "hero"
          );
        };

        for (const requiredVisual of requiredVisuals) {
          const requiredUrl = requiredVisual.url;

          const normalizedRequired =
            normalizeRequiredVisualUrl(requiredUrl);

          const imageMatches = images.filter(img => {
            const candidates = [
              img.currentSrc,
              img.src,
              img.getAttribute("src") || ""
            ]
              .filter(Boolean)
              .map(normalizeRequiredVisualUrl);

            return candidates.includes(normalizedRequired);
          });

          const backgroundMatches = backgroundVisuals.filter(item =>
            item.urls
              .map(normalizeRequiredVisualUrl)
              .includes(normalizedRequired)
          );

          if (
            imageMatches.length === 0 &&
            backgroundMatches.length === 0
          ) {
            continue;
          }

          foundRequiredVisualUrls.push(requiredUrl);

          const healthyImage = imageMatches.some(
            img =>
              img.complete &&
              img.naturalWidth > 1 &&
              img.naturalHeight > 1
          );

          const visibleHealthyImage = imageMatches.some(img => {
            const rect = img.getBoundingClientRect();
            const style = getComputedStyle(img);

            return (
              img.complete &&
              img.naturalWidth > 1 &&
              img.naturalHeight > 1 &&
              rect.width > 32 &&
              rect.height > 32 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity || "1") > 0
            );
          });

          const visibleHealthyBackground =
            backgroundMatches.some(item => {
              const rect = item.el.getBoundingClientRect();
              const style = getComputedStyle(item.el);

              return (
                rect.width > 32 &&
                rect.height > 32 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number(style.opacity || "1") > 0
              );
            });

          const hasBackgroundMatch =
            backgroundMatches.length > 0;

          const healthy =
            healthyImage || hasBackgroundMatch;

          const visibleHealthy =
            visibleHealthyImage || visibleHealthyBackground;

          if (!healthy) {
            brokenRequiredVisualUrls.push(requiredUrl);
          } else if (!visibleHealthy) {
            hiddenRequiredVisualUrls.push(requiredUrl);
          }

          if (isHeroVisualRequirement(requiredVisual)) {
            heroRequiredVisualUrls.push(requiredUrl);

            const viewportArea =
              Math.max(1, width * height);

            const prominentRect = (rect, style) => {
              const left =
                Math.max(0, rect.left);

              const right =
                Math.min(width, rect.right);

              const top =
                Math.max(0, rect.top);

              const bottom =
                Math.min(height, rect.bottom);

              const visibleWidth =
                Math.max(0, right - left);

              const visibleHeight =
                Math.max(0, bottom - top);

              const visibleArea =
                visibleWidth * visibleHeight;

              const viewportCoverage =
                visibleArea / viewportArea;

              const meaningfulDimensions =
                rect.width >= Math.min(420, width * 0.28) &&
                rect.height >= Math.min(300, height * 0.32);

              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number(style.opacity || "1") > 0 &&
                visibleArea > 0 &&
                meaningfulDimensions &&
                viewportCoverage >= 0.12
              );
            };

            const prominentImage = imageMatches.some(img => {
              const rect = img.getBoundingClientRect();
              const style = getComputedStyle(img);

              return (
                img.complete &&
                img.naturalWidth > 1 &&
                img.naturalHeight > 1 &&
                prominentRect(rect, style)
              );
            });

            const prominentBackground =
              backgroundMatches.some(item => {
                const rect = item.el.getBoundingClientRect();
                const style = getComputedStyle(item.el);

                return prominentRect(rect, style);
              });

            const heroProminent =
              prominentImage || prominentBackground;

            if (heroProminent) {
              heroProminentVisualUrls.push(requiredUrl);
            } else {
              heroUnderProminentVisualUrls.push(requiredUrl);
            }
          }
        }

        const missingRequiredVisualUrls =
          requiredVisualUrls.filter(
            url => !foundRequiredVisualUrls.includes(url)
          );

        const completionFailures = [];

        if (missingSectionIds.length) {
          completionFailures.push(
            missingSectionIds.length +
              " required section(s) missing: " +
              missingSectionIds.join(", ")
          );
        }

        if (missingActionIds.length) {
          completionFailures.push(
            missingActionIds.length +
              " required action(s) missing: " +
              missingActionIds.join(", ")
          );
        }

        if (duplicateSectionMarkers.length) {
          completionFailures.push(
            duplicateSectionMarkers.length +
              " required section marker(s) duplicated: " +
              duplicateSectionMarkers.join(", ")
          );
        }

        if (duplicateActionMarkers.length) {
          completionFailures.push(
            duplicateActionMarkers.length +
              " required action marker(s) duplicated: " +
              duplicateActionMarkers.join(", ")
          );
        }

        if (hiddenSectionMarkers.length) {
          completionFailures.push(
            hiddenSectionMarkers.length +
              " required section(s) hidden: " +
              hiddenSectionMarkers.join(", ")
          );
        }

        if (hiddenActionMarkers.length) {
          completionFailures.push(
            hiddenActionMarkers.length +
              " required action(s) hidden: " +
              hiddenActionMarkers.join(", ")
          );
        }

        if (invalidActionMarkers.length) {
          completionFailures.push(
            invalidActionMarkers.length +
              " required action(s) are not meaningfully interactive: " +
              invalidActionMarkers.join(", ")
          );
        }

        if (deadHashLinks.length) {
          completionFailures.push(
            deadHashLinks.length + ' dead href="#" link(s)'
          );
        }

        if (emptyLinks.length) {
          completionFailures.push(
            emptyLinks.length + " link(s) have no destination"
          );
        }

        if (missingInternalTargets.length) {
          completionFailures.push(
            missingInternalTargets.length + " internal navigation target(s) do not exist"
          );
        }

        if (inertButtons.length) {
          completionFailures.push(
            inertButtons.length + " button(s) have no detectable behavior"
          );
        }

        if (duplicateIds.length) {
          completionFailures.push(
            duplicateIds.length + " duplicate DOM id(s)"
          );
        }

        if (emptySections.length) {
          completionFailures.push(
            emptySections.length + " visible section(s) appear empty"
          );
        }

        if (dominantSyntheticWithoutPhotography) {
          completionFailures.push(
            "Hero-scale SVG/canvas artwork is being used without meaningful first-viewport raster photography. Real-world photographic subject matter must use real raster imagery rather than dominant vector/canvas substitutes."
          );
        }

        if (missingRequiredVisualUrls.length) {
          completionFailures.push(
            missingRequiredVisualUrls.length +
              " required generated visual(s) missing from rendered website: " +
              missingRequiredVisualUrls.join(", ")
          );
        }

        if (hiddenRequiredVisualUrls.length) {
          completionFailures.push(
            hiddenRequiredVisualUrls.length +
              " required generated visual(s) not visibly rendered: " +
              hiddenRequiredVisualUrls.join(", ")
          );
        }

        if (brokenRequiredVisualUrls.length) {
          completionFailures.push(
            brokenRequiredVisualUrls.length +
              " required generated visual(s) failed to load: " +
              brokenRequiredVisualUrls.join(", ")
          );
        }

        if (heroUnderProminentVisualUrls.length) {
          completionFailures.push(
            heroUnderProminentVisualUrls.length +
              " essential hero visual(s) failed hero prominence QA: " +
              heroUnderProminentVisualUrls.join(", ") +
              ". Hero imagery must be visibly present in the first viewport at meaningful scale."
          );
        }

        return {
          brokenImages,

          meaningfulFirstViewportRasterImageCount:
            meaningfulFirstViewportRasterImages.length,

          dominantFirstViewportSyntheticVisuals,

          dominantSyntheticWithoutPhotography,

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
              .trim().length,

          deadHashLinks,
          emptyLinks,
          missingInternalTargets,
          inertButtons,
          duplicateIds,
          emptySections,

          requiredSectionIds,
          foundSectionIds,
          missingSectionIds,
          duplicateSectionMarkers,
          hiddenSectionMarkers,

          requiredActionIds,
          foundActionIds,
          missingActionIds,
          duplicateActionMarkers,
          hiddenActionMarkers,
          invalidActionMarkers,

          requiredVisualUrls,
          foundRequiredVisualUrls,
          missingRequiredVisualUrls,
          hiddenRequiredVisualUrls,
          brokenRequiredVisualUrls,
          heroRequiredVisualUrls,
          heroProminentVisualUrls,
          heroUnderProminentVisualUrls,

          completionFailures
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
      deadHashLinks: string[];
      emptyLinks: string[];
      missingInternalTargets: string[];
      inertButtons: string[];
      duplicateIds: string[];
      emptySections: string[];

      requiredSectionIds: string[];
      foundSectionIds: string[];
      missingSectionIds: string[];
      duplicateSectionMarkers: string[];
      hiddenSectionMarkers: string[];

      requiredActionIds: string[];
      foundActionIds: string[];
      missingActionIds: string[];
      duplicateActionMarkers: string[];
      hiddenActionMarkers: string[];
      invalidActionMarkers: string[];

      requiredVisualUrls: string[];
      foundRequiredVisualUrls: string[];
      missingRequiredVisualUrls: string[];
      hiddenRequiredVisualUrls: string[];
      brokenRequiredVisualUrls: string[];
      heroRequiredVisualUrls: string[];
      heroProminentVisualUrls: string[];
      heroUnderProminentVisualUrls: string[];

      completionFailures: string[];
    };

    const interactionTestedActionIds: string[] = [];
    const interactionPassedActionIds: string[] = [];
    const interactionFailedActionIds: string[] = [];
    const interactionFailures: string[] = [];

    /*
     * Required-action interaction QA.
     *
     * We test only Veyra contract actions. We do NOT submit forms and
     * we do NOT follow external links. Internal anchors are verified by
     * destination existence. JS-driven controls are clicked and must
     * produce an observable DOM/URL/visibility/ARIA/class/text change.
     */
    for (const actionId of diagnostics.requiredActionIds) {
      if (
        diagnostics.missingActionIds.includes(actionId) ||
        diagnostics.duplicateActionMarkers.includes(actionId) ||
        diagnostics.hiddenActionMarkers.includes(actionId) ||
        diagnostics.invalidActionMarkers.includes(actionId)
      ) {
        continue;
      }

      const selector =
        '[data-veyra-action="' +
        actionId.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
        '"]';

      const locator = page.locator(selector).first();

      if ((await locator.count()) !== 1) {
        continue;
      }

      interactionTestedActionIds.push(actionId);

      try {
        const result = await locator.evaluate((node: Element) => {
          const el = node as HTMLElement;
          const tag = el.tagName.toLowerCase();

          if (tag === "a") {
            const href = (el.getAttribute("href") || "").trim();

            if (href.startsWith("#") && href.length > 1) {
              try {
                const targetId = decodeURIComponent(href.slice(1));
                return {
                  mode: "internal-link",
                  passed: Boolean(document.getElementById(targetId)),
                  detail: href
                };
              } catch {
                return {
                  mode: "internal-link",
                  passed: false,
                  detail: href
                };
              }
            }

            if (
              /^(https?:|mailto:|tel:)/i.test(href)
            ) {
              return {
                mode: "safe-destination",
                passed: true,
                detail: href
              };
            }
          }

          if (
            tag === "button" &&
            (el.getAttribute("type") || "submit").toLowerCase() === "submit" &&
            el.closest("form")
          ) {
            return {
              mode: "form-submit",
              passed: true,
              detail: "submit control belongs to a form"
            };
          }

          return {
            mode: "click",
            passed: null,
            detail: ""
          };
        });

        if (result.passed === true) {
          interactionPassedActionIds.push(actionId);
          continue;
        }

        if (result.passed === false) {
          interactionFailedActionIds.push(actionId);
          interactionFailures.push(
            actionId + ": destination does not exist (" + result.detail + ")"
          );
          continue;
        }

        const before = await page.evaluate<{
          href: string;
          hash: string;
          visibleIds: string[];
          bodyClass: string;
          htmlClass: string;
          textLength: number;
          bodyText: string;
          domState: string;
        }>(
          `(() => {
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

            const visibleIds = Array.from(
              document.querySelectorAll("[id]")
            )
              .filter(visible)
              .map(element => element.id)
              .filter(Boolean)
              .sort();

            return {
              href: location.href,
              hash: location.hash,
              visibleIds,
              bodyClass: document.body.className,
              htmlClass: document.documentElement.className,
              textLength: (document.body.innerText || "").length,
              bodyText: (document.body.innerText || "")
                .replace(/\\s+/g, " ")
                .trim(),
              domState: Array.from(
                document.querySelectorAll(
                  "[id], [aria-expanded], [aria-selected], [aria-pressed], [hidden], .active, .open, .show, .selected"
                )
              )
                .map(element => {
                  const rect = element.getBoundingClientRect();
                  const style = getComputedStyle(element);

                  return [
                    element.id || "",
                    element.className || "",
                    element.getAttribute("aria-expanded") || "",
                    element.getAttribute("aria-selected") || "",
                    element.getAttribute("aria-pressed") || "",
                    element.hasAttribute("hidden") ? "hidden" : "",
                    style.display,
                    style.visibility,
                    Number(style.opacity || "1") > 0 ? "visible" : "transparent",
                    Math.round(rect.width),
                    Math.round(rect.height)
                  ].join("|");
                })
                .join("||")
            };
          })()`
        );

        const beforeControl = await page.evaluate<{
          ariaExpanded: string | null;
          ariaSelected: string | null;
          ariaPressed: string | null;
          className: string;
          text: string;
        }>(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});

            if (!el) {
              return {
                ariaExpanded: null,
                ariaSelected: null,
                ariaPressed: null,
                className: "",
                text: ""
              };
            }

            return {
              ariaExpanded: el.getAttribute("aria-expanded"),
              ariaSelected: el.getAttribute("aria-selected"),
              ariaPressed: el.getAttribute("aria-pressed"),
              className: el.className || "",
              text: (el.textContent || "").trim()
            };
          })()`
        );

        await locator.click({
          timeout: 2500
        });

        await page.waitForTimeout(250);

        const after = await page.evaluate<{
          href: string;
          hash: string;
          visibleIds: string[];
          bodyClass: string;
          htmlClass: string;
          textLength: number;
          bodyText: string;
          domState: string;
        }>(
          `(() => {
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

            const visibleIds = Array.from(
              document.querySelectorAll("[id]")
            )
              .filter(visible)
              .map(element => element.id)
              .filter(Boolean)
              .sort();

            return {
              href: location.href,
              hash: location.hash,
              visibleIds,
              bodyClass: document.body.className,
              htmlClass: document.documentElement.className,
              textLength: (document.body.innerText || "").length,
              bodyText: (document.body.innerText || "")
                .replace(/\\s+/g, " ")
                .trim(),
              domState: Array.from(
                document.querySelectorAll(
                  "[id], [aria-expanded], [aria-selected], [aria-pressed], [hidden], .active, .open, .show, .selected"
                )
              )
                .map(element => {
                  const rect = element.getBoundingClientRect();
                  const style = getComputedStyle(element);

                  return [
                    element.id || "",
                    element.className || "",
                    element.getAttribute("aria-expanded") || "",
                    element.getAttribute("aria-selected") || "",
                    element.getAttribute("aria-pressed") || "",
                    element.hasAttribute("hidden") ? "hidden" : "",
                    style.display,
                    style.visibility,
                    Number(style.opacity || "1") > 0 ? "visible" : "transparent",
                    Math.round(rect.width),
                    Math.round(rect.height)
                  ].join("|");
                })
                .join("||")
            };
          })()`
        );

        const afterControl = await page.evaluate<{
          ariaExpanded: string | null;
          ariaSelected: string | null;
          ariaPressed: string | null;
          className: string;
          text: string;
        }>(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});

            if (!el) {
              return {
                ariaExpanded: null,
                ariaSelected: null,
                ariaPressed: null,
                className: "",
                text: ""
              };
            }

            return {
              ariaExpanded: el.getAttribute("aria-expanded"),
              ariaSelected: el.getAttribute("aria-selected"),
              ariaPressed: el.getAttribute("aria-pressed"),
              className: el.className || "",
              text: (el.textContent || "").trim()
            };
          })()`
        );

        const changed =
          before.href !== after.href ||
          before.hash !== after.hash ||
          before.bodyClass !== after.bodyClass ||
          before.htmlClass !== after.htmlClass ||
          before.textLength !== after.textLength ||
          before.bodyText !== after.bodyText ||
          before.domState !== after.domState ||
          JSON.stringify(before.visibleIds) !== JSON.stringify(after.visibleIds) ||
          beforeControl.ariaExpanded !== afterControl.ariaExpanded ||
          beforeControl.ariaSelected !== afterControl.ariaSelected ||
          beforeControl.ariaPressed !== afterControl.ariaPressed ||
          beforeControl.className !== afterControl.className ||
          beforeControl.text !== afterControl.text;

        if (changed) {
          interactionPassedActionIds.push(actionId);
        } else {
          interactionFailedActionIds.push(actionId);
          interactionFailures.push(
            actionId + ": click produced no observable behavior"
          );
        }
      } catch (error) {
        interactionFailedActionIds.push(actionId);
        interactionFailures.push(
          actionId +
            ": interaction test failed: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    if (interactionFailures.length) {
      diagnostics.completionFailures.push(
        interactionFailures.length +
          " required action interaction test(s) failed: " +
          interactionFailures.join("; ")
      );
    }

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

    for (const failure of diagnostics.completionFailures) {
      hardFailures.push(`Completion QA: ${failure}`);
    }

    if (pageErrors.length) {
      hardFailures.push(
        `Completion QA: ${pageErrors.length} uncaught page error(s)`
      );
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
        interactionTestedActionIds,
        interactionPassedActionIds,
        interactionFailedActionIds,
        interactionFailures,
        consoleErrors,
        pageErrors,
        hardFailures
      }
    };
  } finally {
    await browser.close();
  }
}
