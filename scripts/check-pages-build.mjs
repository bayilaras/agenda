import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const files = [];
function visit(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) visit(path);
    else files.push(path);
  }
}
visit("dist-pages");
for (const file of files) {
  if (!/\.(js|html|json|map)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (/react(?:-dom-client)?\.development\.js/.test(text)) {
    throw new Error(`Build statis harus menggunakan React produksi: ${file}`);
  }
  if (
    /GOCSPX-[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|node:sqlite|node:crypto/.test(
      text,
    )
  ) {
    throw new Error(`Build statis mengandung materi server/rahasia: ${file}`);
  }
}
// GitHub Pages serves this SPA at /agenda/ and supports direct legacy paths via 404.
writeFileSync("dist-pages/.nojekyll", "");
writeFileSync("dist-pages/404.html", readFileSync("dist-pages/index.html"));
console.log(
  `Build Pages diverifikasi (${files.length} berkas); hanya aset publik diterbitkan.`,
);
