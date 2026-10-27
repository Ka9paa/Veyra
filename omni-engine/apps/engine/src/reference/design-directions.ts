export type DesignDirectionSophistication =
  | "restrained"
  | "refined"
  | "expressive"
  | "cinematic";

export interface DesignDirection {
  id: string;
  name: string;
  thesis: string;

  personality: string[];

  hero: {
    family: string;
    geometry: string;
    focalPoint: string;
    typographyPlacement: string;
    imageryTreatment: string;
    ctaPlacement: string;
  };

  typography: {
    displayCharacter: string;
    bodyCharacter: string;
    scaleContrast: string;
    alignment: string;
  };

  imagery: {
    role: string;
    scale: string;
    cropStrategy: string;
    integration: string;
  };

  color: {
    strategy: string;
    contrast: string;
    accentBehavior: string;
  };

  composition: {
    grid: string;
    asymmetry: string;
    density: string;
    whitespace: string;
    sectionRhythm: string;
    depth: string;
  };

  signatureMoment: string;

  motion: {
    intensity: string;
    signatureBehavior: string;
  };

  mobileTransformation: string;

  sophistication: DesignDirectionSophistication;

  strengths: string[];
  risks: string[];
  antiPatterns: string[];
}

export interface DesignDirectionSelection {
  directions: DesignDirection[];

  selectedDirectionId: string;

  selection: {
    reason: string;
    promptFit: number;
    referenceFit: number;
    originality: number;
    visualPotential: number;
    usability: number;
    total: number;
  };
}

function cleanText(
  value: unknown,
  fallback = "not established",
  maxLength = 900
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const cleaned = value
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return fallback;
  }

  return cleaned.slice(0, maxLength);
}

function cleanArray(
  value: unknown,
  maxItems = 8
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const cleaned = cleanText(item, "", 500);

    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(cleaned);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function cleanScore(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, Math.round(numeric))
  );
}

function cleanSophistication(
  value: unknown
): DesignDirectionSophistication {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "";

  if (
    normalized === "restrained" ||
    normalized === "refined" ||
    normalized === "expressive" ||
    normalized === "cinematic"
  ) {
    return normalized;
  }

  return "refined";
}

function normalizeDirection(
  raw: any,
  index: number
): DesignDirection {
  const hero = raw?.hero ?? {};
  const typography = raw?.typography ?? {};
  const imagery = raw?.imagery ?? {};
  const color = raw?.color ?? {};
  const composition = raw?.composition ?? {};
  const motion = raw?.motion ?? {};

  return {
    id: cleanText(
      raw?.id,
      `direction-${index + 1}`,
      80
    )
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
      `direction-${index + 1}`,

    name: cleanText(
      raw?.name,
      `Direction ${index + 1}`,
      120
    ),

    thesis: cleanText(raw?.thesis),

    personality: cleanArray(
      raw?.personality,
      6
    ),

    hero: {
      family: cleanText(hero?.family),
      geometry: cleanText(hero?.geometry),
      focalPoint: cleanText(hero?.focalPoint),
      typographyPlacement: cleanText(
        hero?.typographyPlacement
      ),
      imageryTreatment: cleanText(
        hero?.imageryTreatment
      ),
      ctaPlacement: cleanText(
        hero?.ctaPlacement
      )
    },

    typography: {
      displayCharacter: cleanText(
        typography?.displayCharacter
      ),
      bodyCharacter: cleanText(
        typography?.bodyCharacter
      ),
      scaleContrast: cleanText(
        typography?.scaleContrast
      ),
      alignment: cleanText(
        typography?.alignment
      )
    },

    imagery: {
      role: cleanText(imagery?.role),
      scale: cleanText(imagery?.scale),
      cropStrategy: cleanText(
        imagery?.cropStrategy
      ),
      integration: cleanText(
        imagery?.integration
      )
    },

    color: {
      strategy: cleanText(color?.strategy),
      contrast: cleanText(color?.contrast),
      accentBehavior: cleanText(
        color?.accentBehavior
      )
    },

    composition: {
      grid: cleanText(composition?.grid),
      asymmetry: cleanText(
        composition?.asymmetry
      ),
      density: cleanText(
        composition?.density
      ),
      whitespace: cleanText(
        composition?.whitespace
      ),
      sectionRhythm: cleanText(
        composition?.sectionRhythm
      ),
      depth: cleanText(
        composition?.depth
      )
    },

    signatureMoment: cleanText(
      raw?.signatureMoment
    ),

    motion: {
      intensity: cleanText(
        motion?.intensity
      ),
      signatureBehavior: cleanText(
        motion?.signatureBehavior
      )
    },

    mobileTransformation: cleanText(
      raw?.mobileTransformation
    ),

    sophistication: cleanSophistication(
      raw?.sophistication
    ),

    strengths: cleanArray(
      raw?.strengths,
      6
    ),

    risks: cleanArray(
      raw?.risks,
      6
    ),

    antiPatterns: cleanArray(
      raw?.antiPatterns,
      8
    )
  };
}

export function normalizeDesignDirectionSelection(
  raw: any
): DesignDirectionSelection {
  const rawDirections = Array.isArray(
    raw?.directions
  )
    ? raw.directions.slice(0, 3)
    : [];

  const directions: DesignDirection[] = rawDirections.map(
    (direction: any, index: number): DesignDirection =>
      normalizeDirection(direction, index)
  );

  const requestedSelectedId = cleanText(
    raw?.selectedDirectionId,
    "",
    80
  );

  const selectedDirection =
    directions.find(
      (direction: DesignDirection) =>
        direction.id === requestedSelectedId
    ) ?? directions[0];

  const selection = raw?.selection ?? {};

  return {
    directions,

    selectedDirectionId:
      selectedDirection?.id ?? "",

    selection: {
      reason: cleanText(selection?.reason),

      promptFit: cleanScore(
        selection?.promptFit
      ),

      referenceFit: cleanScore(
        selection?.referenceFit
      ),

      originality: cleanScore(
        selection?.originality
      ),

      visualPotential: cleanScore(
        selection?.visualPotential
      ),

      usability: cleanScore(
        selection?.usability
      ),

      total: cleanScore(selection?.total)
    }
  };
}

export function selectedDesignDirection(
  selection: DesignDirectionSelection
): DesignDirection | undefined {
  return selection.directions.find(
    (direction: DesignDirection) =>
      direction.id ===
      selection.selectedDirectionId
  );
}

export function designDirectionContext(
  selection: DesignDirectionSelection
): string {
  const selected =
    selectedDesignDirection(selection);

  if (!selected) {
    return "";
  }

  return [
    "=== VEYRA SELECTED DESIGN DIRECTION ===",
    "",
    "Veyra explored multiple materially different visual concepts before committing to this direction.",
    "",
    "The selected direction is authoritative creative guidance for the next planning stages.",
    "Preserve its central visual thesis, hero geometry, hierarchy, imagery strategy, typography relationship, section rhythm, and signature moment unless doing so would conflict with the user's explicit request.",
    "",
    "Do NOT average the rejected directions together.",
    "Do NOT dilute this direction back into a generic website template.",
    "Do NOT mechanically copy reference material.",
    "",
    JSON.stringify(
      {
        selectedDirection: selected,
        selection: selection.selection
      },
      null,
      2
    )
  ].join("\n");
}

export const DESIGN_DIRECTIONS_SYSTEM = `
You are Veyra's Concept Director.

Your job happens BEFORE Design DNA, composition planning,
asset planning, and frontend implementation.

You receive:
- the user's actual request
- existing project context when applicable
- uploaded visual-reference intelligence when available
- website-reference intelligence when available
- structured Reference Design DNA when available

Your job is to explore the creative space BEFORE Veyra
commits to one design.

Create EXACTLY THREE materially different design directions.

These must NOT be:
- three color variations
- three font variations
- three slightly different versions of the same hero
- three generic landing-page templates

Each direction must have a genuinely different visual thesis
and recognizable page silhouette.

VARY MEANINGFULLY ACROSS DIRECTIONS:

- hero family
- hero geometry
- focal point
- typography placement
- imagery scale
- imagery cropping
- image/type relationship
- grid behavior
- asymmetry
- whitespace
- density
- section rhythm
- depth
- color strategy
- signature visual moment
- motion behavior
- mobile transformation

POSSIBLE CREATIVE TERRITORIES MAY INCLUDE:

- cinematic full-bleed
- editorial split
- immersive poster
- asymmetric gallery
- product stage
- conversion split
- interface stage
- typographic campaign
- spatial collage
- restrained luxury editorial
- publication-inspired composition
- image-led narrative

These are territories, NOT templates.

Choose concepts based on the actual project.

REFERENCE INTELLIGENCE:

References are evidence, not templates.

Preserve useful principles such as:
- hierarchy
- composition strategy
- image treatment
- typography relationships
- color logic
- spacing rhythm
- visual personality

But recompose them into original work.

Do NOT copy:
- third-party logos
- brand marks
- proprietary copy
- distinctive artwork
- exact section order
- exact coordinates
- exact component geometry
- pixel-for-pixel layouts

User-owned brand assets may be preserved when the user's
request indicates they belong to the project.

ORIGINALITY:

At least one direction should push beyond the most obvious
solution while remaining appropriate and usable.

Do not become experimental merely for novelty.

Every direction must still communicate:
- what the project is
- what matters visually
- what the visitor should do

SCORING:

After creating all three directions, select ONE.

Score the selected direction from 0-100 for:

- promptFit
- referenceFit
- originality
- visualPotential
- usability

"referenceFit" means intelligent use of relevant reference
principles, NOT similarity or copying.

The total score should represent the overall strength of
the selected concept.

Prefer the direction with the strongest combination of:
- project fit
- visual distinctiveness
- coherent hierarchy
- strong first viewport
- believable imagery strategy
- responsive potential
- usability

Do not select a weaker concept merely because it is safer.

OUTPUT:

Return ONLY valid JSON.

No markdown.
No code fences.
No commentary outside JSON.

Use EXACTLY this structure:

{
  "directions": [
    {
      "id": "stable-kebab-case-id",
      "name": "",
      "thesis": "",

      "personality": [],

      "hero": {
        "family": "",
        "geometry": "",
        "focalPoint": "",
        "typographyPlacement": "",
        "imageryTreatment": "",
        "ctaPlacement": ""
      },

      "typography": {
        "displayCharacter": "",
        "bodyCharacter": "",
        "scaleContrast": "",
        "alignment": ""
      },

      "imagery": {
        "role": "",
        "scale": "",
        "cropStrategy": "",
        "integration": ""
      },

      "color": {
        "strategy": "",
        "contrast": "",
        "accentBehavior": ""
      },

      "composition": {
        "grid": "",
        "asymmetry": "",
        "density": "",
        "whitespace": "",
        "sectionRhythm": "",
        "depth": ""
      },

      "signatureMoment": "",

      "motion": {
        "intensity": "",
        "signatureBehavior": ""
      },

      "mobileTransformation": "",

      "sophistication":
        "restrained | refined | expressive | cinematic",

      "strengths": [],
      "risks": [],
      "antiPatterns": []
    }
  ],

  "selectedDirectionId": "",

  "selection": {
    "reason": "",
    "promptFit": 0,
    "referenceFit": 0,
    "originality": 0,
    "visualPotential": 0,
    "usability": 0,
    "total": 0
  }
}

There MUST be exactly three directions.

Each direction must be materially different.

Select exactly one winning direction.
`;