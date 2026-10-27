export type ReferenceSource =
  | "uploaded-image"
  | "website-reference";

export type ReferenceSophistication =
  | "minimal"
  | "moderate"
  | "high";

export interface ReferenceDesignDNA {
  source: ReferenceSource;
  sourceName?: string;
  sourceUrl?: string;

  visualDirection: {
    personality: string[];
    mood: string[];
    sophistication: ReferenceSophistication;
  };

  composition: {
    heroPattern: string;
    focalPoint: string;
    geometry: string;
    alignment: string;
    density: string;
    sectionRhythm: string;
    asymmetry: string;
    depth: string;
  };

  typography: {
    character: string;
    displayTreatment: string;
    bodyTreatment: string;
    scaleRelationship: string;
    alignment: string;
  };

  imagery: {
    role: string;
    scale: string;
    cropStyle: string;
    treatment: string;
    integration: string;
  };

  color: {
    paletteCharacter: string;
    contrast: string;
    accentStrategy: string;
    surfaceStrategy: string;
  };

  spacing: {
    whitespace: string;
    sectionSpacing: string;
    internalSpacing: string;
  };

  surfaces: {
    borders: string;
    radii: string;
    shadows: string;
    layering: string;
  };

  motion: {
    intensity: string;
    recommendedBehavior: string[];
  };

  signatureMoments: string[];
  preservePrinciples: string[];
  improvePrinciples: string[];
  avoidCopying: string[];
}

function cleanText(
  value: unknown,
  fallback = "not established"
): string {
  if (typeof value !== "string") return fallback;

  const cleaned = value
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallback;

  return cleaned.slice(0, 700);
}

function cleanArray(
  value: unknown,
  maxItems = 8
): string[] {
  if (!Array.isArray(value)) return [];

  const output: string[] = [];

  for (const item of value) {
    const cleaned = cleanText(item, "");

    if (!cleaned) continue;
    if (output.includes(cleaned)) continue;

    output.push(cleaned);

    if (output.length >= maxItems) break;
  }

  return output;
}

function sophistication(
  value: unknown
): ReferenceSophistication {
  if (
    value === "minimal" ||
    value === "moderate" ||
    value === "high"
  ) {
    return value;
  }

  return "moderate";
}

export function normalizeReferenceDesignDNA(
  raw: unknown,
  source: ReferenceSource,
  sourceName?: string,
  sourceUrl?: string
): ReferenceDesignDNA {
  const input =
    raw && typeof raw === "object"
      ? (raw as Record<string, any>)
      : {};

  const visualDirection =
    input.visualDirection ?? {};

  const composition =
    input.composition ?? {};

  const typography =
    input.typography ?? {};

  const imagery =
    input.imagery ?? {};

  const color =
    input.color ?? {};

  const spacing =
    input.spacing ?? {};

  const surfaces =
    input.surfaces ?? {};

  const motion =
    input.motion ?? {};

  return {
    source,

    sourceName:
      typeof sourceName === "string"
        ? sourceName.slice(0, 300)
        : undefined,

    sourceUrl:
      typeof sourceUrl === "string"
        ? sourceUrl.slice(0, 1500)
        : undefined,

    visualDirection: {
      personality: cleanArray(
        visualDirection.personality
      ),

      mood: cleanArray(
        visualDirection.mood
      ),

      sophistication: sophistication(
        visualDirection.sophistication
      )
    },

    composition: {
      heroPattern: cleanText(
        composition.heroPattern
      ),

      focalPoint: cleanText(
        composition.focalPoint
      ),

      geometry: cleanText(
        composition.geometry
      ),

      alignment: cleanText(
        composition.alignment
      ),

      density: cleanText(
        composition.density
      ),

      sectionRhythm: cleanText(
        composition.sectionRhythm
      ),

      asymmetry: cleanText(
        composition.asymmetry
      ),

      depth: cleanText(
        composition.depth
      )
    },

    typography: {
      character: cleanText(
        typography.character
      ),

      displayTreatment: cleanText(
        typography.displayTreatment
      ),

      bodyTreatment: cleanText(
        typography.bodyTreatment
      ),

      scaleRelationship: cleanText(
        typography.scaleRelationship
      ),

      alignment: cleanText(
        typography.alignment
      )
    },

    imagery: {
      role: cleanText(
        imagery.role
      ),

      scale: cleanText(
        imagery.scale
      ),

      cropStyle: cleanText(
        imagery.cropStyle
      ),

      treatment: cleanText(
        imagery.treatment
      ),

      integration: cleanText(
        imagery.integration
      )
    },

    color: {
      paletteCharacter: cleanText(
        color.paletteCharacter
      ),

      contrast: cleanText(
        color.contrast
      ),

      accentStrategy: cleanText(
        color.accentStrategy
      ),

      surfaceStrategy: cleanText(
        color.surfaceStrategy
      )
    },

    spacing: {
      whitespace: cleanText(
        spacing.whitespace
      ),

      sectionSpacing: cleanText(
        spacing.sectionSpacing
      ),

      internalSpacing: cleanText(
        spacing.internalSpacing
      )
    },

    surfaces: {
      borders: cleanText(
        surfaces.borders
      ),

      radii: cleanText(
        surfaces.radii
      ),

      shadows: cleanText(
        surfaces.shadows
      ),

      layering: cleanText(
        surfaces.layering
      )
    },

    motion: {
      intensity: cleanText(
        motion.intensity
      ),

      recommendedBehavior: cleanArray(
        motion.recommendedBehavior
      )
    },

    signatureMoments: cleanArray(
      input.signatureMoments,
      10
    ),

    preservePrinciples: cleanArray(
      input.preservePrinciples,
      10
    ),

    improvePrinciples: cleanArray(
      input.improvePrinciples,
      10
    ),

    avoidCopying: cleanArray(
      input.avoidCopying,
      10
    )
  };
}

export function referenceDesignDNAContext(
  references: ReferenceDesignDNA[]
): string {
  if (!references.length) return "";

  const compactReferences =
    references.slice(0, 4);

  return [
    "=== REFERENCE DESIGN DNA ===",
    "",
    "The user supplied visual reference material.",
    "Use the following Design DNA as evidence for visual direction.",
    "",
    "IMPORTANT:",
    "- Preserve useful design principles, not literal page structure.",
    "- Recompose the reference into an original design.",
    "- Do not copy distinctive logos, brand marks, proprietary copy, or unique branded artwork from third-party references.",
    "- Do not reproduce a reference website pixel-for-pixel.",
    "- Do not mechanically copy exact spacing, coordinates, section order, or component geometry.",
    "- Uploaded user-owned brand assets may be preserved when the user intends them to be used.",
    "- The user's written prompt takes priority over reference material.",
    "- Improve weak decisions rather than inheriting them.",
    "- Preserve strong hierarchy, composition, imagery strategy, typography relationships, color logic, spacing rhythm, and visual personality when relevant.",
    "",
    JSON.stringify(
      compactReferences,
      null,
      2
    )
  ].join("\n");
}