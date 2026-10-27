import {
  guardPhotoSearch
} from "../runtime/cost-guard.js";
export type RealPhotoOrientation =
  | "landscape"
  | "portrait"
  | "squarish";

export type RealPhotoRole =
  | "hero"
  | "supporting"
  | "gallery"
  | "background"
  | "detail";

export type RealPhotoSubjectPlacement =
  | "left"
  | "center"
  | "right"
  | "auto";

export type RealPhotoTextSafeArea =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "none"
  | "auto";

export type RealPhotoMobileCrop =
  | "center"
  | "subject"
  | "top"
  | "bottom";

export interface RealPhotoSearchOptions {
  orientation?: RealPhotoOrientation;
  perPage?: number;

  /*
   * Slot-aware art direction.
   *
   * These fields describe what Veyra WANTS from the slot.
   * They do not pretend Unsplash metadata tells us where a
   * photographed subject physically appears in the frame.
   */
  role?: RealPhotoRole;
  aspectRatio?: number;
  subjectPlacement?: RealPhotoSubjectPlacement;
  textSafeArea?: RealPhotoTextSafeArea;
  mobileCrop?: RealPhotoMobileCrop;

  excludeIds?: string[];
  requiredTerms?: string[];
  avoidTerms?: string[];
}

export interface RealPhotoArtDirection {
  role: RealPhotoRole;
  orientation: RealPhotoOrientation;
  targetAspectRatio: number;
  subjectPlacement: RealPhotoSubjectPlacement;
  textSafeArea: RealPhotoTextSafeArea;
  mobileCrop: RealPhotoMobileCrop;

  cropStrategy:
    | "editorial-cover"
    | "balanced-cover"
    | "gallery-cover"
    | "detail-cover";

  desktopObjectPosition: string;
  mobileObjectPosition: string;

  instructions: string[];
}

export interface ResolvedRealPhoto {
  id: string;
  provider: "unsplash";

  url: string;
  rawUrl: string;

  width: number;
  height: number;

  orientation: RealPhotoOrientation;
  aspectRatio: number;

  alt: string;

  photographerName: string;
  photographerUrl: string;
  sourceUrl: string;

  score: number;
  artDirection: RealPhotoArtDirection;
}

interface UnsplashSearchPhoto {
  id?: unknown;

  width?: unknown;
  height?: unknown;

  alt_description?: unknown;
  description?: unknown;

  urls?: {
    raw?: unknown;
    full?: unknown;
    regular?: unknown;
  };

  links?: {
    html?: unknown;
  };

  user?: {
    name?: unknown;

    links?: {
      html?: unknown;
    };
  };
}

interface UnsplashSearchResponse {
  results?: unknown;
}

interface RankedPhoto {
  photo: ResolvedRealPhoto;
  originalIndex: number;
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function positiveNumber(value: unknown): number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  )
    ? value
    : 0;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.max(
    minimum,
    Math.min(maximum, value)
  );
}

function normalizedTerms(
  values: Array<string | undefined>
): string[] {
  const stop = new Set([
    "a",
    "an",
    "and",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with"
  ]);

  return Array.from(
    new Set(
      values
        .flatMap(value =>
          (value ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .split(/\s+/)
        )
        .map(value => value.trim())
        .filter(value =>
          value.length >= 2 &&
          !stop.has(value)
        )
    )
  );
}

function orientationForDimensions(
  width: number,
  height: number
): RealPhotoOrientation {
  if (!width || !height) {
    return "landscape";
  }

  const ratio = width / height;

  if (ratio > 1.12) {
    return "landscape";
  }

  if (ratio < 0.89) {
    return "portrait";
  }

  return "squarish";
}

function defaultAspectRatio(
  orientation: RealPhotoOrientation
): number {
  if (orientation === "portrait") {
    return 4 / 5;
  }

  if (orientation === "squarish") {
    return 1;
  }

  return 3 / 2;
}

function desiredDimensions(
  orientation: RealPhotoOrientation,
  targetAspectRatio: number
): {
  width: number;
  height: number;
} {
  const ratio =
    Number.isFinite(targetAspectRatio) &&
    targetAspectRatio > 0
      ? targetAspectRatio
      : defaultAspectRatio(orientation);

  if (ratio >= 1) {
    const width = 1800;

    return {
      width,
      height: Math.max(
        900,
        Math.round(width / ratio)
      )
    };
  }

  const height = 1600;

  return {
    width: Math.max(
      900,
      Math.round(height * ratio)
    ),
    height
  };
}

function withVeyraImageParams(
  rawUrl: string,
  orientation: RealPhotoOrientation,
  targetAspectRatio: number
): string {
  try {
    const url = new URL(rawUrl);

    const dimensions = desiredDimensions(
      orientation,
      targetAspectRatio
    );

    url.searchParams.set("auto", "format");
    url.searchParams.set("fit", "crop");
    url.searchParams.set("q", "85");
    url.searchParams.set(
      "w",
      String(dimensions.width)
    );
    url.searchParams.set(
      "h",
      String(dimensions.height)
    );

    return url.toString();
  } catch {
    return rawUrl;
  }
}

function normalizedRole(
  role?: RealPhotoRole
): RealPhotoRole {
  return role ?? "supporting";
}

function artDirectionFor(
  options: RealPhotoSearchOptions
): RealPhotoArtDirection {
  const orientation =
    options.orientation === "portrait" ||
    options.orientation === "squarish"
      ? options.orientation
      : "landscape";

  const role = normalizedRole(options.role);

  const targetAspectRatio =
    Number.isFinite(options.aspectRatio) &&
    Number(options.aspectRatio) > 0
      ? Number(options.aspectRatio)
      : defaultAspectRatio(orientation);

  const subjectPlacement =
    options.subjectPlacement ?? "auto";

  const textSafeArea =
    options.textSafeArea ?? "auto";

  const mobileCrop =
    options.mobileCrop ?? "subject";

  const desktopObjectPosition =
    subjectPlacement === "left"
      ? "35% 50%"
      : subjectPlacement === "right"
        ? "65% 50%"
        : "50% 50%";

  const mobileObjectPosition =
    mobileCrop === "top"
      ? "50% 25%"
      : mobileCrop === "bottom"
        ? "50% 75%"
        : subjectPlacement === "left"
          ? "40% 50%"
          : subjectPlacement === "right"
            ? "60% 50%"
            : "50% 50%";

  const cropStrategy =
    role === "hero" ||
    role === "background"
      ? "editorial-cover"
      : role === "gallery"
        ? "gallery-cover"
        : role === "detail"
          ? "detail-cover"
          : "balanced-cover";

  const instructions = [
    role === "hero"
      ? "Treat this photograph as major first-viewport compositional material."
      : role === "background"
        ? "Use this photograph as a large atmospheric compositional surface without sacrificing text readability."
        : role === "gallery"
          ? "Use a consistent gallery crop and rhythm with neighboring imagery."
          : role === "detail"
            ? "Use this as a focused supporting detail rather than a competing hero."
            : "Use this as supporting editorial photography that strengthens the primary composition.",

    textSafeArea === "left"
      ? "Preserve useful negative space on the left for typography or controls."
      : textSafeArea === "right"
        ? "Preserve useful negative space on the right for typography or controls."
        : textSafeArea === "top"
          ? "Preserve useful negative space near the top."
          : textSafeArea === "bottom"
            ? "Preserve useful negative space near the bottom."
            : textSafeArea === "none"
              ? "No dedicated text-safe region is required."
              : "Choose typography placement after evaluating the crop; do not cover important subject matter.",

    subjectPlacement === "left"
      ? "Bias the visible subject toward the left side of the crop when the source image supports it."
      : subjectPlacement === "right"
        ? "Bias the visible subject toward the right side of the crop when the source image supports it."
        : subjectPlacement === "center"
          ? "Keep the primary visual subject centered when appropriate."
          : "Choose subject placement according to the surrounding composition.",

    mobileCrop === "top"
      ? "On mobile, bias the crop toward the upper portion of the source."
      : mobileCrop === "bottom"
        ? "On mobile, bias the crop toward the lower portion of the source."
        : mobileCrop === "center"
          ? "On mobile, use a centered crop."
          : "On mobile, recrop around the meaningful subject instead of blindly preserving the desktop frame."
  ];

  return {
    role,
    orientation,
    targetAspectRatio,
    subjectPlacement,
    textSafeArea,
    mobileCrop,
    cropStrategy,
    desktopObjectPosition,
    mobileObjectPosition,
    instructions
  };
}

function semanticScore(
  query: string,
  alt: string,
  requiredTerms: string[],
  avoidTerms: string[]
): number {
  const queryTerms =
    normalizedTerms([query]);

  const candidateTerms =
    new Set(normalizedTerms([alt]));

  let score = 0;

  for (const term of queryTerms) {
    if (candidateTerms.has(term)) {
      score += 6;
    }
  }

  for (const term of requiredTerms) {
    if (candidateTerms.has(term)) {
      score += 10;
    } else {
      score -= 3;
    }
  }

  for (const term of avoidTerms) {
    if (candidateTerms.has(term)) {
      score -= 18;
    }
  }

  return score;
}

function aspectScore(
  width: number,
  height: number,
  targetAspectRatio: number,
  desiredOrientation: RealPhotoOrientation
): number {
  if (!width || !height) {
    return -10;
  }

  const ratio = width / height;

  const ratioDifference =
    Math.abs(
      Math.log(
        Math.max(ratio, 0.01) /
        Math.max(targetAspectRatio, 0.01)
      )
    );

  const ratioScore =
    35 * Math.exp(-2.25 * ratioDifference);

  const actualOrientation =
    orientationForDimensions(width, height);

  const orientationBonus =
    actualOrientation === desiredOrientation
      ? 12
      : 0;

  return ratioScore + orientationBonus;
}

function resolutionScore(
  width: number,
  height: number,
  role: RealPhotoRole
): number {
  if (!width || !height) {
    return -8;
  }

  const megapixels =
    (width * height) / 1_000_000;

  const target =
    role === "hero" ||
    role === "background"
      ? 8
      : 4;

  return (
    clamp(megapixels / target, 0, 1) * 15
  );
}

function roleScore(
  width: number,
  height: number,
  role: RealPhotoRole
): number {
  if (!width || !height) {
    return 0;
  }

  const ratio = width / height;

  if (
    role === "hero" ||
    role === "background"
  ) {
    return ratio >= 1.25
      ? 8
      : 0;
  }

  if (role === "gallery") {
    return ratio >= 0.75 && ratio <= 1.5
      ? 5
      : 0;
  }

  return 3;
}

function rankPhoto(
  query: string,
  photo: UnsplashSearchPhoto,
  originalIndex: number,
  options: RealPhotoSearchOptions,
  artDirection: RealPhotoArtDirection
): RankedPhoto | null {
  const id = text(photo.id);

  const rawUrl =
    text(photo.urls?.raw) ||
    text(photo.urls?.full) ||
    text(photo.urls?.regular);

  if (
    !id ||
    !rawUrl ||
    !rawUrl.startsWith("https://")
  ) {
    return null;
  }

  const excluded =
    new Set(
      (options.excludeIds ?? [])
        .map(value => value.trim())
        .filter(Boolean)
    );

  if (excluded.has(id)) {
    return null;
  }

  const width =
    positiveNumber(photo.width);

  const height =
    positiveNumber(photo.height);

  const alt =
    text(photo.alt_description) ||
    text(photo.description) ||
    query;

  const requiredTerms =
    normalizedTerms(
      options.requiredTerms ?? []
    );

  const avoidTerms =
    normalizedTerms(
      options.avoidTerms ?? []
    );

  const score =
    semanticScore(
      query,
      alt,
      requiredTerms,
      avoidTerms
    ) +
    aspectScore(
      width,
      height,
      artDirection.targetAspectRatio,
      artDirection.orientation
    ) +
    resolutionScore(
      width,
      height,
      artDirection.role
    ) +
    roleScore(
      width,
      height,
      artDirection.role
    );

  return {
    originalIndex,
    photo: {
      id,
      provider: "unsplash",

      url: withVeyraImageParams(
        rawUrl,
        artDirection.orientation,
        artDirection.targetAspectRatio
      ),

      rawUrl,

      width,
      height,

      orientation:
        orientationForDimensions(
          width,
          height
        ),

      aspectRatio:
        width && height
          ? width / height
          : artDirection.targetAspectRatio,

      alt,

      photographerName:
        text(photo.user?.name),

      photographerUrl:
        text(photo.user?.links?.html),

      sourceUrl:
        text(photo.links?.html),

      score:
        Math.round(score * 100) / 100,

      artDirection
    }
  };
}

export function isRealPhotoSearchConfigured(): boolean {
  return Boolean(
    process.env.UNSPLASH_ACCESS_KEY?.trim()
  );
}

export async function searchRealPhotos(
  query: string,
  options: RealPhotoSearchOptions = {}
): Promise<ResolvedRealPhoto[]> {
  const accessKey =
    process.env.UNSPLASH_ACCESS_KEY?.trim();

  if (!accessKey) {
    return [];
  }

  const cleanedQuery =
    query
      .replace(/\s+/g, " ")
      .trim();

  if (!cleanedQuery) {
    return [];
  }

  const artDirection =
    artDirectionFor(options);

  const perPage = Math.max(
    1,
    Math.min(
      20,
      Math.floor(options.perPage ?? 8)
    )
  );

  const endpoint =
    new URL(
      "https://api.unsplash.com/search/photos"
    );

  endpoint.searchParams.set(
    "query",
    cleanedQuery
  );

  endpoint.searchParams.set(
    "orientation",
    artDirection.orientation
  );

  endpoint.searchParams.set(
    "per_page",
    String(perPage)
  );

  endpoint.searchParams.set(
    "content_filter",
    "high"
  );

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      8_000
    );

  let response: Response;

  try {
    guardPhotoSearch();

    response = await fetch(endpoint, {
      method: "GET",

      headers: {
        Authorization:
          `Client-ID ${accessKey}`,

        "Accept-Version": "v1"
      },

      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(
      `Unsplash photo search failed (${response.status} ${response.statusText}).`
    );
  }

  const body =
    (await response.json()) as UnsplashSearchResponse;

  const results =
    Array.isArray(body.results)
      ? (
          body.results as UnsplashSearchPhoto[]
        )
      : [];

  return results
    .map(
      (
        photo,
        index
      ): RankedPhoto | null =>
        rankPhoto(
          cleanedQuery,
          photo,
          index,
          options,
          artDirection
        )
    )
    .filter(
      (
        ranked
      ): ranked is RankedPhoto =>
        ranked !== null
    )
    .sort((a, b) => {
      const scoreDifference =
        b.photo.score -
        a.photo.score;

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      /*
       * Deterministic tie-break:
       * preserve provider ordering.
       */
      return (
        a.originalIndex -
        b.originalIndex
      );
    })
    .map(ranked => ranked.photo);
}
