import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const browserRoot = path.join(
  root,
  "omni-engine",
  "apps",
  "engine",
  ".playwright-browsers"
);

if (!fs.existsSync(browserRoot)) {
  throw new Error(
    `V4 browser install directory does not exist: ${browserRoot}`
  );
}

const installed = fs.readdirSync(browserRoot, {
  withFileTypes: true
});

console.log(
  "[V4 BUILD] installed browser entries:",
  installed.map(x => x.name).join(", ")
);

const headlessDir = installed
  .filter(x => x.isDirectory())
  .map(x => x.name)
  .find(x => x.startsWith("chromium_headless_shell-"));

if (!headlessDir) {
  throw new Error(
    `chromium_headless_shell was not installed in ${browserRoot}`
  );
}

const headlessRoot = path.join(
  browserRoot,
  headlessDir
);

const candidates = [
  path.join(
    headlessRoot,
    "chrome-headless-shell-linux64",
    "chrome-headless-shell"
  ),
  path.join(
    headlessRoot,
    "chrome-headless-shell-win64",
    "chrome-headless-shell.exe"
  )
];

const sourceExecutable =
  candidates.find(x => fs.existsSync(x));

if (!sourceExecutable) {
  throw new Error(
    `Headless Shell executable missing under ${headlessRoot}`
  );
}

const sourcePlatform =
  path.dirname(sourceExecutable);

const platformName =
  path.basename(sourcePlatform);

const destinationRoot = path.join(
  root,
  "omni-engine",
  "apps",
  "engine",
  "api",
  "_chromium-runtime"
);

const destinationPlatform = path.join(
  destinationRoot,
  platformName
);

fs.rmSync(destinationRoot, {
  recursive: true,
  force: true
});

fs.mkdirSync(destinationRoot, {
  recursive: true
});

fs.cpSync(
  sourcePlatform,
  destinationPlatform,
  {
    recursive: true,
    force: true
  }
);

const bundledExecutable = path.join(
  destinationPlatform,
  path.basename(sourceExecutable)
);

if (!fs.existsSync(bundledExecutable)) {
  throw new Error(
    `Bundled Headless Shell missing: ${bundledExecutable}`
  );
}

try {
  fs.chmodSync(
    bundledExecutable,
    0o755
  );
} catch {}

console.log("[V4 BUILD] runtime=headless-shell");
console.log(`[V4 BUILD] source=${sourceExecutable}`);
console.log(`[V4 BUILD] bundled=${bundledExecutable}`);
