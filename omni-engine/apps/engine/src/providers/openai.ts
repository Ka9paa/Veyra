import OpenAI from "openai";
import { env } from "../config.js";
const client=env.OPENAI_API_KEY?new OpenAI({apiKey:env.OPENAI_API_KEY}):null;
export async function callOpenAI(instructions:string,input:string){if(!client)throw new Error("OPENAI_API_KEY is not configured");const response=await client.responses.create({model:env.OPENAI_MODEL,instructions,input,store:false,text:{format:{type:"text"}}});return response.output_text??"";}
