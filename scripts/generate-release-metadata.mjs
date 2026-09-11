import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();
if (!version) throw new Error("package.json version is required");

const requestedArtifact = process.argv.slice(2).find((argument) => argument && !argument.startsWith("-"));
const artifactName = `Weki-${version}-Setup.exe`;
const artifactPath = path.resolve(root, requestedArtifact || path.join("release", artifactName));
if (path.basename(artifactPath) !== artifactName) throw new Error(`Expected the v${version} installer named ${artifactName}.`);

const artifact = await fs.readFile(artifactPath);
const artifactStat = await fs.stat(artifactPath);
if (artifactStat.size !== artifact.length || artifact.length === 0) throw new Error("Installer size could not be verified.");
const sha256 = crypto.createHash("sha256").update(artifact).digest("hex").toUpperCase();
const sha512Hex = crypto.createHash("sha512").update(artifact).digest("hex").toUpperCase();
const sha512Base64 = Buffer.from(sha512Hex, "hex").toString("base64");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
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
const canonicalLatest = `version: ${version}
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
- Update metadata: \`release/latest.yml\` records the matching base64 SHA-512 and release date from the builder output.
`;
const releaseNotes = `# Weki v${version}\n\n${releaseBody}\n\n${artifactNotes}${historyMarker ? `\n${historyMarker}\n` : ""}`;

await fs.writeFile(latestPath, canonicalLatest, "utf8");
await fs.writeFile(path.join(releaseDirectory, "BUILD_INFO.txt"), buildInfo, "utf8");
await fs.writeFile(path.join(releaseDirectory, "SHA256.txt"), `${artifactName}  ${sha256}\n`, "utf8");
await fs.writeFile(path.join(releaseDirectory, "RELEASE_NOTES.md"), releaseNotes, "utf8");

console.log(JSON.stringify({ version, sourceCommit, artifact: artifactName, size: artifact.length, sha256, sha512: sha512Hex, releaseDate: releaseDate.toISOString() }, null, 2));
