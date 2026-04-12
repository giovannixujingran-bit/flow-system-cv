import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(appRoot, "src");
const distRoot = path.join(appRoot, "dist");

for (const fileName of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(srcRoot, fileName), path.join(distRoot, fileName));
}
