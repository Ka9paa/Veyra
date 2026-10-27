export interface RealPhotoSearchOptions {
  orientation?: "landscape" | "portrait" | "squarish";
  perPage?: number;
}

export interface ResolvedRealPhoto {
  id: string;
  provider: "unsplash";
  url: string;
  rawUrl: string;
  width: number;
  height: number;
  alt: string;
  photographerName: string;
  photographerUrl: string;
  sourceUrl: string;
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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : 0;
}

function withVeyraImageParams(
  rawUrl: string,
  orientation: RealPhotoSearchOptions["orientation"]
): string {
  try {
    const url = new URL(rawUrl);

    // Unsplash's returned image URLs support Imgix transforms.
    // Give Builder a production-friendly image rather than an enormous original.
    url.searchParams.set("auto", "format");
    url.searchParams.set("fit", "crop");
    url.searchParams.set("q", "85");

    if (orientation === "portrait") {
      url.searchParams.set("w", "1200");
      url.searchParams.set("h", "1600");
    } else if (orientation === "squarish") {
      url.searchParams.set("w", "1400");
      url.searchParams.set("h", "1400");
    } else {
      url.searchParams.set("w", "1800");
      url.searchParams.set("h", "1200");
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function isRealPhotoSearchConfigured(): boolean {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY?.trim());
}

export async function searchRealPhotos(
  query: string,
  options: RealPhotoSearchOptions = {}
): Promise<ResolvedRealPhoto[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY?.trim();

  if (!accessKey) {
    return [];
  }

  const cleanedQuery = query.replace(/\s+/g, " ").trim();

  if (!cleanedQuery) {
    return [];
  }

  const orientation =
    options.orientation === "portrait" ||
    options.orientation === "squarish"
      ? options.orientation
      : "landscape";

  const perPage = Math.max(
    1,
    Math.min(10, Math.floor(options.perPage ?? 6))
  );

  const endpoint = new URL(
    "https://api.unsplash.com/search/photos"
  );

  endpoint.searchParams.set("query", cleanedQuery);
  endpoint.searchParams.set("orientation", orientation);
  endpoint.searchParams.set("per_page", String(perPage));
  endpoint.searchParams.set("content_filter", "high");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    8_000
  );

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Client-ID ${accessKey}`,
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

  const results = Array.isArray(body.results)
    ? (body.results as UnsplashSearchPhoto[])
    : [];

  return results
    .map((photo): ResolvedRealPhoto | null => {
      const id = text(photo.id);
      const rawUrl =
        text(photo.urls?.raw) ||
        text(photo.urls?.full) ||
        text(photo.urls?.regular);

      if (!id || !rawUrl || !rawUrl.startsWith("https://")) {
        return null;
      }

      const sourceUrl = text(photo.links?.html);
      const photographerName = text(photo.user?.name);
      const photographerUrl = text(photo.user?.links?.html);

      const alt =
        text(photo.alt_description) ||
        text(photo.description) ||
        cleanedQuery;

      return {
        id,
        provider: "unsplash",
        url: withVeyraImageParams(rawUrl, orientation),
        rawUrl,
        width: positiveNumber(photo.width),
        height: positiveNumber(photo.height),
        alt,
        photographerName,
        photographerUrl,
        sourceUrl
      };
    })
    .filter(
      (photo): photo is ResolvedRealPhoto =>
        photo !== null
    );
}
