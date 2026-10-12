import { callOpenAI } from "./openai.js";import { callAnthropic } from "./anthropic.js";
export type ModelLane="planner"|"code"|"design"|"repair";
export async function runModel(lane:ModelLane,system:string,input:string){if(lane==="design"){try{return await callAnthropic(system,input)}catch{return await callOpenAI(system,input)}}try{return await callOpenAI(system,input)}catch{return await callAnthropic(system,input)}}
