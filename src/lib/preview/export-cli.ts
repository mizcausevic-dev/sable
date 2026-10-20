import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = "docs/sable-operating-map-Cursor.html";
const targetDir = "site";
const html = await readFile(source, "utf8");
await mkdir(targetDir, { recursive: true });
await writeFile(`${targetDir}/index.html`, html);
console.log(`Wrote ${targetDir}/index.html from ${source}`);
