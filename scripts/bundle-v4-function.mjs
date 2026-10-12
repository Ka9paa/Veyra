import { build } from "esbuild";
import path from "node:path";

const root = process.cwd();

const optionalBidiModules = new Set([
  "chromium-bidi/lib/cjs/bidiMapper/BidiMapper",
  "chromium-bidi/lib/cjs/cdp/CdpConnection"
]);

await build({
  entryPoints: [
    path.join(
      root,
      "omni-engine",
      "apps",
      "engine",
      "src",
      "agents",
      "studio-orchestrator.ts"
    )
  ],

  outfile: path.join(
    root,
    "api",
    "_v4-engine.mjs"
  ),

  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: true,

  plugins: [
    {
      name: "veyra-optional-playwright-bidi",

      setup(build) {
        build.onResolve(
          { filter: /^chromium-bidi\// },
          args => {
            if (!optionalBidiModules.has(args.path)) {
              return;
            }

            return {
              path: args.path,
              namespace: "veyra-empty-bidi"
            };
          }
        );

        build.onLoad(
          {
            filter: /.*/,
            namespace: "veyra-empty-bidi"
          },
          args => {
            if (
              args.path.endsWith(
                "/bidiMapper/BidiMapper"
              )
            ) {
              return {
                contents:
                  "export const BidiServer = undefined; export default {};",
                loader: "js"
              };
            }

            return {
              contents:
                "export const MapperCdpConnection = undefined; export default {};",
              loader: "js"
            };
          }
        );
      }
    }
  ],

  banner: {
    js:
      'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
  }
});

console.log(
  "[V4 BUILD] bundled engine + Playwright JS -> api/_v4-engine.mjs"
);
