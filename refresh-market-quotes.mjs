import { readFile, writeFile } from "node:fs/promises";

const symbols = ["^IXIC","^NYA","^KS11","^TWII","AVGO","COST","GS","DIS",
  "BARC.L","VOD.L","6758.T","9988.HK","HG=F","DX-Y.NYB"];
const file = new URL("./market-quotes.json",import.meta.url);
const saved = await readFile(file,"utf8").then(JSON.parse).catch(error => {
  if (error.code === "ENOENT") return {};
  throw error;
});
const params = new URLSearchParams({symbols:symbols.join(","),range:"5d",interval:"1d"});
const missing = new Set(symbols);
const verifiedAt = new Date().toISOString();
const errors = [];
for (const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]) {
  const url = "https://" + host + "/v7/finance/spark?" + params;
  for (const endpoint of [url,"https://proxy.cors.dev/" + url]) {
    try {
      const response = await fetch(endpoint,{signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      for (const row of data.spark?.result ?? []) {
        if (!missing.has(row.symbol)) continue;
        const series = row.response?.[0];
        const meta = series?.meta;
        if (meta?.symbol !== row.symbol || !(meta.regularMarketPrice > 0) || !(meta.regularMarketTime > 0)) continue;
        if ((saved[row.symbol]?.series.meta.regularMarketTime ?? 0) > meta.regularMarketTime) continue;
        saved[row.symbol] = {verifiedAt,series};
        missing.delete(row.symbol);
      }
    } catch (error) {
      errors.push(error.message);
    }
    if (!missing.size) break;
  }
  if (!missing.size) break;
}
// The spark endpoint can reject a batch even when individual charts are available.
await Promise.all([...missing].map(async symbol => {
  const path = "/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=5d&interval=1d";
  for (const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]) {
    const url = "https://" + host + path;
    for (const endpoint of [url,"https://proxy.cors.dev/" + url]) {
      try {
        const response = await fetch(endpoint,{signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw new Error("HTTP " + response.status);
        const series = (await response.json()).chart?.result?.[0];
        const meta = series?.meta;
        if (meta?.symbol !== symbol || !(meta.regularMarketPrice > 0) || !(meta.regularMarketTime > 0) ||
            (saved[symbol]?.series.meta.regularMarketTime ?? 0) > meta.regularMarketTime) continue;
        saved[symbol] = {verifiedAt:new Date().toISOString(),series};
        missing.delete(symbol);
        return;
      } catch (error) {
        errors.push(symbol + ": " + error.message);
      }
    }
  }
}));
if (missing.size === symbols.length) throw new Error("No usable quotes returned: " + errors.join(", "));
if (missing.size) console.warn("Kept previous quotes for " + [...missing].join(", "));
await writeFile(file,JSON.stringify(saved) + "\n");
console.log("Verified " + (symbols.length - missing.size) + " of " + symbols.length + " quotes");
