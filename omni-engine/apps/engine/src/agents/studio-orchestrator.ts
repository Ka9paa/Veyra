import { normalizeReferenceDesignDNA, referenceDesignDNAContext, type ReferenceDesignDNA } from "../reference/design-dna.js";
import {
  DESIGN_DIRECTIONS_SYSTEM,
  normalizeDesignDirectionSelection,
  designDirectionContext
} from "../reference/design-directions.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import {
  generateAndStoreVeyraVisual,
  isVeyraVisualStorageConfigured,
  type StoredVeyraVisual
} from "../providers/visual-assets.js";
import {
  searchRealPhotos,
  isRealPhotoSearchConfigured,
  type ResolvedRealPhoto
} from "../providers/real-photos.js";
import {
  deriveCreativeDirectives,
  creativeDirectiveContext
} from "../intelligence/creative-directors.js";
import {
  studioEditingContext
} from "../studio/edit-contracts.js";
import {
  deriveResponsiveDirectorPlan,
  responsiveDirectorContext
} from "../intelligence/responsive-director.js";
import {
  deriveMotionDirectorPlan,
  motionDirectorContext
} from "../intelligence/motion-director.js";
import {
  deriveBrandSystemPlan,
  brandSystemContext
} from "../intelligence/brand-system.js";

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

  uploadedImages?: {
    name: string;
    type: string;
    data: string;
  }[];
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

interface PlannedGeneratedVisual {
  id: string;
  purpose?: string;
  subject?: string;
  scene?: string;
  art_direction?: string;
  lighting?: string;
  palette?: string;
  composition?: string;
  camera?: string;
  aspect_ratio?: string;
  intended_section?: string;
  essential?: boolean;
  authenticity_constraints?: string;
  fallback?: string;
}

interface ResolvedGeneratedVisual {
  id: string;
  purpose?: string;
  intended_section?: string;
  essential: boolean;
  fallback?: string;
  url: string;
  pathname: string;
  contentType: "image/png";
  bytes: number;
  model: string;
}

interface PlannedRealPhoto {
  id: string;
  purpose?: string;
  subject?: string;
  crop_orientation?: string;
  visual_scale?: string;
  intended_section?: string;
  aspect_ratio?: string;
  subject_placement?: string;
  text_safe_area?: string;
  mobile_crop?: string;
  required_terms?: string[];
  avoid_terms?: string[];
  essential: boolean;
  fallback?: string;
}

interface ResolvedRealPhotoAsset {
  id: string;
  purpose?: string;
  subject?: string;
  intended_section?: string;
  essential: boolean;
  url: string;
  provider: "unsplash";
  photographerName: string;
  photographerUrl: string;
  sourceUrl: string;
  alt: string;
  width: number;
  height: number;
  score?: number;
  aspectRatio?: number;
  artDirection?: ResolvedRealPhoto["artDirection"];
}

const MAX_REAL_PHOTOS_PER_BUILD = 4;
const MAX_GENERATED_VISUALS_PER_BUILD = 2;

const FALLBACK_DESIGN_DNA = JSON.stringify(
  {
    recovery_mode: "deterministic-design-dna-fallback",
    brand_character: [
      "project-specific",
      "clear",
      "intentional",
      "credible"
    ],
    visual_thesis:
      "Build a distinctive hierarchy from the user's actual request, supplied references, typography, imagery, and conversion goal.",
    signature_moment:
      "Create one strong first-viewport focal composition rather than generic stacked UI.",
    color_logic: {
      behavior:
        "Derive color behavior from the user's request and supplied reference material.",
      contrast:
        "Maintain strong readable contrast and reserve accents for hierarchy and action."
    },
    typography:
      "Use deliberate scale contrast, readable body text, controlled line length, and project-appropriate display treatment.",
    shape_language:
      "Avoid arbitrary card repetition; use borders, radii, framing, and geometry only when they support the concept.",
    image_language:
      "Prefer supplied or truthful raster imagery and compose around it when imagery is important.",
    spacing_rhythm:
      "Alternate open and dense moments intentionally instead of applying uniform spacing everywhere.",
    motion_language:
      "Use restrained motion that reinforces hierarchy and respects reduced-motion preferences.",
    first_viewport:
      "Establish one dominant focal point, clear project identity, and obvious primary action.",
    mobile_transformation:
      "Recompose ordering, crops, spacing, typography, and actions for mobile rather than simply shrinking desktop.",
    anti_patterns: [
      "generic SaaS card grids when inappropriate",
      "meaningless gradients",
      "repeated identical sections",
      "fake business facts",
      "decorative imagery unrelated to the project"
    ]
  },
  null,
  2
);

const FALLBACK_COMPOSITION = JSON.stringify(
  {
    recovery_mode: "deterministic-composition-fallback",
    hero_family: "project-appropriate",
    navigation_composition:
      "Clear responsive navigation preserving the primary conversion path.",
    hero: {
      height: "first-viewport dominant",
      layout:
        "Compose typography, supplied imagery, negative space, and primary action around one clear focal point.",
      focal_object:
        "Use the strongest truthful project-specific visual or typography treatment available.",
      text_placement:
        "Maintain strong hierarchy and readable contrast without defaulting mechanically to centered stacking.",
      cta_placement:
        "Place the primary action where it remains obvious on desktop and mobile."
    },
    section_strategy: [
      "Preserve intentional variation in density, scale, alignment, and visual treatment.",
      "Avoid repeating identical card grids or generic section templates.",
      "Use supplied or resolved imagery as meaningful compositional material when appropriate.",
      "Keep required conversion and informational sections easy to find."
    ],
    responsive_strategy:
      "Recompose hierarchy, imagery, spacing, navigation, and actions for mobile rather than merely shrinking desktop.",
    integrity:
      "Do not invent business facts, prices, testimonials, awards, addresses, hours, or external destinations."
  },
  null,
  2
);

const FALLBACK_ASSETS = JSON.stringify(
  {
    recovery_mode: "deterministic-asset-fallback",
    visual_strategy: {
      imagery_importance: "medium",
      authenticity_priority:
        "Prefer supplied or truthful real imagery; never fabricate business evidence.",
      fallback_strategy:
        "Use intentional typography and layout when suitable imagery is unavailable."
    },
    generated_visuals: [],
    asset_requirements: []
  },
  null,
  2
);

async function recoverableDesignDNA(
  ctx: string
): Promise<string> {
  try {
    return await runModel(
      "design",
      DESIGN_DNA_SYSTEM,
      ctx,
      {
        maxOutputTokens: 3000,
        reasoningEffort: "low",
        timeoutMs: 55_000
      }
    );
  } catch (error) {
    console.error(
      "[Veyra V4 RECOVERY] Design DNA failed; continuing with deterministic fallback | reason=" +
        (error instanceof Error ? error.message : String(error))
    );

    return FALLBACK_DESIGN_DNA;
  }
}

function parseGeneratedVisualPlan(raw: string): PlannedGeneratedVisual[] {
  try {
    const parsed = extractJson(raw);

    if (!Array.isArray(parsed?.generated_visuals)) {
      return [];
    }

    const generatedVisuals: unknown[] = parsed.generated_visuals;

    return generatedVisuals
      .filter(
        (item: unknown): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item)
      )
      .map((item: Record<string, unknown>, index: number): PlannedGeneratedVisual => ({
        id:
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : `generated-visual-${index + 1}`,
        purpose:
          typeof item.purpose === "string" ? item.purpose.trim() : undefined,
        subject:
          typeof item.subject === "string" ? item.subject.trim() : undefined,
        scene:
          typeof item.scene === "string" ? item.scene.trim() : undefined,
        art_direction:
          typeof item.art_direction === "string"
            ? item.art_direction.trim()
            : undefined,
        lighting:
          typeof item.lighting === "string" ? item.lighting.trim() : undefined,
        palette:
          typeof item.palette === "string" ? item.palette.trim() : undefined,
        composition:
          typeof item.composition === "string"
            ? item.composition.trim()
            : undefined,
        camera:
          typeof item.camera === "string" ? item.camera.trim() : undefined,
        aspect_ratio:
          typeof item.aspect_ratio === "string"
            ? item.aspect_ratio.trim()
            : undefined,
        intended_section:
          typeof item.intended_section === "string"
            ? item.intended_section.trim()
            : undefined,
        essential: item.essential === true,
        authenticity_constraints:
          typeof item.authenticity_constraints === "string"
            ? item.authenticity_constraints.trim()
            : undefined,
        fallback:
          typeof item.fallback === "string" ? item.fallback.trim() : undefined
      }))
      .filter(
        (item: PlannedGeneratedVisual) =>
          !!(
            item.subject ||
            item.scene ||
            item.purpose ||
            item.art_direction
          )
      );
  } catch (error) {
    console.error(
      "[Veyra V4 ASSETS] Could not parse generated_visuals; using fallbacks.",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

function parseRealPhotoPlan(
  rawVisualPlan: string
): PlannedRealPhoto[] {
  try {
    const parsed = extractJson(rawVisualPlan);

    if (!Array.isArray(parsed?.asset_requirements)) {
      return [];
    }

    const requirements: unknown[] = parsed.asset_requirements;

    return requirements
      .filter(
        (item: unknown): item is Record<string, unknown> => {
          if (
            !item ||
            typeof item !== "object" ||
            Array.isArray(item)
          ) {
            return false;
          }

          const record = item as Record<string, unknown>;

          return (
            record.type === "remote-image" ||
            record.type === "authentic-provider"
          );
        }
      )
      .map(
        (
          item: Record<string, unknown>,
          index: number
        ): PlannedRealPhoto => ({
          id:
            typeof item.id === "string" && item.id.trim()
              ? item.id.trim()
              : `real-photo-${index + 1}`,
          purpose:
            typeof item.purpose === "string"
              ? item.purpose.trim()
              : undefined,
          subject:
            typeof item.subject === "string"
              ? item.subject.trim()
              : undefined,
          crop_orientation:
            typeof item.crop_orientation === "string"
              ? item.crop_orientation.trim()
              : undefined,
          visual_scale:
            typeof item.visual_scale === "string"
              ? item.visual_scale.trim()
              : undefined,
          intended_section:
            typeof item.intended_section === "string"
              ? item.intended_section.trim()
              : undefined,
          aspect_ratio:
            typeof item.aspect_ratio === "string"
              ? item.aspect_ratio.trim()
              : undefined,
          subject_placement:
            typeof item.subject_placement === "string"
              ? item.subject_placement.trim()
              : undefined,
          text_safe_area:
            typeof item.text_safe_area === "string"
              ? item.text_safe_area.trim()
              : undefined,
          mobile_crop:
            typeof item.mobile_crop === "string"
              ? item.mobile_crop.trim()
              : undefined,
          required_terms:
            Array.isArray(item.required_terms)
              ? item.required_terms
                  .filter(
                    (value: unknown): value is string =>
                      typeof value === "string" &&
                      Boolean(value.trim())
                  )
                  .map((value: string) => value.trim())
              : undefined,
          avoid_terms:
            Array.isArray(item.avoid_terms)
              ? item.avoid_terms
                  .filter(
                    (value: unknown): value is string =>
                      typeof value === "string" &&
                      Boolean(value.trim())
                  )
                  .map((value: string) => value.trim())
              : undefined,
          essential: item.essential === true,
          fallback:
            typeof item.fallback === "string"
              ? item.fallback.trim()
              : undefined
        })
      )
      .filter(
        (item: PlannedRealPhoto) =>
          Boolean(item.subject || item.purpose)
      );
  } catch (error) {
    console.error(
      "[Veyra V4 PHOTOS] Could not parse real-photo requirements.",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

function realPhotoOrientation(
  value?: string
): "landscape" | "portrait" | "squarish" {
  const normalized = (value ?? "").toLowerCase();

  if (
    normalized.includes("portrait") ||
    normalized.includes("vertical") ||
    normalized.includes("4:5") ||
    normalized.includes("3:4") ||
    normalized.includes("2:3") ||
    normalized.includes("9:16")
  ) {
    return "portrait";
  }

  if (
    normalized.includes("square") ||
    normalized.includes("1:1")
  ) {
    return "squarish";
  }

  return "landscape";
}

function realPhotoRole(
  requirement: PlannedRealPhoto
): "hero" | "supporting" | "gallery" | "background" | "detail" {
  const value = [
    requirement.id,
    requirement.purpose,
    requirement.intended_section,
    requirement.visual_scale
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    value.includes("hero") ||
    value.includes("masthead") ||
    value.includes("above fold") ||
    value.includes("first viewport")
  ) {
    return "hero";
  }

  if (
    value.includes("background") ||
    value.includes("backdrop")
  ) {
    return "background";
  }

  if (
    value.includes("gallery") ||
    value.includes("portfolio") ||
    value.includes("work grid")
  ) {
    return "gallery";
  }

  if (
    value.includes("detail") ||
    value.includes("closeup") ||
    value.includes("close-up")
  ) {
    return "detail";
  }

  return "supporting";
}

function realPhotoAspectRatio(
  requirement: PlannedRealPhoto
): number | undefined {
  const value = (
    requirement.aspect_ratio ||
    requirement.crop_orientation ||
    ""
  )
    .toLowerCase()
    .replace(/\s+/g, "");

  const ratioMatch =
    value.match(/(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)/);

  if (ratioMatch) {
    const width = Number(ratioMatch[1]);
    const height = Number(ratioMatch[2]);

    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return width / height;
    }
  }

  const orientation =
    realPhotoOrientation(
      requirement.crop_orientation ||
      requirement.aspect_ratio
    );

  if (orientation === "portrait") {
    return 4 / 5;
  }

  if (orientation === "squarish") {
    return 1;
  }

  if (
    realPhotoRole(requirement) === "hero" ||
    realPhotoRole(requirement) === "background"
  ) {
    return 16 / 9;
  }

  return 3 / 2;
}

function realPhotoSubjectPlacement(
  value?: string
): "left" | "center" | "right" | "auto" {
  const normalized =
    (value ?? "").toLowerCase();

  if (normalized.includes("left")) {
    return "left";
  }

  if (normalized.includes("right")) {
    return "right";
  }

  if (
    normalized.includes("center") ||
    normalized.includes("middle")
  ) {
    return "center";
  }

  return "auto";
}

function realPhotoTextSafeArea(
  value?: string
): "left" | "right" | "top" | "bottom" | "none" | "auto" {
  const normalized =
    (value ?? "").toLowerCase();

  if (normalized.includes("left")) {
    return "left";
  }

  if (normalized.includes("right")) {
    return "right";
  }

  if (normalized.includes("top")) {
    return "top";
  }

  if (normalized.includes("bottom")) {
    return "bottom";
  }

  if (
    normalized.includes("none") ||
    normalized.includes("no text")
  ) {
    return "none";
  }

  return "auto";
}

function realPhotoMobileCrop(
  value?: string
): "center" | "subject" | "top" | "bottom" {
  const normalized =
    (value ?? "").toLowerCase();

  if (normalized.includes("top")) {
    return "top";
  }

  if (normalized.includes("bottom")) {
    return "bottom";
  }

  if (normalized.includes("center")) {
    return "center";
  }

  return "subject";
}

function buildRealPhotoQuery(
  requirement: PlannedRealPhoto
): string {
  // Search photography libraries by the actual visible subject.
  // Purpose belongs to composition/placement, not the stock-photo query.
  const subject = requirement.subject
    ?.replace(/\s+/g, " ")
    .trim();

  if (subject) {
    return subject;
  }

  return requirement.purpose
    ?.replace(/\s+/g, " ")
    .trim() ?? "";
}

async function resolveRealPhotos(
  rawVisualPlan: string
): Promise<ResolvedRealPhotoAsset[]> {
  const planned = parseRealPhotoPlan(rawVisualPlan);

  if (planned.length === 0) {
    console.error(
      "[Veyra V4 PHOTOS] No real-photo requirements requested."
    );
    return [];
  }

  if (!isRealPhotoSearchConfigured()) {
    console.error(
      "[Veyra V4 PHOTOS] Real photography requested but UNSPLASH_ACCESS_KEY is not configured. Skipping remote photo search."
    );
    return [];
  }

  const selected = planned
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => {
      const essentialDifference =
        Number(b.photo.essential) -
        Number(a.photo.essential);

      if (essentialDifference !== 0) {
        return essentialDifference;
      }

      return a.index - b.index;
    })
    .slice(0, MAX_REAL_PHOTOS_PER_BUILD)
    .map(({ photo }) => photo);

  console.error(
    `[Veyra V4 PHOTOS] Resolving ${selected.length}/${planned.length} planned real-photo asset(s).`
  );

  const usedPhotoIds = new Set<string>();
  const resolved: ResolvedRealPhotoAsset[] = [];

  // Deliberately sequential:
  // lets us avoid choosing the same stock photo for multiple roles.
  for (const requirement of selected) {
    const query = buildRealPhotoQuery(requirement);

    if (!query) {
      continue;
    }

    try {
      const results: ResolvedRealPhoto[] =
        await searchRealPhotos(query, {
          orientation: realPhotoOrientation(
            requirement.crop_orientation ||
            requirement.aspect_ratio
          ),
          perPage: 8,
          role: realPhotoRole(requirement),
          aspectRatio: realPhotoAspectRatio(requirement),
          subjectPlacement: realPhotoSubjectPlacement(
            requirement.subject_placement
          ),
          textSafeArea: realPhotoTextSafeArea(
            requirement.text_safe_area
          ),
          mobileCrop: realPhotoMobileCrop(
            requirement.mobile_crop
          ),
          excludeIds: Array.from(usedPhotoIds),
          requiredTerms: requirement.required_terms,
          avoidTerms: requirement.avoid_terms
        });

      // Provider results are already ranked by semantic fit,
      // slot aspect ratio, orientation, resolution, and role.
      // excludeIds prevents reuse across major page roles.
      const photo = results[0];

      if (!photo) {
        console.error(
          `[Veyra V4 PHOTOS] No usable photo found for ${requirement.id}.`
        );
        continue;
      }

      usedPhotoIds.add(photo.id);

      resolved.push({
        id: requirement.id,
        purpose: requirement.purpose,
        subject: requirement.subject,
        intended_section:
          requirement.intended_section ||
          requirement.purpose,
        essential: requirement.essential,
        url: photo.url,
        provider: photo.provider,
        photographerName: photo.photographerName,
        photographerUrl: photo.photographerUrl,
        sourceUrl: photo.sourceUrl,
        alt: photo.alt,
        width: photo.width,
        height: photo.height,
        score: photo.score,
        aspectRatio: photo.aspectRatio,
        artDirection: photo.artDirection
      });

      console.error(
        `[Veyra V4 PHOTOS] Ready: ${requirement.id} -> ${photo.url}`
      );
    } catch (error) {
      console.error(
        `[Veyra V4 PHOTOS] Search failed for ${requirement.id}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

  return resolved;
}

function realPhotoContext(
  photos: ResolvedRealPhotoAsset[]
): string {
  if (photos.length === 0) {
    return [
      "VEYRA REAL PHOTOGRAPHY ASSETS:",
      "No verified remote photography URLs were resolved.",
      "Do NOT invent, guess, or fabricate image URLs.",
      "Do NOT replace photographic subject matter with SVG, canvas, CSS illustration, emoji, clipart, gradients, or geometric artwork.",
      "Use truthful typography/layout fallback unless another supplied raster asset satisfies the role."
    ].join("\n");
  }

  return [
    "VEYRA REAL PHOTOGRAPHY ASSETS:",
    "These are real raster photographs resolved by Veyra before Builder execution.",
    "Use the exact HTTPS image URLs supplied below.",
    "Do NOT rewrite, guess, fabricate, or replace these URLs.",
    "For image-led businesses, these photographs are major compositional material, not tiny card decoration.",
    "An essential hero photograph must materially participate in the first viewport at meaningful scale.",
    "Use full-bleed crops, editorial crops, split compositions, overlap, background photography, galleries, and intentional image/type relationships where appropriate.",
    "CSS may crop, mask, position, overlay, animate, and color-grade these photographs.",
    "SVG/canvas/CSS illustration must NOT replace real photographic subject matter.",
    "These are representative/editorial photographs unless the project explicitly supplied verified business-owned imagery.",
    "Never claim these people, locations, interiors, storefronts, customers, employees, or completed work belong to the business.",
    JSON.stringify(photos, null, 2)
  ].join("\n");
}

function imageSizeForAspectRatio(
  aspectRatio?: string
): "1024x1024" | "1536x1024" | "1024x1536" {
  const value = (aspectRatio ?? "").toLowerCase().replace(/\s+/g, "");

  const portraitHints = [
    "portrait",
    "2:3",
    "3:4",
    "4:5",
    "9:16"
  ];

  if (portraitHints.some((hint) => value.includes(hint))) {
    return "1024x1536";
  }

  const squareHints = ["square", "1:1"];

  if (squareHints.some((hint) => value.includes(hint))) {
    return "1024x1024";
  }

  return "1536x1024";
}

function buildGeneratedVisualPrompt(
  visual: PlannedGeneratedVisual
): string {
  const parts = [
    "Create a premium production-ready website visual for Veyra.",
    visual.purpose ? `Purpose: ${visual.purpose}` : "",
    visual.subject ? `Subject: ${visual.subject}` : "",
    visual.scene ? `Scene: ${visual.scene}` : "",
    visual.art_direction
      ? `Art direction: ${visual.art_direction}`
      : "",
    visual.lighting ? `Lighting: ${visual.lighting}` : "",
    visual.palette ? `Palette: ${visual.palette}` : "",
    visual.composition
      ? `Composition: ${visual.composition}`
      : "",
    visual.camera ? `Camera: ${visual.camera}` : "",
    visual.aspect_ratio
      ? `Requested aspect ratio: ${visual.aspect_ratio}`
      : "",
    visual.intended_section
      ? `Website placement: ${visual.intended_section}`
      : "",
    visual.authenticity_constraints
      ? `Authenticity constraints: ${visual.authenticity_constraints}`
      : "",
    [
      "The image must feel intentional, polished, cinematic, and suitable for a high-end responsive website.",
      "Do not add logos, watermarks, UI chrome, captions, labels, or readable text unless the art direction explicitly requires them.",
      "Do not fabricate business-specific proof such as employees, storefronts, customers, awards, certifications, reviews, or completed client work.",
      "Treat this as art-directed website imagery, not documentary evidence."
    ].join(" ")
  ].filter(Boolean);

  return parts.join("\n");
}

async function resolveGeneratedVisuals(
  rawVisualPlan: string
): Promise<ResolvedGeneratedVisual[]> {
  const planned = parseGeneratedVisualPlan(rawVisualPlan);

  if (planned.length === 0) {
    console.error("[Veyra V4 ASSETS] No generated visuals requested.");
    return [];
  }

  if (!isVeyraVisualStorageConfigured()) {
    console.error(
      "[Veyra V4 ASSETS] Generated visuals requested, but persistent Blob storage is not configured. Skipping paid image generation and using fallbacks."
    );
    return [];
  }

  const selected = planned
    .map((visual, index) => ({ visual, index }))
    .sort((a, b) => {
      const essentialDifference =
        Number(b.visual.essential === true) -
        Number(a.visual.essential === true);

      if (essentialDifference !== 0) {
        return essentialDifference;
      }

      return a.index - b.index;
    })
    .slice(0, MAX_GENERATED_VISUALS_PER_BUILD)
    .map(({ visual }) => visual);

  console.error(
    `[Veyra V4 ASSETS] Resolving ${selected.length}/${planned.length} planned generated visual(s).`
  );

  const settled = await Promise.allSettled(
    selected.map(async (visual): Promise<ResolvedGeneratedVisual> => {
      const stored: StoredVeyraVisual =
        await generateAndStoreVeyraVisual(
          visual.id,
          buildGeneratedVisualPrompt(visual),
          {
            size: imageSizeForAspectRatio(visual.aspect_ratio),
            quality: visual.essential ? "high" : "medium"
          }
        );

      return {
        id: stored.id,
        purpose: visual.purpose,
        intended_section: visual.intended_section,
        essential: visual.essential === true,
        fallback: visual.fallback,
        url: stored.url,
        pathname: stored.pathname,
        contentType: stored.contentType,
        bytes: stored.bytes,
        model: stored.model
      };
    })
  );

  const resolved: ResolvedGeneratedVisual[] = [];

  settled.forEach((result, index) => {
    const visual = selected[index];

    if (result.status === "fulfilled") {
      resolved.push(result.value);

      console.error(
        `[Veyra V4 ASSETS] Ready: ${visual.id} -> ${result.value.url}`
      );

      return;
    }

    console.error(
      `[Veyra V4 ASSETS] Generation failed for ${visual.id}; Builder must use fallback. ` +
        (
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        )
    );
  });

  return resolved;
}

function generatedVisualContext(
  visuals: ResolvedGeneratedVisual[]
): string {
  if (visuals.length === 0) {
    return [
      "VEYRA GENERATED VISUAL ASSETS:",
      "No generated visual asset URLs were resolved for this build.",
      "Use the Visual Experience Plan's fallbacks.",
      "Do not invent image URLs or local filenames."
    ].join("\n");
  }

  return [
    "VEYRA GENERATED VISUAL ASSETS:",
    "These assets were generated and persisted by Veyra.",
    "A resolved generated asset is REAL build input, not optional inspiration.",
    "Use each exact HTTPS URL in the intended visual role.",
    "Every asset with essential=true MUST be visibly rendered in the website.",
    "Do NOT replace an essential resolved asset with SVG, CSS illustration, gradient art, emoji, iconography, or another image.",
    "The essential asset must have meaningful visual scale and composition; a tiny hidden, offscreen, or token use does not satisfy the requirement.",
    "If an essential asset is intended for the hero, it must materially participate in the first-viewport hero composition.",
    "Hero imagery is compositional material, not an asset checkbox. Build the geometry, typography, crop, negative space, layering, and CTA placement around it.",
    "For image-led or cinematic projects, prefer one unmistakably dominant hero visual treatment over several weak decorative image placements.",
    "Do not shrink an essential hero asset merely to make conventional text-column layout easier.",
    "Do not rewrite, guess, or replace these URLs.",
    "Do not treat generated imagery as documentary proof of real business facts.",
    JSON.stringify(visuals, null, 2)
  ].join("\n");
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

interface CompletionContractItem {
  id: string;
  label?: string;
  purpose?: string;
  behavior?: string;
  required?: boolean;
}

interface CompletionContract {
  required_sections: CompletionContractItem[];
  required_actions: CompletionContractItem[];
  required_content: string[];
  visual_requirements: string[];
  mobile_requirements: string[];
  integrity_rules: string[];
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

function parseCompletionContract(raw: string): CompletionContract {
  const x = extractJson(raw);

  const normalizeItems = (
    value: unknown
  ): CompletionContractItem[] =>
    Array.isArray(value)
      ? value
          .filter(
            item =>
              item &&
              typeof item === "object" &&
              typeof (item as any).id === "string" &&
              (item as any).id.trim()
          )
          .map(item => ({
            id: String((item as any).id).trim(),
            label:
              typeof (item as any).label === "string"
                ? (item as any).label.trim()
                : undefined,
            purpose:
              typeof (item as any).purpose === "string"
                ? (item as any).purpose.trim()
                : undefined,
            behavior:
              typeof (item as any).behavior === "string"
                ? (item as any).behavior.trim()
                : undefined,
            required: (item as any).required !== false
          }))
      : [];

  const normalizeStrings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter(
            (item): item is string =>
              typeof item === "string"
          )
          .map(item => item.trim())
          .filter(Boolean)
      : [];

  const contract: CompletionContract = {
    required_sections: normalizeItems(x?.required_sections),
    required_actions: normalizeItems(x?.required_actions),
    required_content: normalizeStrings(x?.required_content),
    visual_requirements: normalizeStrings(x?.visual_requirements),
    mobile_requirements: normalizeStrings(x?.mobile_requirements),
    integrity_rules: normalizeStrings(x?.integrity_rules)
  };

  if (
    contract.required_sections.length === 0 &&
    contract.required_actions.length === 0
  ) {
    throw new Error(
      "Completion contract must define at least one required section or action."
    );
  }

  return contract;
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

function parseRepairSite(raw: string, current: SiteCode): SiteCode {
  const x = extractJson(raw);

  // Repairs are patches over an already-valid candidate.
  // Empty/omitted fields mean "preserve the current implementation",
  // NOT "erase this file".
  const repaired = {
    title:
      typeof x.title === "string" && x.title.trim()
        ? x.title
        : current.title,

    assistant_message:
      typeof x.assistant_message === "string" &&
      x.assistant_message.trim()
        ? x.assistant_message
        : current.assistant_message,

    html:
      typeof x.html === "string" && x.html.trim()
        ? x.html
        : current.html,

    css:
      typeof x.css === "string" && x.css.trim()
        ? x.css
        : current.css,

    js:
      typeof x.js === "string" && x.js.trim()
        ? x.js
        : current.js,

    next_steps:
      Array.isArray(x.next_steps)
        ? x.next_steps.filter(
            (item: unknown): item is string =>
              typeof item === "string"
          )
        : current.next_steps,

    quality_notes:
      Array.isArray(x.quality_notes)
        ? x.quality_notes.filter(
            (item: unknown): item is string =>
              typeof item === "string"
          )
        : current.quality_notes
  };

  const inherited: string[] = [];

  if (!(typeof x.html === "string" && x.html.trim())) {
    inherited.push("html");
  }

  if (!(typeof x.css === "string" && x.css.trim())) {
    inherited.push("css");
  }

  if (!(typeof x.js === "string" && x.js.trim())) {
    inherited.push("js");
  }

  if (inherited.length > 0) {
    console.error(
      `[V4 REPAIR] Preserved current ${inherited.join(", ")} because repair response omitted or emptied it`
    );
  }

  // Run the merged result through the normal strict validator.
  // Fresh builds remain strict, and a repair can never produce
  // an actually empty HTML/CSS website.
  return parseSite(JSON.stringify(repaired));
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

COMPLETION CONTRACT:

You are not only planning composition.
You must define what MUST exist before Veyra is allowed to call the website finished.

Include a "completion_contract" object in your JSON with:

{
  "required_sections": [
    {
      "id": "stable-kebab-case-id",
      "label": "Human readable section name",
      "purpose": "Why this section must exist",
      "required": true
    }
  ],
  "required_actions": [
    {
      "id": "stable-kebab-case-id",
      "label": "Human readable action",
      "behavior": "What must actually happen when used",
      "required": true
    }
  ],
  "required_content": [],
  "visual_requirements": [],
  "mobile_requirements": [],
  "integrity_rules": []
}

RULES:

- Every navigation destination must correspond to a real section or real destination.
- Every important CTA must have defined behavior.
- Do not require unsupported business facts.
- Do not invent services, prices, awards, testimonials, statistics, or claims.
- If a business fact is unknown, design around the missing fact instead of fabricating it.
- Require sections appropriate to the actual project, not generic filler.
- Physical/local businesses should normally consider services or offerings, credibility/proof, about/context, location/hours when known, and a contact/conversion path.
- If imagery is important to understanding the business, make it a visual requirement.
- If a gallery is necessary, explicitly require it.
- If reviews/testimonials are supplied by the original context, preserve truthful attribution requirements.
- Mobile navigation and primary conversion actions must remain usable.
- A visually beautiful site with missing required sections or dead actions is NOT complete.

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
You are Veyra's Visual Experience Director.

Your job is to determine the visual material, imagery, dimensionality,
and motion needed for the requested website to feel custom, believable,
premium, and appropriate to the actual project.

You are NOT merely choosing stock photos.

You are directing four coordinated systems:

1. visual assets,
2. generated imagery,
3. spatial / 3D treatment,
4. motion behavior.

The goal is not maximum effects.
The goal is the strongest appropriate visual experience.

CORE PRINCIPLE:

Different businesses deserve different visual systems.

A barbershop may benefit from authentic haircut/shop imagery,
editorial portrait treatment, dimensional tools or product objects,
and subtle depth.

A SaaS product may benefit from interface compositions,
layered product surfaces, spatial UI, and cinematic transitions.

A professional tax or legal business may need restrained photography,
typography, diagrams, and subtle motion rather than unnecessary 3D.

Never add 3D simply because 3D is available.
Never add motion simply because motion is available.

AUTHENTICITY:

Do not fabricate business-specific evidence.

Do not generate fake:
- storefront photographs presented as real
- employees presented as real staff
- customer photographs presented as real customers
- completed projects presented as real portfolio work
- awards
- certifications
- reviews
- products that the business does not actually offer

When authentic business imagery is supplied in project context,
prefer it for factual representation.

Generated imagery may be used for:
- clearly art-directed hero imagery
- editorial compositions
- abstract brand imagery
- atmospheric scenes
- textures
- backgrounds
- conceptual product presentation
- decorative subject matter
- non-factual illustrations
- visual storytelling that does not impersonate real evidence

VISUAL SOURCE HIERARCHY:

Choose intentionally between:

1. existing user-provided real images,
2. authentic business/provider photography when available and permitted,
3. relevant credible directly-renderable HTTPS real photography when permitted,
4. Veyra-generated raster imagery only when real photography is unavailable or custom imagery materially improves the experience,
5. typography-led composition when photographic imagery cannot be sourced truthfully.

For photographic subject matter, SVG and CSS-generated illustration are NOT asset-source options.
SVG may only support small icons, logos, masks, or non-subject symbols.
CSS may style and compose real images but must never replace the photographic subject.

Never invent local filenames.

NEVER suggest:
hero.jpg
car1.jpg
product.png
image.png
/assets/example.jpg
or any fake local asset.

If you are not confident an external image URL will render directly,
do NOT invent one.

A deliberate fallback is better than a broken image.
For photographic subject matter, that fallback must NOT be an SVG/CSS illustration.
Prefer another suitable real photograph or a truthful typography/layout treatment.

PHYSICAL / VISUAL INDUSTRIES:

For industries where the physical subject materially affects trust
or understanding, imagery is critical.

Examples include:
- automotive
- fashion
- restaurants
- food
- architecture
- travel
- hotels
- real estate
- beauty
- barbering
- fitness
- physical retail

For those projects, barely showing the actual subject is a visual failure.

GENERATED VISUALS:

AI image generation is OPTIONAL, not the default source for photographic content.

Before requesting a generated visual, determine whether the same visual role can
be satisfied by suitable real photography from user assets, verified provider
assets, or credible directly-renderable HTTPS photography.

Do NOT request paid image generation merely because a page needs a person,
barber, haircut, food item, vehicle, interior, building, landscape, fashion
subject, product, or other normally photographable subject.

Request Veyra-generated imagery only when custom art direction materially
improves the experience or suitable real photography cannot satisfy the role.

Determine whether Veyra-generated imagery would materially improve
the experience.

For each useful generated visual define:
- id
- purpose
- subject
- scene
- art direction
- lighting
- palette relationship
- composition
- camera / perspective
- aspect ratio
- intended section
- essential or decorative
- authenticity constraints
- fallback if generation is unavailable

Do NOT claim the image already exists.

SPATIAL / 3D DIRECTION:

Choose one spatial mode:

- "none"
- "subtle-depth"
- "layered-2.5d"
- "interactive-3d"

Use "interactive-3d" only when a dimensional object or scene
materially improves understanding, desire, or brand expression.

If spatial treatment is used, define:
- purpose
- subject/object
- placement
- camera behavior
- pointer response
- scroll response
- lighting concept
- depth hierarchy
- performance budget
- mobile behavior
- reduced-motion behavior
- deterministic 2D fallback

The 2D fallback is mandatory for interactive 3D.

The fallback must still look intentional and premium.
It must not depend on WebGL to communicate essential information.

MOTION DIRECTION:

Motion must reinforce hierarchy and meaning.

Choose only useful behaviors such as:
- restrained entrance reveals
- staggered typography
- image masking/reveal
- parallax
- depth response
- section transitions
- product/interface choreography
- navigation transitions
- CTA feedback
- gallery transitions

Define:
- motion intensity
- signature motion moment
- entrance behavior
- scroll behavior
- hover/pointer behavior
- section transition behavior
- interaction feedback
- reduced-motion behavior

Do not animate every element.

Avoid:
- constant floating for no reason
- excessive spring effects
- animation that delays comprehension
- animation that blocks interaction
- scroll hijacking
- decorative motion with no hierarchy purpose

PERFORMANCE:

Visual ambition must not destroy usability.

Prefer:
- transform and opacity animation
- bounded particle counts
- lazy loading below the fold
- responsive imagery
- lightweight CSS presentation and small non-subject SVG icons when appropriate; never use SVG/CSS as photographic subject imagery
- progressive enhancement

Avoid requiring heavy spatial rendering for ordinary content.

OUTPUT:

Return ONLY valid JSON using this top-level structure:

{
  "visual_strategy": {
    "visual_thesis": "",
    "imagery_importance": "low | medium | high | critical",
    "authenticity_priority": "",
    "hero_visual_requirement": "",
    "supporting_visual_requirements": [],
    "required_subjects": [],
    "image_hierarchy": [],
    "fallback_strategy": ""
  },

  "generated_visuals": [
    {
      "id": "",
      "purpose": "",
      "subject": "",
      "scene": "",
      "art_direction": "",
      "lighting": "",
      "palette_relationship": "",
      "composition": "",
      "camera": "",
      "aspect_ratio": "",
      "intended_section": "",
      "essential": false,
      "authenticity_constraints": [],
      "fallback": ""
    }
  ],

  "spatial_direction": {
    "mode": "none | subtle-depth | layered-2.5d | interactive-3d",
    "reason": "",
    "purpose": "",
    "subject": "",
    "placement": "",
    "camera_behavior": "",
    "pointer_response": "",
    "scroll_response": "",
    "lighting": "",
    "depth_hierarchy": "",
    "performance_budget": "",
    "mobile_behavior": "",
    "reduced_motion_behavior": "",
    "fallback_2d": ""
  },

  "motion_direction": {
    "intensity": "none | restrained | expressive | cinematic",
    "signature_moment": "",
    "entrance_behavior": "",
    "scroll_behavior": "",
    "hover_pointer_behavior": "",
    "section_transitions": "",
    "interaction_feedback": "",
    "reduced_motion_behavior": ""
  },

  "asset_requirements": [
    {
      "id": "",
      "type": "existing | authentic-provider | remote-image | generated | typography",
      "purpose": "",
      "subject": "",
      "crop_orientation": "",
      "visual_scale": "",
      "essential": false,
      "fallback": ""
    }
  ]
}
`;
const BUILDER_SYSTEM = `
You are Veyra's elite frontend designer and engineer.

You receive:
- original request
- Design DNA
- composition blueprint
- Visual Experience Plan containing asset, generated-imagery,
  spatial/3D, and motion direction
- completion contract

Implement those decisions faithfully.

REAL PHOTOGRAPHY RULES — STRICT:

- When VEYRA REAL PHOTOGRAPHY ASSETS are supplied, use those exact URLs for their intended photographic roles.
- Real-world photographic subjects such as people, barbers, haircuts, food, vehicles, buildings, interiors, fashion, products, landscapes, and portfolio-style imagery must use raster photography when suitable photography is supplied.
- NEVER draw those subjects with SVG, canvas, CSS illustration, emoji, clipart, gradients, or geometric substitutes.
- SVG is limited to small interface icons, logos, masks, and simple non-subject symbols.
- CSS is for presentation and composition, not for drawing the photographic subject.
- For image-led sites, photography should materially shape the composition through scale, crop, overlap, depth, full-bleed treatment, or editorial placement.
- Do not falsely describe representative photography as the business's actual employees, customers, storefront, location, or completed work.
- Do not invent remote image URLs.

COMPOSITION TRANSLATION IS MANDATORY:

Before writing HTML/CSS, internally translate the Design DNA,
Composition Blueprint, and Visual Experience Plan into one coherent
rendered composition. Do not output this internal translation.

You must resolve all of the following before coding:
- FIRST-VIEWPORT FOCAL POINT: identify the single dominant visual moment.
- HERO GEOMETRY: decide exactly how text, imagery, negative space, navigation,
  and CTA occupy the first viewport.
- IMAGE ROLE: decide which imagery is dominant, supporting, full-bleed,
  cropped, masked, layered, overlapping, or background material.
- TYPE/IMAGE RELATIONSHIP: typography must compose with imagery rather than
  sitting in an unrelated text column beside it.
- DEPTH SYSTEM: establish foreground, midground, and background when the
  Visual Experience Plan calls for cinematic or spatial treatment.
- SECTION RHYTHM: intentionally alternate density, scale, alignment, image
  treatment, and pacing. Do not repeat one section template down the page.
- SIGNATURE MOMENT: implement at least one visually memorable composition
  specific to this project when the requested direction is premium,
  cinematic, luxurious, editorial, expressive, or highly custom.
- MOTION HIERARCHY: motion should reinforce the focal hierarchy and section
  transitions instead of adding unrelated animations.
- MOBILE RECOMPOSITION: preserve the same focal hierarchy on mobile using
  deliberate crops, ordering, spacing, and CTA placement.

The rendered page must make these decisions visually obvious.
Merely mentioning them in quality_notes does not satisfy the requirement.

PHOTOGRAPHIC CONTENT POLICY — STRICT:
When a website calls for imagery of real-world subjects, use REAL RASTER IMAGES.

Examples include:
- people, teams, customers, professionals, barbers, models
- haircuts, food, drinks, cars, products, clothing
- shops, restaurants, homes, offices, gyms, hotels, interiors
- travel, landscapes, architecture, portfolio/project work

REAL IMAGE PRIORITY:
1. user/project supplied real images,
2. verified provider/business imagery when available and permitted,
3. relevant credible HTTPS real photography when permitted,
4. AI-generated raster imagery only when useful or when suitable real photography is unavailable.

AI image generation is NOT required merely because the website needs imagery.

FORBIDDEN AS PRIMARY/SUBJECT IMAGERY:
- SVG illustrations of real-world subjects
- CSS-drawn people, objects, products, buildings, food, vehicles, or scenes
- clip-art substitutes
- emoji substitutes
- abstract gradients/shapes pretending to satisfy an image requirement

SVG may still be used for small icons/logos/symbols.
CSS remains fully available for styling and composition around real images.

Generic real photography must be treated as representative/editorial imagery.
Never claim generic photography depicts the actual business, staff, customers,
storefront, portfolio, products, or completed work unless that fact is verified.

For image-led businesses, do NOT build the page as UI cards with images
inserted afterward. Compose the page FROM the imagery.

For cinematic/editorial requests:
- prefer bold image scale and intentional cropping
- allow controlled overlap and edge-to-edge imagery where appropriate
- create contrast between quiet and dense sections
- use typography as a compositional element
- create visual continuity between adjacent sections
- avoid dashboard/SaaS-like card grammar unless the project actually needs it
- avoid making every section a self-contained rectangular block
- avoid treating the hero as headline + paragraph + buttons + image rectangle
- avoid decorative grids/lines that compete with the actual subject
- NEVER use flat vectors, SVG illustrations, CSS drawings, emoji, gradients, or geometric artwork as substitutes for real photographic subject matter
- when the subject is naturally photographic (people, barbers, haircuts, food, cars, interiors, buildings, travel, fitness, fashion, products, landscapes, etc.), use real raster photography
- real photography may come from credible HTTPS image sources and does NOT need to be AI-generated
- CSS may style, crop, mask, overlay, position, animate, and color-grade photography, but CSS must not draw the primary subject

VISUAL EXPERIENCE IMPLEMENTATION:

Treat the Visual Experience Plan as art direction, not permission to
fake unavailable assets.

- Existing/authentic imagery should be preferred when actually available.
- When project-owned imagery is unavailable, use relevant real photography from credible HTTPS image sources when licensing/source terms permit its use.
- Do not fabricate a business-specific claim from generic photography: generic barber photography must not be presented as the actual Barcode staff, customers, storefront, or completed work unless verified.
- A generated_visuals entry describes generation intent; it does NOT mean
  that an image file already exists.
- Never invent a URL or local filename for a planned generated visual.
- Until a generated asset is actually supplied to Builder, implement its
  specified fallback intentionally.
- Once a generated asset IS supplied in VEYRA GENERATED VISUAL ASSETS, it is authoritative build input.
- Every supplied asset marked essential=true MUST be visibly used at meaningful scale in its intended section.
- Never replace a supplied essential generated asset with a generic SVG/CSS illustration, decorative vector, gradient, icon, emoji, or unrelated remote image.
- If an essential generated asset is intended for the hero, compose the hero around that asset rather than treating it as minor decoration.
- Premium hero imagery should normally occupy substantial visual area through an image panel, full-bleed region, masked composition, layered crop, or similarly intentional treatment.
- Preserve useful subject visibility across responsive crops with object-fit/object-position or equivalent composition.
- Typography and imagery must interact as one composition; avoid simply placing text beside an unrelated rectangle.
- SVG is allowed only for small interface icons, logos when appropriate, masks, and simple non-subject symbols.
- SVG must NEVER depict or replace people, faces, haircuts, barbers, food, cars, buildings, interiors, products, clothing, landscapes, portfolio work, or other photographic subject matter.
- CSS is for presentation only: layout, typography, spacing, borders, shadows, overlays, color treatment, masks, transitions, and animation.
- CSS gradients/shapes/illustrations must NEVER replace photographic subject matter.
- For image-led websites, if suitable real photography is available, the page MUST use it as major compositional material.
- Prefer large meaningful photographic placements: full-bleed heroes, editorial crops, split layouts, galleries, backgrounds, overlapping image compositions, and immersive section imagery.
- Do not reduce photography to tiny card thumbnails when imagery should drive the experience.
- If imagery importance is high or critical, the first viewport must visibly communicate that priority.
- If spatial mode is "none", do not add gratuitous 3D.
- If spatial mode is "subtle-depth", use lightweight layered depth,
  transforms, perspective, or pointer response rather than a heavy 3D engine.
- If spatial mode is "layered-2.5d", create meaningful foreground,
  midground, and background depth with a deterministic flat fallback.
- If spatial mode is "interactive-3d", preserve a polished deterministic
  2D fallback and never make essential content depend on WebGL.
- Follow the motion direction while respecting prefers-reduced-motion.
- Motion must never prevent reading, navigation, or conversion.
- Preserve performance and mobile usability.

COMPLETION IS MANDATORY:

The completion contract is not optional inspiration.

- Implement every required section.
- Implement every required action that can be completed client-side.
- Navigation items must lead to real sections or legitimate destinations.
- Important buttons must perform the behavior promised by their label.
- Never use a <button> merely because an element visually looks like a CTA.
- Use <a> for navigation and destination-based CTAs.
- For an in-page CTA, use a real href="#section-id" pointing to an existing section.
- Use <button> only when JavaScript actually gives it observable behavior, or when it is a legitimate form submit control.
- data-veyra-action is a QA marker, NOT behavior by itself.
- Never invent an external booking, checkout, contact, reservation, scheduling, or social URL.
- If the requested conversion destination is unknown, route the CTA truthfully to an existing in-page contact, booking-information, location, or next-step section instead of creating a dead button.
- Decorative controls that do nothing must not be rendered as buttons or role="button".
- Do not silently omit a required section because another section looks better.
- Do not replace required content with decorative filler.
- Do not invent facts to satisfy the contract.
- If factual information is unavailable, preserve the required function using truthful neutral wording or an appropriate non-fabricated fallback.
- Mobile must preserve the important content and conversion path.
- A beautiful incomplete website is a failed build.

DETERMINISTIC COMPLETION MARKERS:

Every required section MUST have exactly one visible rendered element with:
data-veyra-section="CONTRACT_ID"

Example:
<section id="services" data-veyra-section="services">...</section>

Every required action MUST place this attribute on the real clickable control:
data-veyra-action="CONTRACT_ID"

Example:
<a
  href="#booking"
  data-veyra-action="book-appointment"
>
  Book now
</a>

Use the exact stable kebab-case ID from the completion contract.

Do not:
- invent different marker IDs
- put markers on hidden placeholders
- put markers on unrelated elements merely to satisfy QA
- mark a decorative element as an action
- mark an empty container as a completed section

The marked section must visibly implement the promised section.
The marked action must actually perform the promised behavior.

Where practical, the HTML section id should equal the completion-contract
section ID so navigation and QA remain deterministic.

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

Do NOT replace missing photographic subject matter with SVG/CSS illustration. Use a truthful typography/layout treatment while preserving space for real imagery, or use suitable credible real photography when available.

A deliberate visual is better than a broken-image icon.

JAVASCRIPT:

Use vanilla JavaScript.

Motion should reinforce hierarchy.

Do not animate every object.

Respect prefers-reduced-motion.
`;

const STRUCTURE_RECOVERY_SYSTEM = `
You are Veyra's frontend output recovery engineer.

A previous frontend generation failed Veyra's required output contract.

Recover the website without simplifying, redesigning, summarizing,
or lowering its visual quality.

Return ONLY valid JSON using EXACTLY this structure:

{
  "title": "",
  "assistant_message": "",
  "html": "",
  "css": "",
  "js": "",
  "next_steps": [],
  "quality_notes": []
}

MANDATORY:

- html must contain BODY CONTENT ONLY
- html must be non-empty
- css must be non-empty
- js must be a string and may be empty only when JavaScript is unnecessary
- keep HTML, CSS, and JavaScript in their separate JSON fields
- do not wrap the response in markdown
- do not use code fences
- do not return commentary outside the JSON
- do not omit CSS
- preserve the original design intent and implementation detail
- preserve all useful content from the failed generation
- if CSS was accidentally embedded inside HTML, move it into the css field
- if JavaScript was accidentally embedded inside HTML, move it into the js field
- never replace a detailed implementation with a simplified one

The recovered result will still be rendered in Chromium and judged by
Veyra's normal screenshot quality system.
`;

const COMPLETION_REPAIR_SYSTEM = `
You are Veyra's Completion Repair Engineer.

The website already has a visual design.
Your job is NOT to redesign it.

Your job is to repair deterministic completion failures while preserving
the existing visual identity, hierarchy, layout, spacing, typography,
imagery, motion, and successful sections as much as possible.

You receive:
- original project context
- Design DNA
- composition blueprint
- asset strategy
- mandatory completion contract
- current HTML
- current CSS
- current JavaScript
- browser completion diagnostics

PRIORITY:

1. Fix every Completion QA failure.
2. Preserve already-correct sections and interactions.
3. Preserve the existing visual design unless a completion failure
   requires a localized visual change.
4. Do not remove working content to make validation easier.
5. Do not fake completion markers.
6. Do not invent business facts.
7. Do not weaken or bypass the completion contract.

DETERMINISTIC MARKERS:

Every required section must have exactly one visible:
data-veyra-section="CONTRACT_ID"

Every required action must place:
data-veyra-action="CONTRACT_ID"
on the actual interactive control.

The exact contract IDs must be preserved.

If a required section is missing:
- add the real section
- integrate it naturally into the existing page
- preserve the site's visual language

If a required action is missing or invalid:
- implement the real interaction or legitimate destination
- attach the required marker to the real clickable control

If an internal link target is missing:
- create or correct the legitimate destination

If a marker is duplicated:
- keep it only on the canonical implementation

If a required marker is hidden:
- repair the actual visible implementation
- do not merely reveal a meaningless placeholder

If an image is broken:
- replace it with a credible directly-renderable HTTPS asset when certain
- otherwise use a truthful typography/layout fallback; never fabricate photographic subject matter with SVG/CSS

Return ONLY valid JSON:

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

A repair is successful only when the actual rendered website fulfills
the completion contract.
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

let v4DebugSequence = 0;

async function persistCandidateDebugArtifacts(args: {
  site: SiteCode;
  req: StudioBuildRequest;
  screenshotBase64: string;
  diagnostics: RenderDiagnostics;
  review: VisualReview;
  visualExperiencePlan?: string;
  completionContractRaw?: string;
}): Promise<void> {
  // Local debugging only. Never make production/Vercel builds depend on
  // writable filesystem state.
  if (process.env.VERCEL) {
    return;
  }

  try {
    const sequence = ++v4DebugSequence;
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const projectPart = (args.req.projectId || "local")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 48);

    const dir = join(
      process.cwd(),
      ".v4-debug",
      `${timestamp}-${projectPart}-${String(sequence).padStart(2, "0")}`
    );

    await mkdir(dir, { recursive: true });

    await Promise.all([
      writeFile(
        join(dir, "site.html"),
        args.site.html || "",
        "utf8"
      ),
      writeFile(
        join(dir, "site.css"),
        args.site.css || "",
        "utf8"
      ),
      writeFile(
        join(dir, "site.js"),
        args.site.js || "",
        "utf8"
      ),
      writeFile(
        join(dir, "review.json"),
        JSON.stringify(args.review, null, 2),
        "utf8"
      ),
      writeFile(
        join(dir, "diagnostics.json"),
        JSON.stringify(args.diagnostics, null, 2),
        "utf8"
      ),
      writeFile(
        join(dir, "visual-plan.txt"),
        args.visualExperiencePlan || "",
        "utf8"
      ),
      writeFile(
        join(dir, "completion-contract.json"),
        args.completionContractRaw || "",
        "utf8"
      ),
      writeFile(
        join(dir, "request.json"),
        JSON.stringify(
          {
            projectId: args.req.projectId ?? null,
            prompt: args.req.prompt,
            viewport: args.req.viewport ?? null,
            title: args.site.title
          },
          null,
          2
        ),
        "utf8"
      ),
      writeFile(
        join(dir, "screenshot.png"),
        Buffer.from(args.screenshotBase64, "base64")
      )
    ]);

    console.error(
      `[V4 DEBUG] candidate artifacts saved -> ${dir}`
    );
  } catch (error) {
    // Debug persistence must NEVER fail a user's website build.
    console.error(
      "[V4 DEBUG] could not persist candidate artifacts:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function evaluateCandidate(
  site: SiteCode,
  req: StudioBuildRequest,
  completionContractRaw?: string,
  visualExperiencePlan?: string,
  resolvedVisuals: ResolvedGeneratedVisual[] = []
): Promise<Candidate> {
  const renderStartedAt = Date.now();
  console.error("[V4 TIMING] Chromium render START");

  let requiredSectionIds: string[] = [];
  let requiredActionIds: string[] = [];

  if (completionContractRaw) {
    const contract =
      parseCompletionContract(completionContractRaw);

    requiredSectionIds = contract.required_sections
      .filter(item => item.required !== false)
      .map(item => item.id);

    requiredActionIds = contract.required_actions
      .filter(item => item.required !== false)
      .map(item => item.id);
  }

  const rendered = await renderWebsite({
    title: site.title,
    html: site.html,
    css: site.css,
    js: site.js,
    width: req.viewport?.width ?? 1440,
    height: req.viewport?.height ?? 900,
    requiredSectionIds,
    requiredActionIds,
    requiredVisuals: resolvedVisuals
      .filter(visual => visual.essential)
      .map(visual => ({
        id: visual.id,
        url: visual.url,
        intendedSection: visual.intended_section
      }))
  });

  console.error(
    `[V4 TIMING] Chromium render DONE | seconds=${((Date.now() - renderStartedAt) / 1000).toFixed(1)}`
  );

  // Deterministic browser QA is the first gate.
  // If Chromium already proved the website is incomplete or broken,
  // do not spend a visual-model call judging its screenshot.
  if (rendered.diagnostics.hardFailures.length > 0) {
    console.error(
      `[V4 QA] Deterministic gate FAILED | hardFailures=${rendered.diagnostics.hardFailures.length} | screenshot critic SKIPPED`
    );

    const deterministicIssues = [
      ...rendered.diagnostics.hardFailures
    ];

    const review: VisualReview = {
      score: rendered.diagnostics.brokenImages.length > 0 ? 45 : 69,
      pass: false,
      composition: 0,
      typography: 0,
      hierarchy: 0,
      imagery: 0,
      polish: 0,
      originality: 0,
      brandSpecificity: 0,
      firstViewport: 0,
      artDirection: 0,
      visualPlanFidelity: 0,
      depthSpatial: 0,
      cinematicQuality: 0,
      templateResistance: 0,
      verdict:
        "Deterministic browser QA failed before visual review. Repair browser and completion failures first.",
      issues: deterministicIssues,
      strengths: [],
      repairInstructions: deterministicIssues.map(
        issue => `Repair deterministic browser failure: ${issue}`
      )
    };

    await persistCandidateDebugArtifacts({
      site,
      req,
      screenshotBase64: rendered.screenshotBase64,
      diagnostics: rendered.diagnostics,
      review,
      visualExperiencePlan,
      completionContractRaw
    });

    return {
      site,
      review,
      diagnostics: rendered.diagnostics
    };
  }

  console.error(
    "[V4 QA] Deterministic gate PASSED | running screenshot critic"
  );

  const criticStartedAt = Date.now();
  console.error("[V4 TIMING] Screenshot critic START");

  const review = await critiqueScreenshot(
    rendered.screenshotBase64,
    req.prompt,
    rendered.diagnostics,
    visualExperiencePlan
  );

  console.error(
    `[V4 TIMING] Screenshot critic DONE | seconds=${((Date.now() - criticStartedAt) / 1000).toFixed(1)} | score=${review.score}`
  );

  await persistCandidateDebugArtifacts({
    site,
    req,
    screenshotBase64: rendered.screenshotBase64,
    diagnostics: rendered.diagnostics,
    review,
    visualExperiencePlan,
    completionContractRaw
  });

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

  const designDNA = await recoverableDesignDNA(ctx);

  console.error(
    "[Veyra V4] Creating composition + asset strategy..."
  );

  const [compositionResult, assetsResult] = await Promise.allSettled([
    runModel(
      "design",
      COMPOSITION_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3500,
        reasoningEffort: "low",
        timeoutMs: 60_000
      }
    ),

    runModel(
      "design",
      ASSET_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3000,
        reasoningEffort: "low",
        timeoutMs: 55_000
      }
    )
  ]);

  const composition =
    compositionResult.status === "fulfilled" &&
    compositionResult.value.trim()
      ? compositionResult.value
      : FALLBACK_COMPOSITION;

  if (compositionResult.status === "rejected") {
    console.error(
      "[Veyra V4 RECOVERY] Composition failed; continuing with deterministic composition fallback | reason=" +
        (compositionResult.reason instanceof Error
          ? compositionResult.reason.message
          : String(compositionResult.reason))
    );
  }

  const assets =
    assetsResult.status === "fulfilled" &&
    assetsResult.value.trim()
      ? assetsResult.value
      : FALLBACK_ASSETS;

  if (assetsResult.status === "rejected") {
    console.error(
      "[Veyra V4 RECOVERY] Asset planning failed; continuing with deterministic asset fallback | reason=" +
        (assetsResult.reason instanceof Error
          ? assetsResult.reason.message
          : String(assetsResult.reason))
    );
  }

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

  let firstSite: SiteCode;

  try {
    firstSite = parseSite(firstRaw);
  } catch (initialParseError) {
    const parseMessage =
      initialParseError instanceof Error
        ? initialParseError.message
        : String(initialParseError);

    console.error(
      `[Veyra V4] Initial builder output invalid (${parseMessage}). ` +
      "Attempting one structural recovery..."
    );

    const recoveryRaw = await runModel(
      "code",
      STRUCTURE_RECOVERY_SYSTEM,
      [
        `ORIGINAL PROJECT:\n${ctx}`,
        `DESIGN DNA:\n${designDNA}`,
        `COMPOSITION BLUEPRINT:\n${composition}`,
        `ASSET STRATEGY:\n${assets}`,
        `FAILED BUILDER OUTPUT:\n${firstRaw}`,
        `VALIDATION ERROR:\n${parseMessage}`,
        "Recover the failed output into Veyra's exact required JSON structure.",
        "Do not simplify or redesign the site."
      ].join("\n\n"),
      {
        maxOutputTokens: 24000,
        reasoningEffort: "low"
      }
    );

    try {
      firstSite = parseSite(recoveryRaw);

      console.error(
        "[Veyra V4] Structural recovery succeeded."
      );
    } catch (recoveryError) {
      const recoveryMessage =
        recoveryError instanceof Error
          ? recoveryError.message
          : String(recoveryError);

      throw new Error(
        `Initial builder output was invalid (${parseMessage}); ` +
        `structural recovery also failed (${recoveryMessage}).`
      );
    }
  }

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
  completionContract: string;
  resolvedVisuals?: ResolvedGeneratedVisual[];
  resolvedRealPhotos?: ResolvedRealPhotoAsset[];
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

const V4_EXCELLENT_SCORE = 88;
const V4_FAST_ACCEPT_SCORE = 75;

function candidatePasses(candidate: Candidate): boolean {
  return (
    candidate.review.pass &&
    candidate.review.score >= V4_EXCELLENT_SCORE &&
    candidate.diagnostics.hardFailures.length === 0
  );
}

function candidateCanFastAccept(candidate: Candidate): boolean {
  return (
    candidate.review.pass &&
    candidate.review.score >= V4_FAST_ACCEPT_SCORE &&
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
  const referenceDesignDNAs: ReferenceDesignDNA[] = [];

  const uploadedImages = Array.isArray(req.uploadedImages)
    ? req.uploadedImages.slice(0, 4)
    : [];

  if (uploadedImages.length) {
    console.error(
      `[Veyra V4 STAGE] PLAN: Analyzing ${uploadedImages.length} uploaded image(s)`
    );

    const uploadedVisualAnalyses: string[] = [];

    for (let index = 0; index < uploadedImages.length; index += 1) {
      const image = uploadedImages[index];

      if (!image?.data?.startsWith("data:image/")) {
        continue;
      }

      try {
        const analysis = await callOpenAIVisual(
          [
            "You are Veyra's Reference Image Intelligence system.",
            "The user intentionally attached this image as context for a website or web application build.",
            "Inspect the actual pixels carefully.",
            "Determine how the image relates to the user's request.",
            "Extract reusable design principles instead of blindly copying the reference.",
            "If it is a user-owned logo or brand asset, identify its visible identity, shape, typography, colors, transparency/background, and intended integration.",
            "If it is a website or UI screenshot, analyze composition, hierarchy, typography, imagery, cropping, color logic, whitespace, section rhythm, surfaces, borders, radii, layering, depth, density, and signature visual moments.",
            "If it is another reference image, identify the visually useful principles that should influence the build.",
            "Do not claim to see details that are not visible.",
            "Do not invent brand or business facts.",
            "Do not generate code.",
            "Do not reproduce third-party branding, logos, proprietary copy, or distinctive artwork.",
            "Do not recommend pixel-for-pixel cloning.",
            "The user's written request takes priority over the reference.",
            "Return ONLY valid JSON with no markdown fences or commentary.",
            'Use this exact top-level structure: {"summary":"","designDNA":{"visualDirection":{"personality":[],"mood":[],"sophistication":"minimal | moderate | high"},"composition":{"heroPattern":"","focalPoint":"","geometry":"","alignment":"","density":"","sectionRhythm":"","asymmetry":"","depth":""},"typography":{"character":"","displayTreatment":"","bodyTreatment":"","scaleRelationship":"","alignment":""},"imagery":{"role":"","scale":"","cropStyle":"","treatment":"","integration":""},"color":{"paletteCharacter":"","contrast":"","accentStrategy":"","surfaceStrategy":""},"spacing":{"whitespace":"","sectionSpacing":"","internalSpacing":""},"surfaces":{"borders":"","radii":"","shadows":"","layering":""},"motion":{"intensity":"","recommendedBehavior":[]},"signatureMoments":[],"preservePrinciples":[],"improvePrinciples":[],"avoidCopying":[]}}'
          ].join("\n"),
          [
            `User request: ${req.prompt}`,
            `Uploaded image ${index + 1} of ${uploadedImages.length}`,
            `Filename: ${image.name || "image"}`,
            `MIME type: ${image.type || "image"}`,
            "",
            "Analyze this uploaded image as direct visual context for the user's build.",
            "Return the requested structured Reference Design DNA JSON."
          ].join("\n"),
          image.data,
          {
            maxOutputTokens: 3000,
            reasoningEffort: "medium"
          }
        );

        if (!analysis.trim()) {
          continue;
        }

        try {
          const parsed = extractJson(analysis);
          const summary =
            typeof parsed?.summary === "string"
              ? parsed.summary.trim()
              : "";

          if (summary) {
            uploadedVisualAnalyses.push(
              [
                `UPLOADED IMAGE ${index + 1}: ${image.name || "image"}`,
                summary
              ].join("\n")
            );
          }

          if (
            parsed?.designDNA &&
            typeof parsed.designDNA === "object"
          ) {
            referenceDesignDNAs.push(
              normalizeReferenceDesignDNA(
                parsed.designDNA,
                "uploaded-image",
                image.name || `Uploaded image ${index + 1}`
              )
            );
          }
        } catch (parseError) {
          console.error(
            `[Veyra V4 STAGE] PLAN: Uploaded image Reference DNA parsing failed | image=${index + 1}`,
            parseError
          );

          uploadedVisualAnalyses.push(
            [
              `UPLOADED IMAGE ${index + 1}: ${image.name || "image"}`,
              analysis.trim().slice(0, 6000)
            ].join("\n")
          );
        }
      } catch (error) {
        console.error(
          `[Veyra V4 STAGE] PLAN: Uploaded image analysis failed | image=${index + 1}`,
          error
        );
      }
    }

    if (uploadedVisualAnalyses.length) {
      ctx += [
        "",
        "",
        "=== USER UPLOADED VISUAL CONTEXT ===",
        "The following analysis came from images the user directly attached.",
        "Treat this as visual evidence when planning the build.",
        "Follow the user's prompt when deciding whether to preserve, adapt, or improve these references.",
        "",
        uploadedVisualAnalyses.join("\n\n")
      ].join("\n");
    }
  }

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
        let visualSummary = "";

        try {
          console.error(
            "[Veyra V4 STAGE] PLAN: Analyzing reference screenshot"
          );

          visualAnalysis = await callOpenAIVisual(
            [
              "You are Veyra's Website Reference Intelligence system.",
              "Analyze the supplied screenshot as professional web design reference material.",
              "Extract reusable design principles rather than cloning the website.",
              "Focus only on useful visual evidence visible in the screenshot.",
              "Analyze visual direction, composition, hero geometry, focal hierarchy, typography, imagery, cropping, color logic, spacing, density, surfaces, borders, radii, shadows, layering, depth, and motion opportunities.",
              "Identify signature visual moments, strong principles to preserve, weak decisions to improve, and distinctive details that should not be copied literally.",
              "Do not generate website code.",
              "Do not reproduce third-party logos, proprietary copy, distinctive artwork, or exact page geometry.",
              "Do not recommend pixel-for-pixel cloning.",
              "The user's written request takes priority over the reference.",
              "Return ONLY valid JSON with no markdown fences or commentary.",
              'Use this exact top-level structure: {"summary":"","designDNA":{"visualDirection":{"personality":[],"mood":[],"sophistication":"minimal | moderate | high"},"composition":{"heroPattern":"","focalPoint":"","geometry":"","alignment":"","density":"","sectionRhythm":"","asymmetry":"","depth":""},"typography":{"character":"","displayTreatment":"","bodyTreatment":"","scaleRelationship":"","alignment":""},"imagery":{"role":"","scale":"","cropStyle":"","treatment":"","integration":""},"color":{"paletteCharacter":"","contrast":"","accentStrategy":"","surfaceStrategy":""},"spacing":{"whitespace":"","sectionSpacing":"","internalSpacing":""},"surfaces":{"borders":"","radii":"","shadows":"","layering":""},"motion":{"intensity":"","recommendedBehavior":[]},"signatureMoments":[],"preservePrinciples":[],"improvePrinciples":[],"avoidCopying":[]}}'
            ].join("\n"),
            [
              `User request: ${req.prompt}`,
              `Reference URL: ${reference.finalUrl}`,
              `Page title: ${reference.title}`,
              "",
              "Analyze this screenshot and return structured Reference Design DNA."
            ].join("\n"),
            reference.screenshotBase64,
            {
              maxOutputTokens: 3000,
              reasoningEffort: "medium"
            }
          );

          if (visualAnalysis.trim()) {
            try {
              const parsed = extractJson(visualAnalysis);

              visualSummary =
                typeof parsed?.summary === "string"
                  ? parsed.summary.trim()
                  : "";

              if (
                parsed?.designDNA &&
                typeof parsed.designDNA === "object"
              ) {
                referenceDesignDNAs.push(
                  normalizeReferenceDesignDNA(
                    parsed.designDNA,
                    "website-reference",
                    reference.title || reference.finalUrl,
                    reference.finalUrl
                  )
                );
              }
            } catch (parseError) {
              console.error(
                "[Veyra V4 STAGE] PLAN: Website Reference DNA parsing failed; preserving raw analysis.",
                parseError
              );

              visualSummary = visualAnalysis
                .trim()
                .slice(0, 12000);
            }
          }

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
          visualSummary = "";
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
          visualAnalysis: visualSummary
        };

        ctx = [
          ctx,
          "WEBSITE REFERENCE ANALYSIS:",
          "The user supplied this live website as reference material.",
          "The reference was inspected in a real browser. Structured page evidence and, when available, screenshot intelligence are provided below.",
          "Study its information architecture, navigation, calls to action, branding clues, layout, hierarchy, typography, spacing, surfaces, and visual characteristics.",
          "Preserve useful principles and relevant content meaning, but do not copy third-party branding, proprietary copy, distinctive artwork, or exact layout geometry.",
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

      // Fail open without erasing uploaded-image/reference context already collected.
    }
  }

  if (referenceDesignDNAs.length) {
    ctx += [
      "",
      "",
      referenceDesignDNAContext(referenceDesignDNAs)
    ].join("\n");
  }

  console.error(
    "[Veyra V4 STAGE] PLAN: Design Directions"
  );

  let directionContext = "";

  try {
    const rawDesignDirections = await runModel(
      "design",
      DESIGN_DIRECTIONS_SYSTEM,
      ctx,
      {
        maxOutputTokens: 5000,
        reasoningEffort: "low",
        timeoutMs: 55_000
      }
    );

    const designDirections =
      normalizeDesignDirectionSelection(
        extractJson(rawDesignDirections)
      );

    if (designDirections.directions.length !== 3) {
      throw new Error(
        `Design Directions must return exactly 3 concepts; received ${designDirections.directions.length}.`
      );
    }

    if (!designDirections.selectedDirectionId) {
      throw new Error(
        "Design Directions did not select a winning concept."
      );
    }

    directionContext =
      designDirectionContext(designDirections);

    if (!directionContext) {
      throw new Error(
        "Selected Design Direction could not be resolved."
      );
    }

    console.error(
      `[Veyra V4 STAGE] PLAN: Direction selected | id=${designDirections.selectedDirectionId} | score=${designDirections.selection.total}`
    );
  } catch (error) {
    directionContext = [
      "VEYRA DESIGN DIRECTION RECOVERY:",
      "The dedicated Design Directions stage was unavailable.",
      "Continue with an original project-specific direction derived directly from the user's written request, uploaded/reference evidence, and existing project context.",
      "Prioritize a distinctive first viewport, clear hierarchy, intentional typography, truthful imagery, responsive recomposition, and a strong conversion path.",
      "Do not invent business facts or copy third-party branding/layout geometry."
    ].join("\n");

    console.error(
      "[Veyra V4 RECOVERY] Design Directions failed; continuing with deterministic direction | reason=" +
        (error instanceof Error ? error.message : String(error))
    );
  }

  ctx += [
    "",
    "",
    directionContext
  ].join("\n");

  console.error(
    "[Veyra V4 STAGE] PLAN: Design DNA"
  );

  const designDNA = await recoverableDesignDNA(ctx);

  console.error(
    "[Veyra V4 STAGE] PLAN: Composition + assets"
  );

  const [compositionResult, assetsResult] = await Promise.allSettled([
    runModel(
      "design",
      COMPOSITION_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3500,
        reasoningEffort: "low",
        timeoutMs: 60_000
      }
    ),

    runModel(
      "design",
      ASSET_SYSTEM,
      `${ctx}\n\nDESIGN DNA:\n${designDNA}`,
      {
        maxOutputTokens: 3000,
        reasoningEffort: "low",
        timeoutMs: 55_000
      }
    )
  ]);

  const composition =
    compositionResult.status === "fulfilled" &&
    compositionResult.value.trim()
      ? compositionResult.value
      : FALLBACK_COMPOSITION;

  if (compositionResult.status === "rejected") {
    console.error(
      "[Veyra V4 RECOVERY] Composition failed; continuing with deterministic composition fallback | reason=" +
        (compositionResult.reason instanceof Error
          ? compositionResult.reason.message
          : String(compositionResult.reason))
    );
  }

  const assets =
    assetsResult.status === "fulfilled" &&
    assetsResult.value.trim()
      ? assetsResult.value
      : FALLBACK_ASSETS;

  if (assetsResult.status === "rejected") {
    console.error(
      "[Veyra V4 RECOVERY] Asset planning failed; continuing with deterministic asset fallback | reason=" +
        (assetsResult.reason instanceof Error
          ? assetsResult.reason.message
          : String(assetsResult.reason))
    );
  }

  let completionContract = "";

  try {
    const compositionData = extractJson(composition);
    const contract = compositionData?.completion_contract;

    if (contract && typeof contract === "object") {
      const serialized = JSON.stringify(contract, null, 2);

      // Validate immediately. PLAN must never hand BUILD an empty
      // or malformed completion contract.
      parseCompletionContract(serialized);
      completionContract = serialized;
    }
  } catch (error) {
    console.error(
      "[Veyra V4 STAGE] PLAN: composition completion contract invalid",
      error
    );
  }

  if (!completionContract) {
    console.error(
      "[Veyra V4 STAGE] PLAN: deriving deterministic completion contract fallback"
    );

    const promptText = String(req.prompt || "").toLowerCase();

    const requestedSections: CompletionContractItem[] = [];
    const seenSections = new Set<string>();

    const addSection = (id: string, label: string, purpose: string) => {
      if (seenSections.has(id)) return;
      seenSections.add(id);
      requestedSections.push({
        id,
        label,
        purpose,
        required: true
      });
    };

    // A real generated website always needs a primary landing experience.
    addSection(
      "hero",
      "Hero",
      "Establish the project identity and primary value proposition."
    );

    const sectionSignals: Array<[string, string, string[]]> = [
      ["services", "Services", ["services", "service", "offerings"]],
      ["gallery", "Gallery", ["gallery", "portfolio", "work"]],
      ["about", "About", ["about", "story"]],
      ["reviews", "Reviews", ["reviews", "testimonials"]],
      ["location-hours", "Location & Hours", ["location", "hours"]],
      ["contact", "Contact", ["contact"]]
    ];

    for (const [id, label, signals] of sectionSignals) {
      if (signals.some(signal => promptText.includes(signal))) {
        addSection(
          id,
          label,
          `Provide the requested ${label.toLowerCase()} content without inventing unsupported facts.`
        );
      }
    }

    const requiredActions: CompletionContractItem[] = [];

    if (
      promptText.includes("booking") ||
      promptText.includes("book ") ||
      promptText.includes("appointment")
    ) {
      requiredActions.push({
        id: "booking-cta",
        label: "Booking CTA",
        behavior:
          "Provide a real usable booking or appointment action. If no external booking destination was supplied, use a truthful on-page contact/booking interaction rather than inventing a URL.",
        required: true
      });
    } else {
      requiredActions.push({
        id: "primary-cta",
        label: "Primary CTA",
        behavior:
          "Provide a real usable primary conversion action appropriate to the requested website.",
        required: true
      });
    }

    const fallbackContract: CompletionContract = {
      required_sections: requestedSections,
      required_actions: requiredActions,
      required_content: [
        "Preserve the user's requested project identity and requested content."
      ],
      visual_requirements: [
        "Implement the requested visual direction without using broken or fabricated assets."
      ],
      mobile_requirements: [
        "Navigation and the primary conversion action must remain usable on mobile."
      ],
      integrity_rules: [
        "Do not invent unsupported prices, awards, testimonials, statistics, business facts, addresses, hours, or external destinations."
      ]
    };

    completionContract = JSON.stringify(fallbackContract, null, 2);

    // Fail closed here too. If our fallback is ever broken, PLAN stops
    // before Builder/image generation instead of wasting later calls.
    parseCompletionContract(completionContract);
  }

  console.error("[Veyra V4 STAGE] PLAN complete");

  return {
    ok: true,
    stage: "plan",
    plan: {
      designDNA,
      composition,
      assets,
      completionContract
    },
    complete: false
  };
}

export async function orchestrateStudioBuildStage(
  req: StudioBuildRequest,
  plan: V4PlanState
): Promise<V4StageResult> {
  if (
    !plan?.designDNA ||
    !plan?.composition ||
    !plan?.assets ||
    !plan?.completionContract
  ) {
    throw new Error("V4 build stage requires completed planning state.");
  }

  // Fail closed: "{}" or malformed completion state must never
  // silently reach Builder.
  parseCompletionContract(plan.completionContract);

  const ctx = projectContext(req);

  console.error("[Veyra V4 STAGE] BUILD: Resolving real photography assets");

  const resolvedRealPhotos = await resolveRealPhotos(plan.assets);

  // Persist exact photo selections. RECOMPOSE must reuse these URLs
  // instead of searching again and changing the visual identity.
  plan.resolvedRealPhotos = resolvedRealPhotos;

  const resolvedRealPhotoContext =
    realPhotoContext(resolvedRealPhotos);

  console.error(
    `[Veyra V4 STAGE] BUILD: ${resolvedRealPhotos.length} real photography asset(s) ready`
  );

  console.error("[Veyra V4 STAGE] BUILD: Resolving optional generated visual assets");

  const resolvedVisuals = await resolveGeneratedVisuals(plan.assets);

  // Persist exact generated asset metadata into staged V4 state.
  // RECOMPOSE must reuse these URLs and must NEVER regenerate them.
  plan.resolvedVisuals = resolvedVisuals;

  const resolvedVisualContext = generatedVisualContext(resolvedVisuals);

  const creativeDirectives = deriveCreativeDirectives({
    prompt: req.prompt,
    designDNA: plan.designDNA,
    composition: plan.composition,
    assets: plan.assets
  });

  const creativeContext =
    creativeDirectiveContext(creativeDirectives);

  const editabilityContext =
    studioEditingContext();

  const responsivePlan =
    deriveResponsiveDirectorPlan({
      prompt: req.prompt,
      designDNA: plan.designDNA,
      composition: plan.composition,
      assets: plan.assets
    });

  const responsiveContext =
    responsiveDirectorContext(responsivePlan);


  const motionPlan =
    deriveMotionDirectorPlan({
      prompt: req.prompt,
      designDNA: plan.designDNA,
      composition: plan.composition,
      assets: plan.assets
    });

  const motionContext =
    motionDirectorContext(motionPlan);

  const brandPlan =
    deriveBrandSystemPlan({
      prompt: req.prompt,
      designDNA: plan.designDNA,
      composition: plan.composition,
      assets: plan.assets
    });

  const brandContext =
    brandSystemContext(brandPlan);

  console.error(
    `[Veyra V4 STAGE] BUILD: ${resolvedVisuals.length} generated visual asset(s) ready`
  );

  console.error(
    `[Veyra V4 STAGE] BUILD: Creative Directors active | photography=${creativeDirectives.photography.mode} | responsive=${creativeDirectives.responsive.strategy} | motion=${creativeDirectives.motion.intensity}`
  );

  console.error("[Veyra V4 STAGE] BUILD: Generating website");

  const raw = await runModel(
    "code",
    BUILDER_SYSTEM,
    [
      ctx,
      `DESIGN DNA:\n${plan.designDNA}`,
      `COMPOSITION BLUEPRINT:\n${plan.composition}`,
      `VISUAL EXPERIENCE PLAN:\n${plan.assets}`,
      creativeContext,
      responsiveContext,
      motionContext,
      brandContext,
      editabilityContext,
      resolvedRealPhotoContext,
      resolvedVisualContext,
      `MANDATORY COMPLETION CONTRACT:\n${plan.completionContract}`
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

  const candidate = await evaluateCandidate(
    site,
    req,
    plan.completionContract,
    plan.assets,
    resolvedVisuals
  );

  console.error(
    `[Veyra V4 STAGE] BUILD complete | score=${candidate.review.score}`
  );

  if (candidateCanFastAccept(candidate)) {
    const acceptance =
      candidatePasses(candidate) ? "excellent" : "fast";

    console.error(
      `[Veyra V4 STAGE] BUILD accepted without repair | score=${candidate.review.score} | gate=${acceptance}`
    );

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
  if (attempt < 1 || attempt > 4) {
    throw new Error("V4 recomposition attempt must be 1, 2, 3, or 4.");
  }

  // Never allow an invalid "{}" completion state into repair.
  parseCompletionContract(plan.completionContract);

  const ctx = projectContext(req);

  const creativeDirectives = deriveCreativeDirectives({
    prompt: req.prompt,
    designDNA: plan.designDNA,
    composition: plan.composition,
    assets: plan.assets
  });

  const creativeContext =
    creativeDirectiveContext(creativeDirectives);

  const editabilityContext =
    studioEditingContext();

  const responsivePlan =
    deriveResponsiveDirectorPlan({
      prompt: req.prompt,
      designDNA: plan.designDNA,
      composition: plan.composition,
      assets: plan.assets
    });

  const responsiveContext =
    responsiveDirectorContext(responsivePlan);


  const motionPlan =
    deriveMotionDirectorPlan({
      prompt: req.prompt,
      designDNA: plan.designDNA,
      composition: plan.composition,
      assets: plan.assets
    });

  const motionContext =
    motionDirectorContext(motionPlan);

  const brandPlan =
    deriveBrandSystemPlan({
      prompt: req.prompt,
      designDNA: plan.designDNA,
      composition: plan.composition,
      assets: plan.assets
    });

  const brandContext =
    brandSystemContext(brandPlan);

  const current: Candidate = currentState;
  const previousBest: Candidate = bestState;

  const completionFailures =
    current.diagnostics.completionFailures ?? [];

  const needsCompletionRepair =
    completionFailures.length > 0;

  // Attempt 3 exists only as a dedicated visual rescue after
  // completion work consumed the normal two-pass budget.
  // Never spend the rescue pass on another completion repair.
  if (attempt === 3 && needsCompletionRepair) {
    throw new Error(
      "Veyra completion QA still has hard failures before the dedicated visual rescue."
    );
  }

  // Attempt 4 is NOT another creative pass. It exists only when
  // the dedicated visual rescue produced a stronger composition
  // but accidentally broke one or more deterministic contracts.
  if (attempt === 4 && !needsCompletionRepair) {
    throw new Error(
      "V4 post-rescue cleanup was requested without deterministic completion failures."
    );
  }

  const repairMode =
    attempt === 4
      ? "POST_RESCUE_COMPLETION"
      : needsCompletionRepair
        ? "COMPLETION"
        : "VISUAL";

  console.error(
    `[Veyra V4 STAGE] RECOMPOSE ${attempt}/4 | mode=${repairMode}`
  );

  try {
    const completionRepairMode =
      needsCompletionRepair || attempt === 4;

    const repairSystem =
      completionRepairMode
        ? COMPLETION_REPAIR_SYSTEM
        : RECOMPOSE_SYSTEM;

    const repairInstructions =
      completionRepairMode
        ? [
            `ORIGINAL PROJECT:\n${ctx}`,
            `DESIGN DNA:\n${plan.designDNA}`,
            `COMPOSITION BLUEPRINT:\n${plan.composition}`,
            `VISUAL EXPERIENCE PLAN:\n${plan.assets}`,
            creativeContext,
            responsiveContext,
            motionContext,
            brandContext,
            editabilityContext,
            realPhotoContext(plan.resolvedRealPhotos ?? []),
            generatedVisualContext(plan.resolvedVisuals ?? []),
            `MANDATORY COMPLETION CONTRACT:\n${plan.completionContract}`,
            `CURRENT HTML:\n${current.site.html}`,
            `CURRENT CSS:\n${current.site.css}`,
            `CURRENT JS:\n${current.site.js}`,
            `COMPLETION FAILURES:\n${JSON.stringify(
              completionFailures,
              null,
              2
            )}`,
            `BROWSER DIAGNOSTICS:\n${JSON.stringify(
              current.diagnostics,
              null,
              2
            )}`,
            attempt === 4
              ? "POST-RESCUE DETERMINISTIC CLEANUP: 1 of 1"
              : `COMPLETION REPAIR ATTEMPT: ${Math.min(attempt, 2)} of 2`,
            attempt === 4
              ? "Repair ONLY the listed deterministic completion failures introduced by the visual rescue. Preserve the rescued composition, art direction, typography, imagery, spacing, hierarchy, motion, and visual identity. Do not redesign, simplify, flatten, replace, or cosmetically rework successful visual decisions. For action failures, data-veyra-action is only a QA marker and does not count as behavior: use a real internal/external destination, legitimate form submit, or observable JavaScript behavior. Never invent an external destination."
              : "Repair the listed completion failures only. Preserve successful design decisions. For action failures, data-veyra-action is only a QA marker and does not count as behavior: use a real internal/external destination, legitimate form submit, or observable JavaScript behavior. Never invent an external destination."
          ]
        : [
            `ORIGINAL PROJECT:\n${ctx}`,
            `DESIGN DNA:\n${plan.designDNA}`,
            `COMPOSITION BLUEPRINT:\n${plan.composition}`,
            `VISUAL EXPERIENCE PLAN:\n${plan.assets}`,
            creativeContext,
            responsiveContext,
            motionContext,
            brandContext,
            editabilityContext,
            realPhotoContext(plan.resolvedRealPhotos ?? []),
            generatedVisualContext(plan.resolvedVisuals ?? []),
            `MANDATORY COMPLETION CONTRACT:\n${plan.completionContract}`,
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
            `VISUAL RECOMPOSITION PASS: ${attempt === 3 ? "DEDICATED RESCUE" : `${attempt} of 2`}`,
            "Fix the visual cause, not merely the symptom.",
            "The next render must satisfy the screenshot critic, not merely remain technically valid.",
            "Use the supplied generated visual assets as major compositional material when their role requires it.",
            "Treat every low-scoring critic dimension as evidence about the composition. Correct the underlying layout, scale, crop, hierarchy, rhythm, depth, typography/image relationship, or art direction responsible for it.",
            "Do not preserve a weak hero simply because it is technically complete.",
            "Do not preserve repetitive section geometry merely to minimize code changes.",
            "When first-viewport quality is weak, rebuild the first viewport around one unmistakable focal point.",
            "When imagery or visual-plan fidelity is weak, increase the actual compositional role of the supplied imagery rather than adding decoration around it.",
            "When template resistance or brand specificity is weak, remove interchangeable layout grammar and create project-specific section relationships and a signature visual moment.",
            "When depth or cinematic quality is weak, create visible foreground/midground/background relationships, controlled overlap, crop tension, scale contrast, and section continuity where appropriate.",
            "A successful visual rescue may materially replace HTML and CSS. This is a recomposition pass, not a cosmetic patch.",
            "If the critic describes the current page as generic, flat, weak, template-like, under-art-directed, or visually disconnected from the Visual Experience Plan, materially rebuild the composition instead of making cosmetic edits."
          ];

    const repairRaw = await runModel(
      "repair",
      repairSystem,
      repairInstructions.join("\n\n"),
      {
        maxOutputTokens: completionRepairMode
          ? 18000
          : 26000,
        reasoningEffort: "low"
      }
    );

    const repairedSite = parseRepairSite(repairRaw, current.site);

    const repaired = await evaluateCandidate(
      repairedSite,
      req,
      plan.completionContract,
      plan.assets,
      plan.resolvedVisuals ?? []
    );

    const best = better(previousBest, repaired);

    const repairedCompletionHealthy =
      repaired.diagnostics.completionFailures.length === 0 &&
      repaired.diagnostics.hardFailures.length === 0;

    const bestCompletionHealthy =
      best.diagnostics.completionFailures.length === 0 &&
      best.diagnostics.hardFailures.length === 0;

    console.error(
      `[Veyra V4 STAGE] RECOMPOSE ${attempt} complete | mode=${repairMode} | score=${repaired.review.score} | completionFailures=${repaired.diagnostics.completionFailures.length} | hardFailures=${repaired.diagnostics.hardFailures.length} | best=${best.review.score}`
    );

    if (repaired.diagnostics.completionFailures.length > 0) {
      console.error(
        `[Veyra V4 QA] completion failures:\n${repaired.diagnostics.completionFailures
          .map((failure, index) => `  ${index + 1}. ${failure}`)
          .join("\n")}`
      );
    }

    if (repaired.diagnostics.hardFailures.length > 0) {
      console.error(
        `[Veyra V4 QA] hard failures:\n${repaired.diagnostics.hardFailures
          .map((failure, index) => `  ${index + 1}. ${failure}`)
          .join("\n")}`
      );
    }

    // --------------------------------------------------------
    // SUCCESS:
    // Candidate must satisfy BOTH visual and deterministic QA.
    // --------------------------------------------------------

    if (
      repairedCompletionHealthy &&
      candidateCanFastAccept(repaired)
    ) {
      return {
        ok: true,
        stage: "complete",
        plan,
        candidate: repaired,
        best: repaired,
        attempt,
        complete: true,
        result: candidateToResult(repaired)
      };
    }

    // --------------------------------------------------------
    // NORMAL REPAIR BUDGET
    // --------------------------------------------------------

    if (attempt < 2) {
      return {
        ok: true,
        stage: "recompose",
        plan,
        candidate: repaired,
        best,
        attempt,
        complete: false
      };
    }

    // --------------------------------------------------------
    // ATTEMPT 2:
    //
    // If deterministic completion is finally healthy but visual
    // acceptance still fails, do NOT immediately kill the build.
    //
    // Completion work may have consumed both normal repair turns.
    // Grant exactly one dedicated VISUAL rescue pass.
    // --------------------------------------------------------

    if (attempt === 2) {
      if (!repairedCompletionHealthy) {
        console.error(
          `[Veyra V4 STAGE] RECOMPOSE attempt 2 visual work introduced deterministic failures | completionFailures=${repaired.diagnostics.completionFailures.length} | hardFailures=${repaired.diagnostics.hardFailures.length} | routing directly to bounded deterministic cleanup`
        );

        return {
          ok: true,
          stage: "recompose",
          plan,
          candidate: repaired,
          best,
          attempt: 3,
          complete: false
        };
      }

      console.error(
        `[Veyra V4 STAGE] RECOMPOSE completion healthy but visual acceptance still failed | score=${repaired.review.score} | granting dedicated visual rescue`
      );

      return {
        ok: true,
        stage: "recompose",
        plan,
        candidate: repaired,
        best,
        attempt,
        complete: false
      };
    }

    // --------------------------------------------------------
    // ATTEMPT 3:
    // DEDICATED VISUAL RESCUE RESULT.
    //
    // If the rescue itself introduces deterministic failures,
    // preserve that rescued candidate and grant exactly one
    // non-creative completion cleanup pass.
    // --------------------------------------------------------

    if (attempt === 3) {
      if (!repairedCompletionHealthy) {
        console.error(
          `[Veyra V4 STAGE] RECOMPOSE visual rescue improved/rebuilt composition but introduced deterministic failures | completionFailures=${repaired.diagnostics.completionFailures.length} | hardFailures=${repaired.diagnostics.hardFailures.length} | granting post-rescue cleanup`
        );

        return {
          ok: true,
          stage: "recompose",
          plan,
          candidate: repaired,
          best,
          attempt,
          complete: false
        };
      }

      if (candidateCanFastAccept(repaired)) {
        console.error(
          `[Veyra V4 STAGE] RECOMPOSE visual rescue complete | accepted rescued candidate | score=${repaired.review.score}`
        );

        return {
          ok: true,
          stage: "complete",
          plan,
          candidate: repaired,
          best: repaired,
          attempt,
          complete: true,
          result: candidateToResult(repaired)
        };
      }

      const bestVisuallyAccepted =
        bestCompletionHealthy &&
        candidateCanFastAccept(best);

      if (bestVisuallyAccepted) {
        console.error(
          `[Veyra V4 STAGE] RECOMPOSE visual rescue complete | accepted best candidate | score=${best.review.score}`
        );

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

      throw new Error(
        `Veyra visual QA did not reach the required premium acceptance standard after the dedicated visual rescue. Best visual score: ${best.review.score}.`
      );
    }

    // --------------------------------------------------------
    // ATTEMPT 4:
    // POST-RESCUE DETERMINISTIC CLEANUP.
    //
    // No additional creative iteration is allowed here.
    // Cleanup must restore deterministic health while preserving
    // the rescued visual composition. The cleaned result still
    // has to pass the screenshot critic normally.
    // --------------------------------------------------------

    if (attempt === 4) {
      if (!repairedCompletionHealthy) {
        throw new Error(
          "Veyra post-rescue completion cleanup could not restore deterministic website health."
        );
      }

      if (!candidateCanFastAccept(repaired)) {
        throw new Error(
          `Veyra post-rescue cleanup restored deterministic health but the final visual result did not meet the premium acceptance standard. Final visual score: ${repaired.review.score}.`
        );
      }

      console.error(
        `[Veyra V4 STAGE] RECOMPOSE post-rescue cleanup complete | deterministic + visual QA accepted | score=${repaired.review.score}`
      );

      return {
        ok: true,
        stage: "complete",
        plan,
        candidate: repaired,
        best: repaired,
        attempt,
        complete: true,
        result: candidateToResult(repaired)
      };
    }

    throw new Error(
      "Veyra recomposition reached an invalid terminal state."
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `[Veyra V4 STAGE] RECOMPOSE ${attempt} failed | error=${detail}`
    );

    const previousBestHealthy =
      previousBest.diagnostics.completionFailures.length === 0 &&
      previousBest.diagnostics.hardFailures.length === 0;

    const previousBestAccepted =
      previousBestHealthy &&
      candidateCanFastAccept(previousBest);

    // A repair-model failure may fall back ONLY to a candidate
    // that already passed BOTH deterministic and visual QA.
    if (previousBestAccepted) {
      console.error(
        `[Veyra V4 STAGE] RECOMPOSE repair failed | falling back to previously accepted candidate | score=${previousBest.review.score}`
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

    if (previousBestHealthy) {
      console.error(
        `[Veyra V4 STAGE] RECOMPOSE repair failed | previous candidate is technically healthy but visually unaccepted | score=${previousBest.review.score} | refusing Website Ready`
      );
    }

    // Fail closed. Never tell Studio an incomplete OR visually
    // substandard website that it is ready.
    throw new Error(
      `Veyra could not complete the website to the required quality standard: ${detail}`
    );
  }
}
