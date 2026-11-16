import {createHash} from "node:crypto";
import {readdir,readFile,writeFile} from "node:fs/promises";

const site = new URL("./_site/",import.meta.url);
const read = name => readFile(new URL(name,site),"utf8");
const write = (name,contents) => writeFile(new URL(name,site),contents);
const origin = "https://getrateatelier.com/";
const escape = value => String(value ?? "—").replace(/[&<>"']/g,char => (
  {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]
));
const positive = value => Number.isFinite(value) && value > 0;
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0,16).replace("T"," ") + " UTC" : "";
const money = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:8});
const number = new Intl.NumberFormat("en-US",{maximumFractionDigits:4});
const pct = new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:"exceptZero"});
const change = value => Number.isFinite(value) ? pct.format(value) + "%" : "—";
const td = cells => "<tr>" + cells.map(value => "<td>" + escape(value) + "</td>").join("") + "</tr>";

async function json(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(9000)});
  if (!response.ok) throw Error("Feed HTTP " + response.status + ": " + new URL(url).hostname);
  return response.json();
}

function put(html,id,contents) {
  const pattern = new RegExp('(<([\\w-]+)\\b[^>]*\\bid="' + id + '"[^>]*>)[\\s\\S]*?(</\\2>)');
  return html.replace(pattern,(_,start,tag,end) => start + contents + end);
}

const css = await read("style.css");
async function hashed(name,extension,source) {
  const hash = createHash("sha256").update(source).digest("hex").slice(0,16);
  const file = name + "." + hash + "." + extension;
  await write(file,source);
  return file;
}
const styles = await hashed("site","css",css);
const scripts = new Map();
const files = (await readdir(site)).filter(name => name.endsWith(".html"));

for (const file of files) {
  let html = await read(file);
  const analytics = /<!-- Google tag \(gtag\.js\) -->\s*<script[^>]*googletagmanager\.com\/gtag\/js[^>]*><\/script>\s*<script>[\s\S]*?<\/script>/;
  html = html.replace(analytics,'<script src="./analytics-consent.js" defer></script>');
  html = html.replace(/href="(?:\.\/)?style\.css(?:\?[^"]*)?"/g,'href="./' + styles + '"');
  const scriptTag = /<script src="(?:\.\/)?([\w-]+\.js)(?:\?[^"]*)?" defer><\/script>/g;
  const names = [...html.matchAll(scriptTag)].map(match => match[1]);
  if (names.length) {
    const key = names.join(",");
    if (!scripts.has(key)) {
      const contents = await Promise.all(names.map(read));
      scripts.set(key,await hashed(file === "index.html" ? "markets" : "page","js",'"use strict";\n' + contents.join("\n;\n")));
    }
    html = html.replace(scriptTag,'').replace("</head>",'<script src="./' + scripts.get(key) + '" defer></script>\n</head>');
  }
  // Preserve existing page-specific social metadata and any article structured data.
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const url = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? new URL(file,origin).href;
  const tags = ['<link rel="icon" href="./favicon.svg" type="image/svg+xml">'];
  if (title && !html.includes('property="og:title"')) {
    tags.push('<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Rate Atelier">',
      '<meta property="og:title" content="' + title + '">',
      '<meta property="og:url" content="' + escape(url) + '">');
    if (description) tags.push('<meta property="og:description" content="' + description + '">');
  }
  if (title && !html.includes('name="twitter:card"')) {
    tags.push('<meta name="twitter:card" content="summary">','<meta name="twitter:title" content="' + title + '">');
    if (description) tags.push('<meta name="twitter:description" content="' + description + '">');
  }
  if (file === "index.html") {
    tags.push('<script type="application/ld+json">' + JSON.stringify({
      "@context":"https://schema.org","@type":"WebSite",name:"Rate Atelier",url:origin,
      description:"Currency converters, precious metal prices, and global market data.",
      publisher:{"@type":"Organization",name:"Rate Atelier",url:origin,logo:origin+"favicon.svg",
        sameAs:["https://www.facebook.com/profile.php?id=61596546572192"]}
    }) + '</script>');
  }
  await write(file,html.replace("</head>",tags.join("\n")+"\n</head>"));
}

let home = await read("index.html");
const data = JSON.parse(await read("metal-references.json"));
const quotes = JSON.parse(await read("market-quotes.json"));
const news = await read("news-snapshot.json").then(JSON.parse).catch(() => ({}));
const latest = Object.values(data).flatMap(item => {
  const [observed,price] = item.points.at(-1) ?? [];
  if (!positive(price) || !Number.isFinite(Date.parse(observed))) return [];
  const source = item.link?.startsWith("https://") ? '<a href="' + escape(item.link) + '">' + escape(item.source) + '</a>' : escape(item.source);
  return ['<tr><th scope="row">' + escape(item.name) + '<small>' + escape(item.grade) + '</small></th><td>' +
    escape(number.format(price) + " " + item.unit) + '</td><td>' + escape(observed + " · " + item.cadence.toLowerCase()) +
    '</td><td>' + source + '</td></tr>'];
});
if (latest.length) {
  home = put(home,"metal-reference-rows",latest.join(""));
  home = put(home,"metal-reference-state","");
}
for (const id of ["news-gold","news-fx","news-fed"]) {
  const items = (news[id] ?? []).filter(item => item.href?.startsWith("https://") && item.title).slice(0,5);
  if (items.length) home = put(home,id,items.map(item => '<li><a href="' + escape(item.href) + '">' +
    escape(item.title) + '</a><small>' + escape([item.source,date(item.time)].filter(Boolean).join(" · ")) + '</small></li>').join(""));
  else home = put(home,id,"<li>Headlines unavailable in this snapshot.</li>");
}
const stockSymbols = ["^IXIC","^NYA","^KS11","^TWII","AVGO","COST","GS","DIS","BARC.L","VOD.L","6758.T","9988.HK"];
const stocks = stockSymbols.flatMap(symbol => {
  const q = quotes[symbol]?.series?.meta;
  if (q?.symbol !== symbol || !positive(q.regularMarketPrice) || !positive(q.regularMarketTime)) return [];
  const previous = positive(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : undefined;
  const marketChange = Number.isFinite(q.regularMarketChange) ? q.regularMarketChange :
    previous ? q.regularMarketPrice-previous : undefined;
  const price = value => positive(value) ? number.format(value) : "—";
  return [td([q.shortName ?? symbol,price(q.regularMarketPrice) + " · " + symbol + " · " + date(q.regularMarketTime*1000),
    Number.isFinite(marketChange) ? number.format(marketChange) : "—",change(q.regularMarketChangePercent),
    price(q.regularMarketOpen),price(q.regularMarketDayHigh),price(q.regularMarketDayLow),price(previous)])];
});
if (stocks.length) {
  home = put(home,"stock-rows",stocks.join(""));
  home = put(home,"stock-status","Published snapshots · Yahoo Finance · see timestamps in the table.");
}

const histories = [["gold","XAU"],["silver","XAG"],["platinum","XPT"],["palladium","XPD"]];
const results = await Promise.allSettled([
  json("https://api.coinpaprika.com/v1/tickers"),
  json("https://showmytrades.com/api/public/calendar/v1?impact=high,medium&days=14"),
  json("https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR&from=" + new Date(Date.now()-10*86400000).toISOString().slice(0,10)),
  ...histories.map(([,code]) => json("https://standardbullion.com/api/v1/market/history?range=1m&metal=" + code))
]);
const value = index => {
  const result = results[index];
  if (result.status === "rejected") console.warn(String(result.reason));
  return result.value;
};
const coins = value(0);
if (Array.isArray(coins)) {
  const rows = coins.filter(coin => positive(coin.quotes?.USD?.price) && positive(coin.quotes.USD.market_cap) &&
    date(coin.last_updated)).sort((a,b) => b.quotes.USD.market_cap-a.quotes.USD.market_cap).slice(0,10);
  if (rows.length) {
    home = put(home,"crypto-rows",rows.map((coin,index) => {
      const q = coin.quotes.USD;
      return td([index+1,coin.name + " (" + coin.symbol + ")",money.format(q.price)+" · "+date(coin.last_updated),
        change(q.percent_change_24h),money.format(q.market_cap),positive(q.volume_24h) ? money.format(q.volume_24h) : "—"]);
    }).join(""));
    home = put(home,"crypto-state","Published snapshot · CoinPaprika");
  }
}
const events = value(1)?.events;
if (Array.isArray(events)) {
  const rows = events.filter(event => event.title && date(event.time))
    .sort((a,b) => Date.parse(a.time)-Date.parse(b.time)).slice(0,12);
  if (rows.length) {
    home = put(home,"calendar-rows",rows.map(event => td([
      date(event.time),event.title+" · "+event.currency,event.actual || "—",event.forecast || "—",event.previous || "—"
    ])).join(""));
    home = home.replace("<th scope=\"col\">Local time</th>","<th scope=\"col\" id=\"calendar-time-heading\">Time (UTC in snapshot)</th>");
    home = put(home,"calendar-status","Published schedule · ShowMyTrades");
  }
}

function points(rows) {
  return rows.filter(row => positive(row.price) && date(row.time))
    .sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
}
const series = new Map(histories.map(([key],index) => [key,points((value(index+3)?.points ?? [])
  .map(row => ({time:row.t,price:row.price})))]));
series.set("usd",points((value(2) ?? []).map(row => ({time:row.date,price:row.rate}))));
const copper = quotes["HG=F"]?.series;
series.set("copper",points((copper?.timestamp ?? []).map((time,index) => ({
  time:time*1000,price:copper.indicators?.quote?.[0]?.close?.[index]
})).filter(row => row.time > 0).map(row => ({...row,time:new Date(row.time).toISOString()}))));
const silver = new Map(series.get("silver").map(row => [row.time,row.price]));
series.set("ratio",series.get("gold").filter(row => silver.has(row.time))
  .map(row => ({time:row.time,price:row.price/silver.get(row.time)})));

function spark(rows,label,width,height) {
  const prices = rows.map(row => row.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const line = prices.map((price,index) => (
    (2+(width-4)*index/(prices.length-1)).toFixed(1) + "," +
    (max === min ? height/2 : height-2-(height-4)*(price-min)/(max-min)).toFixed(1)
  )).join(" ");
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape(label) +
    '"><polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" points="' + line + '"/></svg>';
}
const gold = series.get("gold");
if (gold.length > 1) {
  const first = gold[0], last = gold.at(-1);
  home = put(home,"published-gold-chart",spark(gold,"Gold price history",600,160) +
    '<p>Gold · Standard Bullion · ' + escape(date(first.time) + " " + money.format(first.price) + " to " +
    date(last.time) + " " + money.format(last.price)) + '</p>');
  home = put(home,"chart-state","");
}
for (const [id,history] of series) {
  const week = history.filter(row => Date.parse(row.time) >= Date.parse(history.at(-1)?.time)-7*86400000).slice(-100);
  if (week.length > 1) home = put(home,id+"-spark",spark(week,id+" recent price history",176,52));
}
const fx = series.get("usd");
const published = await read("published-quote-snapshot.json").then(JSON.parse).catch(() => ({}));
if (fx.length > 1 && fx.at(-1).time === published.EUR?.date &&
    Math.abs(fx.at(-1).price-published.EUR.value) < 1e-9) {
  home = put(home,"usd-move",change((fx.at(-1).price/fx.at(-2).price-1)*100));
}
await write("index.html",home);

