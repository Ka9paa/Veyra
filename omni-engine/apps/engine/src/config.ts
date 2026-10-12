import "dotenv/config";
import { z } from "zod";
const Env=z.object({OPENAI_API_KEY:z.string().optional(),OPENAI_MODEL:z.string().default("gpt-5.6-sol"),ANTHROPIC_API_KEY:z.string().optional(),ANTHROPIC_MODEL:z.string().default("claude-3-5-sonnet-latest"),DATABASE_URL:z.string().optional(),REDIS_URL:z.string().optional(),VEYRA_SIGNING_SECRET:z.string().min(16).optional(),PORT:z.coerce.number().default(8787),DEPLOY_PROVIDER:z.string().default("vercel"),VERCEL_TOKEN:z.string().optional(),VERCEL_TEAM_ID:z.string().optional()});
export const env=Env.parse(process.env);
