import { readFileSync } from "node:fs";

export const pages = {
  "gold-price-today.html": "XAU",
  "silver-price-today.html": "XAG",
  "platinum-price-today.html": "XPT",
  "palladium-price-today.html": "XPD",
  "gold-silver-ratio.html": "ratio",
  "copper-price-today.html": "HG",
  "usd-to-eur.html": "EUR",
  "eur-to-usd.html": "EURUSD",
  "usd-to-aud.html": "AUD",
  "usd-to-dzd.html": "DZD"
};

const usd = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"});
const decimal = new Intl.NumberFormat("en-US", {maximumFractionDigits:6});
const valid = row => Number.isFinite(row?.value) && row.value > 0 && Number.isFinite(Date.parse(row.date));

export function metalQuotes(data) {
  return Object.fromEntries(["XAU","XAG","XPT","XPD"].map(code => {
    const metal = data.metals?.find(row => row.symbol === code);
    const value = metal?.bid > 0 && metal?.ask > 0 ? (metal.bid + metal.ask) / 2 : NaN;
    return [code,{value,date:data.updated,move:metal?.changeToday?.percent}];
  }));
}

export function fxQuotes(rows) {
  return Object.fromEntries(rows.map(({base,quote,rate,date,source}) => [
    base === "EUR" ? "EURUSD" : quote,{base,quote,value:rate,date,source}
  ]));
}

function replaceContent(html,id,content) {
  const pattern = new RegExp('(<[\\w-]+\\b[^>]*\\bid="' + id + '"[^>]*>)[\\s\\S]*?(</[\\w-]+>)');
  if (!pattern.test(html)) throw new Error("Missing element " + id);
  return html.replace(pattern,(_,open,close) => open + content + close);
}

function detail(row) {
  if (row.base) return "Published snapshot · " + (row.source ?? "Frankfurter") + " · " + row.date;
  const stale = !row.source && Date.now() - Date.parse(row.date) > 3600000;
  return "Published snapshot · " + (stale ? "Stale · " : "") + (row.source ?? "Standard Bullion") + " · " + new Date(row.date).toISOString().slice(0,16).replace("T"," ") + " UTC";
}

function benchmark(symbol) {
  const saved = JSON.parse(readFileSync(new URL("./market-quotes.json",import.meta.url),"utf8"));
    const meta = saved[symbol]?.series?.meta;
    if (meta?.symbol !== symbol || !(meta.regularMarketTime > 0)) return null;
    return {value:meta.regularMarketPrice,date:new Date(meta.regularMarketTime * 1000).toISOString(),
      move:meta.regularMarketChangePercent,source:"Yahoo Finance"};
}

export function renderSnapshot(html,file,quotes) {
  if (file === "index.html") {
    for (const [code,id] of [["XAU","gold"],["XAG","silver"],["EUR","usd"]]) {
      const row = quotes[code];
      if (!valid(row)) continue;
      html = replaceContent(html,id,code === "EUR" ? "€" + row.value.toFixed(4) : usd.format(row.value));
      html = replaceContent(html,id+"-time",detail(row));
    }
    const gold = quotes.XAU;
    const silver = quotes.XAG;
    const ratio = valid(gold) && valid(silver) && Date.parse(gold.date) === Date.parse(silver.date)
      ? {value:gold.value/silver.value,date:gold.date} : null;
    const changes = new Intl.NumberFormat("en-US",{
      minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:"exceptZero"
    });
    const copperPrice = new Intl.NumberFormat("en-US",{
      style:"currency",currency:"USD",minimumFractionDigits:4,maximumFractionDigits:4
    });
    const change = row => Number.isFinite(row.move) ? changes.format(row.move) + "%" : "Daily change unavailable";
    const rows = [
      ["ratio",ratio,row => row.value.toFixed(2) + "×"],
      ["platinum",quotes.XPT,row => usd.format(row.value)],
      ["palladium",quotes.XPD,row => usd.format(row.value)],
      ["copper",benchmark("HG=F"),row => copperPrice.format(row.value)],
      ["daily-gold",gold,row => usd.format(row.value) + " · " + change(row)],
      ["daily-silver",silver,row => usd.format(row.value) + " · " + change(row)],
      ["daily-dollar",benchmark("DX-Y.NYB"),row => row.value.toFixed(3) + " · " + change(row)]
    ];
    for (const [id,row,format] of rows) {
      html = replaceContent(html,id,valid(row) ? format(row) : "Quote unavailable");
      if (valid(row)) html = replaceContent(html,id+"-time",detail(row));
    }
    const ratioMove = Number.isFinite(gold?.move) && Number.isFinite(silver?.move) && silver.move > -100
      ? ((1+gold.move/100)/(1+silver.move/100)-1)*100 : undefined;
    for (const [id,move] of [["gold",gold?.move],["silver",silver?.move],["platinum",quotes.XPT?.move],
        ["palladium",quotes.XPD?.move],["copper",benchmark("HG=F")?.move],["ratio",ratio?.value ? ratioMove : undefined]]) {
      html = replaceContent(html,id+"-move",Number.isFinite(move) ? change({move}) : "");
    }
    return html;
  }
  const gold = quotes.XAU;
  const silver = quotes.XAG;
  const row = pages[file] === "ratio" && valid(gold) && valid(silver) && gold.date === silver.date
    ? {value:gold.value/silver.value,date:gold.date} : pages[file] === "HG" ? benchmark("HG=F") : quotes[pages[file]];
  if (!valid(row)) return html;
  const price = row.base ? "1 " + row.base + " = " + decimal.format(row.value) + " " + row.quote
    : pages[file] === "HG" ? "$" + row.value.toFixed(4) + " per lb"
    : pages[file] === "ratio" ? row.value.toFixed(2) + " ounces of silver per ounce of gold"
    : usd.format(row.value) + " per troy oz · " + usd.format(row.value/31.1034768) + " per gram";
  html = replaceContent(html,"landing-quote",price);
  html = replaceContent(html,"landing-source",detail(row));
  html = html.replace(/(<[^>]*\bid="landing-quote"[^>]*?)>/,(_,tag) =>
    tag.replace(/ data-snapshot-(?:date|rate)="[^"]*"/g,"") +
    ' data-snapshot-date="' + new Date(row.date).toISOString() + '"' +
    (row.base ? ' data-snapshot-rate="' + row.value + '"' : "") + ">");
  const amount = html.match(/id="landing-amount"[^>]*\bvalue="([^"]+)"/);
  if (amount && row.base) {
    const currency = new Intl.NumberFormat("en-US",{style:"currency",currency:row.quote});
    html = replaceContent(html,"landing-result",currency.format(Number(amount[1])*row.value));
  }
  return html;
}




