import { runModel } from "../providers/model-router.js";
import { renderWebsite, type RenderDiagnostics } from "../visual/renderer.js";
import {
  critiqueScreenshot,
  type VisualReview
} from "../visual/visual-critic.js";
import {
  analyzeWebsiteReference,
  findWebsiteReferenceUrl
} from "../visual/website-analyzer.js";
import { callOpenAIVisual } from "../providers/openai.js";

export interface StudioBuildRequest {
  projectId?: string;
  userId?: string;
  prompt: string;

  current?: {
    html?: string;
    css?: string;
    js?: string;
  };

  viewport?: {
    width?: number;
    height?: number;
  };
}

export interface StudioBuildResult {
  ok: true;
  title: string;
  assistant_message: string;
  html: string;
  css: string;
  js: string;
  files: Record<string, string>;
  changed_files: string[];
  next_steps: string[];

  quality: {
    score: number;
    notes: string[];
  };

  engine: string;
}

interface SiteCode {
  title: string;
  assistant_message: string;
  html: string;
  css: string;
  js: string;
  next_steps: string[];
  quality_notes: string[];
}

interface Candidate {
  site: SiteCode;
  review: VisualReview;
  diagnostics: RenderDiagnostics;
}

function extractJson(raw: string): any {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("Model did not return valid JSON.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

function parseSite(raw: string): SiteCode {
  const x = extractJson(raw);

  const site: SiteCode = {
    title: text(x.title, "Veyra Project"),

    assistant_message: text(
      x.assistant_message,
      "Your website has been created."
    ),

    html: text(x.html),
    css: text(x.css),
    js: text(x.js),

    next_steps: list(x.next_steps),
    quality_notes: list(x.quality_notes)
  };

  if (!site.html.trim()) {
    throw new Error("Generated HTML is empty.");
  }

  if (!site.css.trim()) {
    throw new Error("Generated CSS is empty.");
  }

  return site;
}

function projectContext(req: StudioBuildRequest): string {
  return JSON.stringify(
    {
      request: req.prompt,

      viewport: {
        width: req.viewport?.width ?? 1440,
        height: req.viewport?.height ?? 900
      },

      existingProject: {
        html: text(req.current?.html).slice(0, 14000),
        css: text(req.current?.css).slice(0, 14000),
        js: text(req.current?.js).slice(0, 8000)
      }
    },
    null,
    2
  );
}

const DESIGN_DNA_SYSTEM = `
You are the Design DNA Director for Veyra.

Your job happens BEFORE frontend code exists.

Create a unique visual identity specifically for the user's project.

You are simultaneously thinking like:
- a world-class brand designer
- a digital art director
- an editorial designer
- an interaction designer
- a conversion designer

Your biggest enemy is generic AI-generated web design.

DEFINE:

1. BRAND CHARACTER
Give 3-5 highly specific characteristics.

2. VISUAL THESIS
One memorable sentence describing the central visual idea.

3. SIGNATURE MOMENT
One visual moment that makes the site recognizable.

4. COLOR LOGIC
Define:
- dominant background behavior
- primary text
- secondary text
- accent
- surface hierarchy
- contrast logic
- when accent color is allowed

Do not automatically use:
black + gold for luxury
purple + blue for technology

5. TYPOGRAPHIC PERSONALITY
Define:
- display behavior
- body behavior
- scale contrast
- casing
- weight
- tracking
- line length
- numeric styling if relevant

6. SHAPE LANGUAGE
Define:
- corner philosophy
- border philosophy
- dividers
- geometry
- masks
- frames
- image crops

7. IMAGE LANGUAGE
Define:
- subject
- lighting
- crop
- scale
- placement
- visual treatment

8. SPACING RHYTHM
Explain where the page should feel:
- dense
- open
- compressed
- dramatic

Whitespace must be intentional.
Empty space without compositional purpose is a failure.

9. MOTION LANGUAGE
Define restrained:
- entrance motion
- hover motion
- navigation motion
- image motion
- reduced-motion behavior

10. FIRST VIEWPORT
Describe exactly what should visually occupy the first 1440x900 viewport.

11. MOBILE TRANSFORMATION
Describe how the composition RECOMPOSES on mobile.
Do not merely shrink desktop.

12. ANTI-PATTERNS
List specific visual approaches that would make THIS project look generic.

Do not write HTML.
Do not write CSS.
Do not return generic design advice.

Return ONLY valid JSON.
`;

const COMPOSITION_SYSTEM = `
You are Veyra's Principal Composition Architect.

You receive:
- original project request
- Design DNA

Turn the Design DNA into a concrete spatial composition.

A great page must have a recognizable silhouette even if all text is blurred.

Choose the strongest composition for the project instead of defaulting to familiar website patterns.

POSSIBLE HERO FAMILIES INCLUDE:

CINEMATIC FULL-BLEED
Large subject-driven visual with anchored typography.

PRODUCT STAGE
The primary product dominates the visual field while copy supports it.

EDITORIAL SPLIT
Strong asymmetric division with aggressive scale contrast.

ASYMMETRIC GALLERY
Layered/cropped imagery with editorial text placement.

IMMERSIVE POSTER
The first viewport behaves almost like a campaign poster.

CONVERSION SPLIT
Clear conversion path while retaining strong visual composition.

DATA / INTERFACE STAGE
For software where the actual interface/product is the hero.

Do not mechanically choose one.
Choose based on the project.

DEFINE:

- navigation composition
- hero family
- hero height
- grid structure
- focal object
- text placement
- CTA placement
- image placement
- overlap/layering
- first viewport balance
- section sequence
- section rhythm
- density changes
- max content widths
- full-bleed moments
- constrained moments
- proof/social credibility
- conversion moments
- footer composition

FOR EVERY MAJOR SECTION DEFINE:

- purpose
- approximate height
- layout
- dominant element
- alignment
- density
- background relationship
- visual transition from previous section
- interaction

DO NOT DEFAULT TO:

- giant centered headline
- centered text floating in empty space
- three identical cards
- repeated left-text/right-image
- every section inside a rounded container
- endless bento grids
- random decorative gradients
- meaningless floating circles
- glassmorphism everywhere
- identical vertical spacing everywhere

Composition comes before decoration.

Return ONLY valid JSON.
`;

const ASSET_SYSTEM = `
You are Veyra's Visual Asset Director.

Determine what visual material the requested site needs to feel believable and premium.

Never invent local filenames.

NEVER suggest:
hero.jpg
car1.jpg
product.png
image.png
/assets/example.jpg
or any fake local asset.

Available visual strategies are:

1. credible directly-renderable HTTPS imagery,
2. inline SVG,
3. CSS-generated visual composition,
4. typography-led composition,
5. existing user-provided assets if present.

For industries where the physical subject matters, imagery is critical.

Examples:
- automotive
- fashion
- restaurants
- food
- architecture
- travel
- hotels
- real estate
- physical retail

For those projects, a design that barely shows the actual subject is a failure.

Define:

- hero visual requirement
- supporting visual requirements
- required subjects
- crop/orientation
- visual scale
- image hierarchy
- essential vs decorative assets
- fallback strategy

If you are not confident an external image URL will render directly,
do NOT invent one.

A deliberate visual fallback is better than a broken image.

Return ONLY valid JSON.
`;

const BUILDER_SYSTEM = `
You are Veyra's elite frontend designer and engineer.

You receive:
- original request
- Design DNA
- composition blueprint
- asset direction

Implement those decisions faithfully.

THE ACTUAL BROWSER SCREENSHOT IS THE PRODUCT.

Return ONLY:

{
  "title": "",
  "assistant_message": "",
  "html": "",
  "css": "",
  "js": "",
  "next_steps": [],
  "quality_notes": []
}

HTML MUST BE BODY CONTENT ONLY.

QUALITY TARGET:

The page should look deliberately art-directed.

The first 900px at 1440px wide is the highest priority.

The visitor should immediately understand:
- what the brand is
- what is being offered
- what visually matters
- what action to take

USE:

- disciplined grid systems
- strong focal hierarchy
- deliberate asymmetry when appropriate
- sophisticated spacing
- strong type scale
- visual layering
- section rhythm
- CSS variables
- clamp()
- responsive grids
- meaningful hover states
- focus-visible states
- semantic HTML
- believable content
- deliberate navigation
- deliberate CTA hierarchy

RESPONSIVE DESIGN:

Mobile must be recomposed, not merely scaled down.

DO NOT:

- create a centered rectangle in empty space
- create giant meaningless whitespace
- center every section
- make every object a rounded card
- use generic three-card layouts as the main visual language
- spam gradients
- spam glow
- spam glassmorphism
- use black/gold merely because the user said luxury
- use purple/blue merely because the project is software
- create default-looking blue links
- create browser-default buttons
- use lorem ipsum
- use TODO content
- use href="#"
- invent local image paths
- use broken images
- use hero.jpg
- use car1.jpg
- use product.jpg
- use image.png
- perform network requests from JavaScript
- use stale years

IMAGES:

Only use a remote HTTPS image when you are highly confident it is directly renderable.

Otherwise build an intentional SVG/CSS visual fallback.

A deliberate visual is better than a broken-image icon.

JAVASCRIPT:

Use vanilla JavaScript.

Motion should reinforce hierarchy.

Do not animate every object.

Respect prefers-reduced-motion.
`;

const RECOMPOSE_SYSTEM = `
You are Veyra's emergency Principal Art Director.

A generated website has already been rendered in Chromium and judged from its actual screenshot.

It did not meet the required visual standard.

This is NOT a minor repair pass.

You may completely RECOMPOSE the page.

You may replace:

- hero architecture
- navigation
- grid
- typography
- imagery strategy
- visual focal point
- section order
- card architecture
- color balance
- spacing
- scale
- CTA treatment
- content density
- section rhythm

The screenshot review represents what a human actually saw.

Browser hard failures are mandatory fixes.

If the current layout is generic, do not preserve it.

If imagery is broken, remove or replace the strategy entirely.

If the hero is weak, rebuild it.

If the first viewport lacks a focal point, redesign it.

Return ONLY:

{
  "title": "",
  "assistant_message": "",
  "html": "",
  "css": "",
  "js": "",
  "next_steps": [],
  "quality_notes": []
}

HTML MUST BE BODY CONTENT ONLY.

Never invent local image paths.
Never preserve broken imagery.
Never use href="#".

The next screenshot must be materially better, not merely different.
`;

async function evaluateCandidate(
  site: SiteCode,
  req: StudioBuildRequest
): Promise<Candidate> {
  const renderStartedAt = Date.now();
  console.error("[V4 TIMING] Chromium render START");

  const rendered = await renderWebsite({
    title: site.title,
    html: site.html,
    css: site.css,
    js: site.js,
    width: req.viewport?.width ?? 1440,
    height: req.viewport?.height ?? 900
  });

  console.error(
    `[V4 TIMING] Chromium render DONE | seconds=${((Date.now() - renderStartedAt) / 1000).toFixed(1)}`
  );

  const criticStartedAt = Date.now();
  console.error("[V4 TIMING] Screenshot critic START");

  const review = await critiqueScreenshot(
    rendered.screenshotBase64,
    req.prompt,
    rendered.diagnostics
  );

  console.error(
    `[V4 TIMING] Screenshot critic DONE | seconds=${((Date.now() - criticStartedAt) / 1000).toFixed(1)} | score=${review.score}`
  );

  if (rendered.diagnostics.hardFailures.length) {
    review.pass = false;

    if (rendered.diagnostics.brokenImages.length) {
      review.score = Math.min(review.score, 45);
    } else {
      review.score = Math.min(review.score, 69);
    }
  }

  return {
    site,
    review,
    diagnostics: rendered.diagnostics
  };
}

function better(
  currentBest: Candidate,
  challenger: Candidate
): Candidate {
  const bestFailures =
    currentBest.diagnostics.hardFailures.length;

  const challengerFailures =
    challenger.diagnostics.hardFailures.length;

  if (bestFailures === 0 && challengerFailures > 0) {
    return currentBest;
  }

  if (challengerFailures === 0 && bestFailures > 0) {
    return challenger;
  }

  return challenger.review.score > currentBest.review.score
    ? challenger
    : currentBest;
}

export async function orchestrateStudio(
  req: StudioBuildRequest
): Promise<StudioBuildResult> {
  if (!req?.prompt?.trim()) {
    throw new Error("A build prompt is required.");
  }

  const ctx = projectContext(req);

  console.error("[Veyra V4] Creating Design DNA...");

  const designDNA = await runModel(
    "design",
    DESIGN_DNA_SYSTEM,
    ctx,
    {
      maxOutputTokens: 3000,
      reasoningEffort: "low"
    }
  );

  console.error(
    "[Veyra V4] Creating composition + asset strategy..."
  );

  const [composition, assets] = await Promise.all([
    runModel(
      "design",
      COMPOSITION_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3500,
        reasoningEffort: "low"
      }
    ),

    runModel(
      "design",
      ASSET_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3000,
        reasoningEffort: "low"
      }
    )
  ]);

  console.error("[Veyra V4] Building first composition...");

  const firstRaw = await runModel(
    "code",
    BUILDER_SYSTEM,
    [
      ctx,
      `DESIGN DNA:\n${designDNA}`,
      `COMPOSITION BLUEPRINT:\n${composition}`,
      `ASSET STRATEGY:\n${assets}`
    ].join("\n\n"),
    {
      maxOutputTokens: 24000,
      reasoningEffort: "low"
    }
  );

  const firstSite = parseSite(firstRaw);

  console.error("[Veyra V4] Rendering first composition...");

  const firstCandidate =
    await evaluateCandidate(firstSite, req);

  console.error(
    `[Veyra V4] First screenshot score: ${firstCandidate.review.score}/100`
  );

  let best = firstCandidate;
  let current = firstCandidate;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (
      current.review.pass &&
      current.review.score >= 88 &&
      current.diagnostics.hardFailures.length === 0
    ) {
      console.error(
        "[Veyra V4] Visual quality gate passed."
      );
      break;
    }

    console.error(
      `[Veyra V4] Recomposing visual design (${attempt}/2)...`
    );

    const repairRaw = await runModel(
      "repair",
      RECOMPOSE_SYSTEM,
      [
        `ORIGINAL PROJECT:\n${ctx}`,

        `DESIGN DNA:\n${designDNA}`,

        `COMPOSITION BLUEPRINT:\n${composition}`,

        `ASSET STRATEGY:\n${assets}`,

        `CURRENT HTML:\n${current.site.html}`,

        `CURRENT CSS:\n${current.site.css}`,

        `CURRENT JS:\n${current.site.js}`,

        `SCREENSHOT REVIEW:\n${JSON.stringify(
          current.review,
          null,
          2
        )}`,

        `BROWSER DIAGNOSTICS:\n${JSON.stringify(
          current.diagnostics,
          null,
          2
        )}`,

        `RECOMPOSITION ATTEMPT: ${attempt} of 2`,

        "Fix the visual cause, not merely the symptom."
      ].join("\n\n"),
      {
        maxOutputTokens: 26000,
        reasoningEffort: "low"
      }
    );

    const repairedSite = parseSite(repairRaw);

    const repairedCandidate =
      await evaluateCandidate(repairedSite, req);

    console.error(
      `[Veyra V4] Recomposition ${attempt} score: ${repairedCandidate.review.score}/100`
    );

    best = better(best, repairedCandidate);
    current = repairedCandidate;
  }

  const site = best.site;
  const review = best.review;
  const diagnostics = best.diagnostics;

  console.error(
    `[Veyra V4] Selected final candidate: ${review.score}/100`
  );

  return {
    ok: true,

    title: site.title,

    assistant_message:
      site.assistant_message,

    html: site.html,
    css: site.css,
    js: site.js,

    files: {
      "index.html": site.html,
      "styles.css": site.css,
      "script.js": site.js
    },

    changed_files: [
      "index.html",
      "styles.css",
      "script.js"
    ],

    next_steps: site.next_steps,

    quality: {
      score: review.score / 100,

      notes: [
        `SCREENSHOT SCORE: ${review.score}/100`,
        `VERDICT: ${review.verdict}`,
        `FIRST VIEWPORT: ${review.firstViewport}/100`,
        `COMPOSITION: ${review.composition}/100`,
        `TYPOGRAPHY: ${review.typography}/100`,
        `HIERARCHY: ${review.hierarchy}/100`,
        `IMAGERY: ${review.imagery}/100`,
        `POLISH: ${review.polish}/100`,
        `ORIGINALITY: ${review.originality}/100`,
        `BRAND SPECIFICITY: ${review.brandSpecificity}/100`,

        ...diagnostics.hardFailures.map(
          x => `HARD FAILURE: ${x}`
        ),

        ...review.issues.map(
          x => `VISUAL ISSUE: ${x}`
        ),

        ...review.strengths.map(
          x => `STRENGTH: ${x}`
        )
      ]
    },

    engine: "veyra-omni-design-dna-v4"
  };
}

/* ============================================================
   VEYRA V4 STAGED EXECUTION
   Each exported stage is intentionally bounded so Vercel gets
   a fresh runtime window for every expensive part of V4.
   ============================================================ */

export interface V4PlanState {
  designDNA: string;
  composition: string;
  assets: string;
}

export interface V4CandidateState {
  site: SiteCode;
  review: VisualReview;
  diagnostics: RenderDiagnostics;
}

export interface V4StageResult {
  ok: true;
  stage: "plan" | "build" | "recompose" | "complete";
  plan?: V4PlanState;
  candidate?: V4CandidateState;
  best?: V4CandidateState;
  attempt?: number;
  complete?: boolean;
  result?: StudioBuildResult;
}

function candidateToResult(
  candidate: Candidate
): StudioBuildResult {
  const site = candidate.site;
  const review = candidate.review;
  const diagnostics = candidate.diagnostics;

  return {
    ok: true,

    title: site.title,
    assistant_message: site.assistant_message,

    html: site.html,
    css: site.css,
    js: site.js,

    files: {
      "index.html": site.html,
      "styles.css": site.css,
      "script.js": site.js
    },

    changed_files: [
      "index.html",
      "styles.css",
      "script.js"
    ],

    next_steps: site.next_steps,

    quality: {
      score: review.score / 100,

      notes: [
        `SCREENSHOT SCORE: ${review.score}/100`,
        `VERDICT: ${review.verdict}`,
        `FIRST VIEWPORT: ${review.firstViewport}/100`,
        `COMPOSITION: ${review.composition}/100`,
        `TYPOGRAPHY: ${review.typography}/100`,
        `HIERARCHY: ${review.hierarchy}/100`,
        `IMAGERY: ${review.imagery}/100`,
        `POLISH: ${review.polish}/100`,
        `ORIGINALITY: ${review.originality}/100`,
        `BRAND SPECIFICITY: ${review.brandSpecificity}/100`,

        ...diagnostics.hardFailures.map(
          x => `HARD FAILURE: ${x}`
        ),

        ...review.issues.map(
          x => `VISUAL ISSUE: ${x}`
        ),

        ...review.strengths.map(
          x => `STRENGTH: ${x}`
        )
      ]
    },

    engine: "veyra-omni-design-dna-v4"
  };
}

function candidatePasses(candidate: Candidate): boolean {
  return (
    candidate.review.pass &&
    candidate.review.score >= 88 &&
    candidate.diagnostics.hardFailures.length === 0
  );
}

export async function orchestrateStudioPlan(
  req: StudioBuildRequest
): Promise<V4StageResult> {
  if (!req?.prompt?.trim()) {
    throw new Error("A build prompt is required.");
  }

  const baseCtx = projectContext(req);
  let ctx = baseCtx;

  const referenceUrl = findWebsiteReferenceUrl(req.prompt);

  if (referenceUrl) {
    console.error(
      `[Veyra V4 STAGE] PLAN: Website reference detected | url=${referenceUrl}`
    );

    try {
      const reference = await analyzeWebsiteReference(
        req.prompt,
        req.viewport?.width ?? 1440,
        req.viewport?.height ?? 900
      );

      if (reference) {
        let visualAnalysis = "";

        try {
          console.error(
            "[Veyra V4 STAGE] PLAN: Analyzing reference screenshot"
          );

          visualAnalysis = await callOpenAIVisual(
            [
              "You are Veyra's Website Reference Visual Analyst.",
              "Analyze the supplied screenshot as professional web design reference material.",
              "Focus only on useful visual evidence visible in the screenshot.",
              "Do not generate website code.",
              "Do not blindly praise or clone the reference.",
              "Identify what should be preserved, improved, simplified, or recomposed."
            ].join(" "),
            [
              `Reference URL: ${reference.finalUrl}`,
              `Page title: ${reference.title}`,
              "",
              "Return a compact professional visual analysis covering:",
              "- overall visual direction and brand personality",
              "- layout and composition",
              "- hero structure and hierarchy",
              "- navigation treatment",
              "- typography",
              "- color usage and contrast",
              "- cards, borders, radii, shadows and surfaces",
              "- spacing and density",
              "- imagery and decorative treatments",
              "- strongest design decisions",
              "- weakest design decisions",
              "- specific recommendations for an improved original redesign",
              "",
              "Keep the response under roughly 1200 words."
            ].join("\n"),
            reference.screenshotBase64,
            {
              maxOutputTokens: 3500,
              reasoningEffort: "medium"
            }
          );

          console.error(
            `[Veyra V4 STAGE] PLAN: Reference screenshot analyzed | chars=${visualAnalysis.length}`
          );
        } catch (visualError) {
          const visualDetail =
            visualError instanceof Error
              ? visualError.message
              : String(visualError);

          console.error(
            `[Veyra V4 STAGE] PLAN: Screenshot analysis unavailable | error=${visualDetail}`
          );

          visualAnalysis = "";
        }

        const referenceContext = {
          sourceUrl: reference.url,
          finalUrl: reference.finalUrl,
          title: reference.title,
          description: reference.description,
          headings: reference.headings,
          navigation: reference.navigation,
          buttons: reference.buttons,
          links: reference.links.slice(0, 30),
          images: reference.images.slice(0, 20),
          colors: reference.colors,
          fonts: reference.fonts,
          bodyHeight: reference.bodyHeight,
          visibleText: reference.visibleText.slice(0, 8000),
          visualAnalysis: visualAnalysis.slice(0, 12000)
        };

        ctx = [
          baseCtx,
          "WEBSITE REFERENCE ANALYSIS:",
          "The user supplied this live website as reference material.",
          "The reference was inspected in a real browser. Structured page evidence and, when available, AI screenshot analysis are provided below.",
          "Study its real content, information architecture, navigation, calls to action, branding clues, layout, hierarchy, typography, spacing, surfaces, and visual characteristics.",
          "Preserve useful business/content meaning and recognizable brand cues when appropriate, but do not blindly clone weak design decisions.",
          "Create an improved, original Veyra interpretation that follows the user's request.",
          JSON.stringify(referenceContext, null, 2)
        ].join("\n\n");

        console.error(
          `[Veyra V4 STAGE] PLAN: Website analysis attached | title=${JSON.stringify(reference.title)}`
        );
      } else {
        console.error(
          "[Veyra V4 STAGE] PLAN: Website analysis unavailable | continuing normal V4"
        );
      }
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `[Veyra V4 STAGE] PLAN: Website analysis failed open | error=${detail}`
      );

      ctx = baseCtx;
    }
  }

  console.error("[Veyra V4 STAGE] PLAN: Design DNA");

  const designDNA = await runModel(
    "design",
    DESIGN_DNA_SYSTEM,
    ctx,
    {
      maxOutputTokens: 3000,
      reasoningEffort: "low"
    }
  );

  console.error(
    "[Veyra V4 STAGE] PLAN: Composition + assets"
  );

  const [composition, assets] = await Promise.all([
    runModel(
      "design",
      COMPOSITION_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3500,
        reasoningEffort: "low"
      }
    ),

    runModel(
      "design",
      ASSET_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3000,
        reasoningEffort: "low"
      }
    )
  ]);

  console.error("[Veyra V4 STAGE] PLAN complete");

  return {
    ok: true,
    stage: "plan",
    plan: {
      designDNA,
      composition,
      assets
    },
    complete: false
  };
}

export async function orchestrateStudioBuildStage(
  req: StudioBuildRequest,
  plan: V4PlanState
): Promise<V4StageResult> {
  if (!plan?.designDNA || !plan?.composition || !plan?.assets) {
    throw new Error("V4 build stage requires completed planning state.");
  }

  const ctx = projectContext(req);

  console.error("[Veyra V4 STAGE] BUILD: Generating website");

  const raw = await runModel(
    "code",
    BUILDER_SYSTEM,
    [
      ctx,
      `DESIGN DNA:\n${plan.designDNA}`,
      `COMPOSITION BLUEPRINT:\n${plan.composition}`,
      `ASSET STRATEGY:\n${plan.assets}`
    ].join("\n\n"),
    {
      maxOutputTokens: 24000,
      reasoningEffort: "low"
    }
  );

  const site = parseSite(raw);

  console.error(
    "[Veyra V4 STAGE] BUILD: Rendering + screenshot critic"
  );

  const candidate = await evaluateCandidate(site, req);

  console.error(
    `[Veyra V4 STAGE] BUILD complete | score=${candidate.review.score}`
  );

  if (candidatePasses(candidate)) {
    return {
      ok: true,
      stage: "complete",
      plan,
      candidate,
      best: candidate,
      attempt: 0,
      complete: true,
      result: candidateToResult(candidate)
    };
  }

  return {
    ok: true,
    stage: "build",
    plan,
    candidate,
    best: candidate,
    attempt: 0,
    complete: false
  };
}

export async function orchestrateStudioRecomposeStage(
  req: StudioBuildRequest,
  plan: V4PlanState,
  currentState: V4CandidateState,
  bestState: V4CandidateState,
  attempt: number
): Promise<V4StageResult> {
  if (attempt < 1 || attempt > 2) {
    throw new Error("V4 recomposition attempt must be 1 or 2.");
  }

  const ctx = projectContext(req);

  const current: Candidate = currentState;
  const previousBest: Candidate = bestState;

  console.error(
    `[Veyra V4 STAGE] RECOMPOSE ${attempt}/2`
  );

  try {
    const repairRaw = await runModel(
      "repair",
      RECOMPOSE_SYSTEM,
      [
        `ORIGINAL PROJECT:\n${ctx}`,
        `DESIGN DNA:\n${plan.designDNA}`,
        `COMPOSITION BLUEPRINT:\n${plan.composition}`,
        `ASSET STRATEGY:\n${plan.assets}`,
        `CURRENT HTML:\n${current.site.html}`,
        `CURRENT CSS:\n${current.site.css}`,
        `CURRENT JS:\n${current.site.js}`,
        `SCREENSHOT REVIEW:\n${JSON.stringify(current.review, null, 2)}`,
        `BROWSER DIAGNOSTICS:\n${JSON.stringify(current.diagnostics, null, 2)}`,
        `RECOMPOSITION ATTEMPT: ${attempt} of 2`,
        "Fix the visual cause, not merely the symptom."
      ].join("\n\n"),
      {
        maxOutputTokens: 26000,
        reasoningEffort: "low"
      }
    );

    const repairedSite = parseSite(repairRaw);
    const repaired = await evaluateCandidate(repairedSite, req);

    const best = better(previousBest, repaired);

    console.error(
      `[Veyra V4 STAGE] RECOMPOSE ${attempt} complete | score=${repaired.review.score} | best=${best.review.score}`
    );

    const finished =
      candidatePasses(repaired) ||
      attempt >= 2;

    if (finished) {
      return {
        ok: true,
        stage: "complete",
        plan,
        candidate: repaired,
        best,
        attempt,
        complete: true,
        result: candidateToResult(best)
      };
    }

    return {
      ok: true,
      stage: "recompose",
      plan,
      candidate: repaired,
      best,
      attempt,
      complete: false
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `[Veyra V4 STAGE] RECOMPOSE ${attempt} failed | falling back to previous best | error=${detail}`
    );

    return {
      ok: true,
      stage: "complete",
      plan,
      candidate: current,
      best: previousBest,
      attempt,
      complete: true,
      result: candidateToResult(previousBest)
    };
  }
}
