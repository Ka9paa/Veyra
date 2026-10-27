import {buildAssetLibrary,findAsset,assetsForSection} from "./studio/asset-library.js";
import {
  runtimeCostSnapshot
} from "./runtime/cost-guard.js";
import {
  findSectionById,
  sectionRegenerationContext,
  assetRegenerationContext
} from "./studio/section-regeneration.js";
import Fastify from "fastify";import cors from "@fastify/cors";import {env} from "./config.js";import {ensureSchema} from "./state/project-store.js";import {routeCanvas} from "./router/canvas-router.js";import {amplifyFeature} from "./router/feature-router.js";import {selfHeal} from "./repair/self-heal.js";import {deployProject} from "./deploy/deployer.js";
import {orchestrateStudio} from "./agents/studio-orchestrator.js";
const app=Fastify({logger:true});

await app.register(cors,{
  origin:true,
  credentials:true
});

let databaseStartupError: string | null = null;

if(env.DATABASE_URL){
  try{
    await ensureSchema();
  }catch(error:any){
    databaseStartupError =
      error?.message ||
      "Database initialization failed.";

    app.log.error(
      {err:error},
      "Veyra database unavailable during startup; engine continuing in degraded mode."
    );
  }
}

app.get("/health",async()=>({
  ok:true,
  service:"veyra-omni-engine",
  status:databaseStartupError
    ? "degraded"
    : "healthy",
  dependencies:{
    database:{
      configured:Boolean(env.DATABASE_URL),
      available:!databaseStartupError,
      error:databaseStartupError
    }
  },
  cost:runtimeCostSnapshot()
}));

app.post("/v1/studio/assets",async(req,reply)=>{
  try{
    const body=(req.body||{}) as any;
    const html=String(body.html||body.current?.html||"");

    if(!html.trim())
      return reply.code(400).send({ok:false,error:"Project HTML is required."});

    const library=buildAssetLibrary(html);

    return {
      ok:true,
      library,
      asset:body.asset_id?findAsset(library,String(body.asset_id)):null,
      sectionAssets:body.section_id?assetsForSection(library,String(body.section_id)):null
    };
  }catch(error:any){
    req.log.error(error);
    return reply.code(400).send({
      ok:false,
      error:error?.message||"Unable to build asset library."
    });
  }
});

app.post("/v1/studio/regenerate", async (req, reply) => {
  try {
    const body = (req.body || {}) as any;
    const mode = String(body.mode || "").trim();
    const instruction = String(body.instruction || "").trim();

    if (!instruction) {
      return reply.code(400).send({
        ok: false,
        error: "A regeneration instruction is required."
      });
    }

    const current = body.current || {};
    const currentHtml = String(current.html || "");
    const currentCss = String(current.css || "");
    const currentJs = String(current.js || "");

    if (!currentHtml) {
      return reply.code(400).send({
        ok: false,
        error: "Current project HTML is required."
      });
    }

    if (mode === "section") {
      const sectionId = String(body.section_id || "").trim();

      if (!sectionId) {
        return reply.code(400).send({
          ok: false,
          error: "A section id is required."
        });
      }

      const target = findSectionById(currentHtml, sectionId);

      if (!target) {
        return reply.code(404).send({
          ok: false,
          error: `Section "${sectionId}" was not found.`
        });
      }

      const context = sectionRegenerationContext(
        {
          projectId: body.project_id
            ? String(body.project_id)
            : undefined,
          sectionId,
          instruction,
          currentHtml,
          currentCss,
          currentJs,
          preserveOutsideSection: true
        },
        currentHtml
      );

      return {
        ok: true,
        ready: true,
        mode: "section",
        sectionId,
        targetHtml: target.html,
        context,
        contract: {
          preserveOutsideSection: true,
          preserveGlobalBrandSystem: true,
          preserveWorkingInteractions: true,
          preserveUnrelatedAssets: true
        },
        execution: "contract-ready"
      };
    }

    if (mode === "asset") {
      const asset = body.asset || {};
      const assetId = String(asset.id || "").trim();

      if (!assetId) {
        return reply.code(400).send({
          ok: false,
          error: "An asset id is required."
        });
      }

      const context = assetRegenerationContext({
        assetId,
        sectionId: asset.section_id
          ? String(asset.section_id)
          : undefined,
        instruction,
        currentUrl: asset.current_url
          ? String(asset.current_url)
          : undefined,
        kind:
          asset.kind === "background" ||
          asset.kind === "visual"
            ? asset.kind
            : "image"
      });

      return {
        ok: true,
        ready: true,
        mode: "asset",
        assetId,
        context,
        contract: {
          preserveLayout: true,
          preserveCopy: true,
          preserveUnrelatedAssets: true,
          preserveOutsideTarget: true
        },
        execution: "contract-ready"
      };
    }

    return reply.code(400).send({
      ok: false,
      error: "Regeneration mode must be section or asset."
    });
  } catch (e: any) {
    req.log.error(e);

    return reply.code(400).send({
      ok: false,
      error: e?.message || "Targeted regeneration failed."
    });
  }
});

app.post("/v1/studio/build", async (req, reply) => {
  try {
    return await orchestrateStudio(req.body as any);
  } catch (e: any) {
    req.log.error(e);
    return reply.code(400).send({ ok: false, error: e.message });
  }
});app.post("/v1/canvas/interpret",async(req,reply)=>{try{return await routeCanvas(req.body)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/canvas/mutate",async(req,reply)=>{try{return await routeCanvas(req.body)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/features/amplify",async(req,reply)=>{try{return await amplifyFeature(req.body)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/repair",async(req,reply)=>{try{return await selfHeal(req.body as any)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});app.post("/v1/deploy",async(req,reply)=>{try{return await deployProject(req.body as any)}catch(e:any){req.log.error(e);return reply.code(400).send({ok:false,error:e.message})}});await app.listen({port:env.PORT,host:"0.0.0.0"});
