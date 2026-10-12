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

  const expectedSecret = process.env.VEYRA_INTERNAL_SECRET || "";
  const suppliedSecret = req.headers["x-veyra-internal-secret"] || "";

  if (!expectedSecret || !safeEqual(suppliedSecret, expectedSecret)) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED"
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

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
    const { orchestrateStudio } = await import(
      "./_v4-engine.mjs"
    );

    const result = await orchestrateStudio({
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
    });

    console.log(
      `[V4 NODE] complete | engine=${result.engine} | score=${result.quality?.score ?? "?"}`
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
