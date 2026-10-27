import { put } from "@vercel/blob";
import {
  generateVeyraVisual,
  type VeyraVisualGenerationOptions
} from "./openai.js";

export interface StoredVeyraVisual {
  id: string;
  url: string;
  pathname: string;
  contentType: "image/png";
  bytes: number;
  model: string;
}

export function isVeyraVisualStorageConfigured(): boolean {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();

  const oidcReady =
    Boolean(process.env.VERCEL_OIDC_TOKEN?.trim()) &&
    Boolean(process.env.BLOB_STORE_ID?.trim());

  return Boolean(blobToken || oidcReady);
}

function safeSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return cleaned || "asset";
}

function validatePng(buffer: Buffer): void {
  // PNG signature:
  // 89 50 4E 47 0D 0A 1A 0A
  const signature = [
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a
  ];

  if (buffer.length < signature.length) {
    throw new Error("Generated visual is too small to be a valid PNG.");
  }

  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) {
      throw new Error("Generated visual did not contain a valid PNG signature.");
    }
  }

  // Guard against obviously broken/empty image responses.
  if (buffer.length < 10_000) {
    throw new Error(
      `Generated visual is unexpectedly small (${buffer.length} bytes).`
    );
  }

  // Keep a runaway response from becoming a giant Studio asset.
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error(
      `Generated visual exceeds Veyra's 20 MB asset limit (${buffer.length} bytes).`
    );
  }
}

export async function generateAndStoreVeyraVisual(
  assetId: string,
  prompt: string,
  options: VeyraVisualGenerationOptions = {}
): Promise<StoredVeyraVisual> {
  const id = safeSegment(assetId);

  const generated = await generateVeyraVisual(prompt, options);

  let buffer: Buffer;

  try {
    buffer = Buffer.from(generated.data, "base64");
  } catch {
    throw new Error(`Could not decode generated visual "${id}".`);
  }

  validatePng(buffer);

  const pathname =
    `veyra/generated/${Date.now()}-${id}.png`;

  const stored = await put(pathname, buffer, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: true,
    cacheControlMaxAge: 60 * 60 * 24 * 30
  });

  if (
    !stored?.url ||
    typeof stored.url !== "string" ||
    !stored.url.startsWith("https://")
  ) {
    throw new Error(
      `Blob storage returned an invalid URL for generated visual "${id}".`
    );
  }

  return {
    id,
    url: stored.url,
    pathname: stored.pathname,
    contentType: "image/png",
    bytes: buffer.length,
    model: generated.model
  };
}
