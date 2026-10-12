import Fastify from "fastify";import cors from "@fastify/cors";import {env} from "./config.js";import {ensureSchema} from "./state/project-store.js";import {routeCanvas} from "./router/canvas-router.js";import {amplifyFeature} from "./router/feature-router.js";import {selfHeal} from "./repair/self-heal.js";import {deployProject} from "./deploy/deployer.js";
import {orchestrateStudio} from "./agents/studio-orchestrator.js";
const app=Fastify({logger:true});await app.register(cors,{origin:true,credentials:true});if (env.DATABASE_URL) await ensureSchema();app.get("/health",async()=>({ok:true,service:"veyra-omni-engine"}));
app.post("/v1/studio/build", async (req, reply) => {
  try {
    return await orchestrateStudio(req.body as any);
  } catch (e: any) {
    req.log.error(e);
    return reply.code(400).send({ ok: false, error: e.message });
  }
});app.post("/v1/canvas/interpret",async(req,reply)=>{try{return await routeCanvas(req.body)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/canvas/mutate",async(req,reply)=>{try{return await routeCanvas(req.body)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/features/amplify",async(req,reply)=>{try{return await amplifyFeature(req.body)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/repair",async(req,reply)=>{try{return await selfHeal(req.body as any)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/deploy",async(req,reply)=>{try{return await deployProject(req.body as any)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});await app.listen({port:env.PORT,host:"0.0.0.0"});
