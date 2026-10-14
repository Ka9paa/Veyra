import { callOpenAIVisual } from "../providers/openai.js";

export interface VisualReview {
  score: number;
  pass: boolean;
  composition: number;
  typography: number;
  hierarchy: number;
  imagery: number;
  polish: number;
  originality: number;
  brandSpecificity: number;
  firstViewport: number;
  verdict: string;
  issues: string[];
  strengths: string[];
  repairInstructions: string[];
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
    throw new Error("Visual critic did not return valid JSON.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

function score(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(0, Math.min(100, n))
    : 0;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

const SYSTEM = `
You are Veyra's uncompromising principal digital art director.

You are reviewing an ACTUAL browser screenshot, not source code.

Your comparison class is excellent contemporary commercial web design.

SCORING:
95-100 = world-class and distinctive
90-94 = exceptional professional design
82-89 = strong polished commercial work
70-81 = competent but generic/template-like
55-69 = mediocre AI-generated website
40-54 = weak amateur design
0-39 = broken, primitive, or unfinished

Do not inflate scores.

The first viewport is the highest-weight area.

Aggressively penalize:
- empty hero areas
- giant dead space
- generic centered heroes
- centered box inside centered box layouts
- broken or weak imagery
- missing product imagery
- repetitive three-card grids
- generic black/gold luxury styling
- generic purple/blue SaaS gradients
- excessive glassmorphism
- random glow effects
- weak typography
- default-looking links or buttons
- poor spacing
- weak visual rhythm
- no focal point
- no storytelling
- no brand personality
- obvious AI-template appearance
- bland navigation
- generic text logos
- disconnected sections
- stacked-rectangle layouts

For visually driven businesses, the subject/product must have
strong immediate visual presence.

Ask:
Would a skilled human designer proudly put this exact screenshot
in their portfolio?

Return ONLY JSON:

{
  "score": 0,
  "pass": false,
  "composition": 0,
  "typography": 0,
  "hierarchy": 0,
  "imagery": 0,
  "polish": 0,
  "originality": 0,
  "brandSpecificity": 0,
  "firstViewport": 0,
  "verdict": "",
  "issues": [],
  "strengths": [],
  "repairInstructions": []
}
`;

export async function critiqueScreenshot(
  screenshotBase64: string,
  userPrompt: string,
  diagnostics?: unknown
): Promise<VisualReview> {
  const raw = await callOpenAIVisual(
    SYSTEM,
    [
      "ORIGINAL USER REQUEST:",
      userPrompt,
      "",
      "BROWSER DIAGNOSTICS:",
      JSON.stringify(diagnostics ?? {}, null, 2),
      "",
      "Judge the actual screenshot."
    ].join("\n"),
    screenshotBase64,
    {
      maxOutputTokens: 3500,
      reasoningEffort: "medium"
    }
  );

  const x = extractJson(raw);
  const finalScore = score(x.score);

  return {
    score: finalScore,
    pass: Boolean(x.pass) && finalScore >= 86,
    composition: score(x.composition),
    typography: score(x.typography),
    hierarchy: score(x.hierarchy),
    imagery: score(x.imagery),
    polish: score(x.polish),
    originality: score(x.originality),
    brandSpecificity: score(x.brandSpecificity),
    firstViewport: score(x.firstViewport),
    verdict:
      typeof x.verdict === "string"
        ? x.verdict
        : "No verdict supplied.",
    issues: list(x.issues),
    strengths: list(x.strengths),
    repairInstructions: list(x.repairInstructions)
  };
}
