import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist/resources", {recursive: true});
await copyFile("src/resources/derive-actions.js", "dist/resources/derive-actions.js");
