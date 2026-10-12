import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";
const client=env.ANTHROPIC_API_KEY?new Anthropic({apiKey:env.ANTHROPIC_API_KEY}):null;
export async function callAnthropic(system:string,input:string){if(!client)throw new Error("ANTHROPIC_API_KEY is not configured");const message=await client.messages.create({model:env.ANTHROPIC_MODEL,max_tokens:4096,system,messages:[{role:"user",content:input}]});return message.content.filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n");}
