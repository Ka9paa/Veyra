import crypto from "node:crypto";
// Playwright browsers are installed package-locally during the Vercel build.
// This MUST be set before Playwright is imported.
process.env.PLAYWRIGHT_BROWSERS_PATH = "0";



console.error(
  `[V4 NODE] chromium=${process.env.VEYRA_CHROMIUM_EXECUTABLE}`
);

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) return false;

  return crypto.timingSafeEqual(aa, bb);
}

export default async function handler(req, res) {


  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const isPreview =
      process.env.VERCEL_ENV === "preview" ||
      process.env.VERCEL_ENV === "development";

    if (!isPreview || body.browserHealth !== true) {
      const expectedSecret = process.env.VEYRA_INTERNAL_SECRET || "";
      const suppliedSecret = req.headers["x-veyra-internal-secret"] || "";

      if (!expectedSecret || !safeEqual(suppliedSecret, expectedSecret)) {
        return res.status(401).json({
          ok: false,
          error: "UNAUTHORIZED"
        });
      }
    }

    if (body.browserHealth === true) {
      const startedAt = Date.now();

      console.log("[V4 HEALTH] importing Playwright");

      const [{ chromium }, { default: sparticuzChromium }] = await Promise.all([
        import("playwright-core"),
        import("@sparticuz/chromium")
      ]);
      const executablePath = await sparticuzChromium.executablePath();


      console.log(
        `[V4 HEALTH] executable=${executablePath}`
      );

      console.log("[V4 HEALTH] launching Chromium");

      const browser = await chromium.launch({
        args: sparticuzChromium.args,
        executablePath,
        headless: true
      });

      try {
        console.log("[V4 HEALTH] Chromium launched");

        const page = await browser.newPage({
          viewport: { width: 800, height: 600 }
        });

        await page.setContent(
          "<!doctype html><html><body><h1>Veyra V4 Browser Health</h1></body></html>",
          { waitUntil: "load", timeout: 15000 }
        );

        const screenshot = await page.screenshot({
          type: "png"
        });

        console.log(
          `[V4 HEALTH] screenshot=${screenshot.length} bytes`
        );

        return res.status(200).json({
          ok: true,
          browser: "chromium",
          executablePath,
          screenshotBytes: screenshot.length,
          durationMs: Date.now() - startedAt
        });
      } finally {
        await browser.close();
        console.log("[V4 HEALTH] Chromium closed");
      }
    }

    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "PROMPT_REQUIRED"
      });
    }

    console.log(
      `[V4 NODE] starting | prompt_chars=${prompt.length} | user=${Boolean(body.userId)}`
    );

    // Import only after PLAYWRIGHT_BROWSERS_PATH is configured.
    const {
      orchestrateStudio,
      orchestrateStudioPlan,
      orchestrateStudioBuildStage,
      orchestrateStudioRecomposeStage
    } = await import("./_v4-engine.mjs");

    const buildRequest = {
      projectId:
        typeof body.projectId === "string"
          ? body.projectId
          : undefined,

      userId:
        typeof body.userId === "string"
          ? body.userId
          : undefined,

      prompt,

      current: {
        html: String(body.current?.html || ""),
        css: String(body.current?.css || ""),
        js: String(body.current?.js || "")
      },

      viewport: {
        width: Number(body.viewport?.width || 1440),
        height: Number(body.viewport?.height || 900)
      }
    };

    const stage = String(body.stage || "legacy").toLowerCase();

    console.log(`[V4 NODE] stage=${stage}`);

    let result;

    if (stage === "plan") {
      result = await orchestrateStudioPlan(buildRequest);
    } else if (stage === "build") {
      if (!body.plan) {
        return res.status(400).json({
          ok: false,
          error: "V4_PLAN_REQUIRED"
        });
      }

      result = await orchestrateStudioBuildStage(
        buildRequest,
        body.plan
      );
    } else if (stage === "recompose") {
      if (!body.plan || !body.candidate || !body.best) {
        return res.status(400).json({
          ok: false,
          error: "V4_RECOMPOSE_STATE_REQUIRED"
        });
      }

      const attempt = Number(body.attempt || 1);

      result = await orchestrateStudioRecomposeStage(
        buildRequest,
        body.plan,
        body.candidate,
        body.best,
        attempt
      );
    } else {
      // Keep the old full V4 path available until the staged
      // Studio flow has been proven in Preview.
      result = await orchestrateStudio(buildRequest);
    }

    console.log(
      `[V4 NODE] complete | stage=${result.stage || "legacy"} | complete=${result.complete ?? true}`
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("[V4 NODE] failed", error);

    return res.status(500).json({
      ok: false,
      error: "VEYRA_OMNI_V4_NODE_FAILED",
      detail:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
