/*
 * Usage:
 *   npm run release:metadata -- [artifact] [--source-commit <revision>]
 *   npm run release:metadata -- [artifact] --source-commit <revision> --check
 *
 * The source revision defaults to the current HEAD. Use --check to verify that
 * all tracked metadata matches the installer without writing any files.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArguments(argumentsList) {
  let artifactArgument = null;
  let sourceCommitArgument = null;
  let checkOnly = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--check" || argument === "--dry-run") {
      checkOnly = true;
      continue;
    }
    if (argument === "--source-commit") {
      sourceCommitArgument = argumentsList[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--source-commit=")) {
      sourceCommitArgument = argument.slice("--source-commit=".length);
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    if (artifactArgument) throw new Error(`Unexpected argument: ${argument}`);
    artifactArgument = argument;
  }
  if (sourceCommitArgument !== null && (!sourceCommitArgument || sourceCommitArgument.startsWith("-"))) throw new Error("--source-commit requires a Git revision.");
  return { artifactArgument, sourceCommitArgument, checkOnly };
}

function resolveCommit(revision) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    throw new Error(`Could not resolve source commit: ${revision}`);
  }
}

const { artifactArgument, sourceCommitArgument, checkOnly } = parseArguments(process.argv.slice(2));
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();
if (!version) throw new Error("package.json version is required");

const artifactName = `Weki-${version}-Setup.exe`;
const artifactPath = path.resolve(root, artifactArgument || path.join("release", artifactName));
if (path.basename(artifactPath) !== artifactName) throw new Error(`Expected the v${version} installer named ${artifactName}.`);

const artifact = await fs.readFile(artifactPath);
const artifactStat = await fs.stat(artifactPath);
if (artifactStat.size !== artifact.length || artifact.length === 0) throw new Error("Installer size could not be verified.");
const sha256 = crypto.createHash("sha256").update(artifact).digest("hex").toUpperCase();
const sha512Hex = crypto.createHash("sha512").update(artifact).digest("hex").toUpperCase();
const sha512Base64 = Buffer.from(sha512Hex, "hex").toString("base64");
const sourceCommit = resolveCommit(sourceCommitArgument || "HEAD");
if (!/^[0-9a-f]{40}$/iu.test(sourceCommit)) throw new Error("Could not resolve the full source commit.");

const releaseDirectory = path.join(root, "release");
const latestPath = path.join(releaseDirectory, "latest.yml");
const previousLatest = await fs.readFile(latestPath, "utf8");
const latestVersion = previousLatest.match(/^version:\s*([^\r\n]+)$/m)?.[1]?.trim();
const latestFile = previousLatest.match(/^\s*-\s+url:\s*(.+)$/m)?.[1]?.trim();
const latestSha512 = previousLatest.match(/^\s*sha512:\s*(.+)$/m)?.[1]?.trim();
const latestSize = Number(previousLatest.match(/^\s*size:\s*(\d+)$/m)?.[1]);
const releaseDateValue = previousLatest.match(/^releaseDate:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim();
const previousMetadataMatchesArtifact = latestVersion === version && latestFile === artifactName && latestSize === artifact.length && latestSha512 === sha512Base64;
const releaseDate = new Date(previousMetadataMatchesArtifact && releaseDateValue ? releaseDateValue : artifactStat.mtime);
if (Number.isNaN(releaseDate.getTime())) throw new Error("Could not determine the package release date from the installer.");

const kstParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
}).formatToParts(releaseDate).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
const buildDate = `${kstParts.year}-${kstParts.month}-${kstParts.day} ${kstParts.hour}:${kstParts.minute}:${kstParts.second} +09:00`;
const canonicalLatest = `# source commit: ${sourceCommit}
version: ${version}
files:
  - url: ${artifactName}
    sha512: ${sha512Base64}
    size: ${artifact.length}
path: ${artifactName}
sha512: ${sha512Base64}
releaseDate: '${releaseDate.toISOString()}'
`;
const buildInfo = `Application source commit: ${sourceCommit}
Build date/time: ${buildDate}
Application version: ${version}
Installer file name: ${artifactName}
Installer size: ${artifact.length} bytes
Installer path: release/${artifactName}
Installer SHA-256: ${sha256}
Installer SHA-512: ${sha512Hex}
Metadata source: npm run dist:win artifact verified by npm run release:metadata
`;
const previousNotes = await fs.readFile(path.join(releaseDirectory, "RELEASE_NOTES.md"), "utf8").catch(() => "");
const sourceNotes = await fs.readFile(path.join(root, "docs", `RELEASE_NOTES_V${version}.md`), "utf8");
const releaseBody = sourceNotes.replace(new RegExp(`^# Weki v${version}[^\\r\\n]*\\r?\\n+`, "u"), "").trim();
const historyMarker = previousNotes.match(/(^---\r?\n\r?\n# Weki v1\.2\.1[\s\S]*)$/m)?.[1]?.trim();
const artifactNotes = `## Verified artifact

- Source commit: \`${sourceCommit}\`
- Installer: \`${artifactName}\` (${artifact.length} bytes)
- SHA-256: \`${sha256}\`
- SHA-512: \`${sha512Hex}\`
- Update metadata: \`release/latest.yml\` records the matching base64 SHA-512, source commit, and release date from the builder output.
`;
const releaseNotes = `# Weki v${version}\n\n${releaseBody}\n\n${artifactNotes}${historyMarker ? `\n${historyMarker}\n` : ""}`;
const expectedFiles = new Map([
  [latestPath, canonicalLatest],
  [path.join(releaseDirectory, "BUILD_INFO.txt"), buildInfo],
  [path.join(releaseDirectory, "SHA256.txt"), `${artifactName}  ${sha256}\n`],
  [path.join(releaseDirectory, "RELEASE_NOTES.md"), releaseNotes],
]);

if (checkOnly) {
  for (const [filePath, expected] of expectedFiles) {
    const actual = await fs.readFile(filePath, "utf8").catch(() => null);
    if (actual !== expected) throw new Error(`${path.relative(root, filePath)} is not reproducible for source commit ${sourceCommit}; run the generator without --check to regenerate it.`);
  }
} else {
  for (const [filePath, contents] of expectedFiles) await fs.writeFile(filePath, contents, "utf8");
}

console.log(JSON.stringify({ mode: checkOnly ? "check" : "write", version, sourceCommit, artifact: artifactName, size: artifact.length, sha256, sha512: sha512Hex, releaseDate: releaseDate.toISOString() }, null, 2));
