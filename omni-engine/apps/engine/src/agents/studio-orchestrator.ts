import { runModel } from "../providers/model-router.js";
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
      maxOutputTokens: 7000,
      reasoningEffort: "medium"
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
        maxOutputTokens: 8000,
        reasoningEffort: "medium"
      }
    ),

    runModel(
      "design",
      ASSET_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 5000,
        reasoningEffort: "medium"
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
      maxOutputTokens: 32000,
      reasoningEffort: "medium"
    }
  );

  const firstSite = parseSite(firstRaw);

  console.error("[Veyra V4] Direct AI build complete.");

  const site = firstSite;

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
      score: 0,
      notes: [
        "V4 DIRECT AI BUILD",
        "Server-side screenshot audit skipped in live Vercel mode.",
        ...site.quality_notes
      ]
    },

    engine: "veyra-omni-design-dna-v4"
  };
}
