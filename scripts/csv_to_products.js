import fs from "fs";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";

const CSV_URL = "http://154.48.226.95:5001/admin/Product/export_csv";
const OUTPUT = "products.json";

async function main() {
  console.log("Fetching CSV...");
  const res = await fetch(CSV_URL, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to fetch CSV");

  const csvText = await res.text();

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const products = records
    .filter(r => (r.status || "").toLowerCase() !== "disabled")
    .map(r => ({
      market: String(r.market || "").toUpperCase(),
      asin: String(r.asin || "").trim(),
      title: String(r.title || "").trim(),
      link: String(r.link || "").trim(),
      image_url: String(r.image_url || "").trim(),
    }))
    .filter(p => p.market && p.asin);

  fs.writeFileSync(OUTPUT, JSON.stringify(products, null, 2), "utf8");
  console.log(`Saved ${products.length} products to ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
