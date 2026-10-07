import {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const [input, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--mode", "--branch", "--version", "--notes", "--device"].includes(
      args[i],
    ) ||
    args[i + 1] === undefined ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Each option needs a value. Put multi-word versions in quotes.",
    );
  options[args[i]] = args[i + 1];
}
const mode = options["--mode"];
if (
  !input ||
  !["local", "remote"].includes(mode) ||
  !["12.1", "14.1", "16.0"].includes(options["--branch"]) ||
  !options["--version"]
)
  throw new Error(
    "Usage: npm run upload -- FILE --mode local|remote --branch 14.1 --version VERSION [--notes notes.txt] [--device MODEL]",
  );
const file = resolve(input),
  filename = basename(file);
if (!/^[a-zA-Z0-9._-]{1,160}$/.test(filename))
  throw new Error("Use a simple ASCII filename.");
const hash = createHash("sha256");
for await (const chunk of createReadStream(file)) hash.update(chunk);
const sha256 = hash.digest("hex");
const id = `fox-${options["--branch"].replace(".", "")}-${sha256.slice(0, 12)}`;
const record = {
  id,
  filename,
  title: `OrangeFox ${options["--branch"]}`,
  branch: options["--branch"],
  version: options["--version"],
  device: options["--device"] || "Samsung Galaxy A55 · A55X",
  date: new Date().toISOString(),
  bytes: statSync(file).size,
  sha256,
  status: "testing",
  changelog: options["--notes"]
    ? readFileSync(options["--notes"], "utf8").split(/\r?\n/).filter(Boolean)
    : [],
};
const run = (argv) => {
  const result = spawnSync("npx", ["--no-install", "wrangler", ...argv], {
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error("Upload command failed. Catalog was not published.");
};
mkdirSync(".local", { recursive: true });
const catalogFile = `.local/catalog-${mode}.json`;
// Read current server catalog so a second maintainer machine cannot lose existing builds.
let result = spawnSync(
  "npx",
  [
    "--no-install",
    "wrangler",
    "r2",
    "object",
    "get",
    "fox-test-builds/catalog.json",
    `--${mode}`,
    "--file",
    catalogFile,
  ],
  { encoding: "utf8" },
);
if (
  result.status !== 0 &&
  !/not found|does not exist|NoSuchKey|404/i.test(
    (result.stdout || "") + (result.stderr || ""),
  )
)
  throw new Error(
    "Cannot read catalog. Authenticate or initialize it before upload.",
  );
const previous =
  result.status === 0 ? JSON.parse(readFileSync(catalogFile, "utf8")) : [];
if (!Array.isArray(previous)) throw new Error("Invalid catalog.");
if (record.bytes < 1) throw new Error("Cannot publish an empty file.");
const next = [record, ...previous.filter((b) => b.id !== id)];
const serialized = JSON.stringify(next, null, 2) + "\n";
if (Buffer.byteLength(serialized) > 256 * 1024)
  throw new Error("Catalog is too large. Shorten changelogs before uploading.");
if (
  next.length > 100 ||
  next.reduce((total, b) => total + b.bytes, 0) > 8 * 1024 ** 3
)
  throw new Error(
    "Catalog limit: 100 builds / 8 GiB. Remove old files before uploading more.",
  );
run([
  "r2",
  "object",
  "put",
  `fox-test-builds/builds/${id}/${filename}`,
  `--${mode}`,
  "--file",
  file,
]);
writeFileSync(catalogFile, serialized);
run([
  "r2",
  "object",
  "put",
  "fox-test-builds/catalog.json",
  `--${mode}`,
  "--file",
  catalogFile,
  "--content-type",
  "application/json",
]);
console.log(`Published ${id}; SHA256 ${sha256}`);
