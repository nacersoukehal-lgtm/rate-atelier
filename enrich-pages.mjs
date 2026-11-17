import {createHash} from "node:crypto";
import {readdir,readFile,writeFile} from "node:fs/promises";

import "./quote-volume-check.js";

const site = new URL("./_site/",import.meta.url);
const read = name => readFile(new URL(name,site),"utf8");
const write = (name,contents) => writeFile(new URL(name,site),contents);
const origin = "https://getrateatelier.com/";
const escape = value => String(value ?? "—").replace(/[&<>"']/g,char => (
  {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]
));
const positive = value => Number.isFinite(value) && value > 0;
function date(value) {
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0,16).replace("T"," ") + " UTC" : "";
}
function observation(value) {
  const text = date(value);
  return text ? '<time datetime="' + new Date(value).toISOString() + '">' + escape(text) + "</time>" : "";
}
const money = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:8});
const cents = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"});
const smallUSD = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:4,maximumFractionDigits:4});
const wholeUSD = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
const referencePrice = new Intl.NumberFormat("en-US",{maximumFractionDigits:2});
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
  if (title && !html.includes('property="og:image"')) {
    tags.push('<meta property="og:image" content="' + origin + 'social-card.png">',
      '<meta property="og:image:width" content="1200">','<meta property="og:image:height" content="630">',
      '<meta property="og:image:alt" content="Rate Atelier — Exchange rates, metals and market data">');
  }
  if (title && !html.includes('name="twitter:card"')) {
    tags.push('<meta name="twitter:card" content="summary_large_image">','<meta name="twitter:title" content="' + title + '">');
    tags.push('<meta name="twitter:image" content="' + origin + 'social-card.png">');
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
    escape(referencePrice.format(price) + " " + item.unit) + '</td><td>' + escape(observed + " · " + item.cadence.toLowerCase()) +
    '</td><td>' + source + '</td></tr>'];
});
if (latest.length) {
  home = put(home,"metal-reference-rows",latest.join(""));
  home = put(home,"metal-reference-state","");
}
async function rss(url,source) {
  let response = await fetch(url,{signal:AbortSignal.timeout(6000)});
  if (!response.ok) response = await fetch("https://proxy.cors.dev/"+url,{signal:AbortSignal.timeout(6000)});
  if (!response.ok) throw Error("News feed unavailable: " + source);
  const xml = await response.text();
  const field = (item,name) => (item.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"))?.[1] ?? "")
    .trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/,"$1")
    .replace(/&(amp|lt|gt|quot|apos|#39);/g,(_,entity) => ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'","#39":"'"}[entity]));
  return [...xml.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)].map(([item]) => ({
    title:field(item,"title"),href:field(item,"link"),time:field(item,"pubDate"),source
  }));
}
const feeds = await Promise.allSettled([
  rss("https://www.fxstreet.com/rss/news","FXStreet"),
  rss("https://www.federalreserve.gov/feeds/press_monetary.xml","Federal Reserve")
]);
const market = feeds[0].value ?? [];
const fed = feeds[1].value ?? [];
const goldHeadline = /\bgold\b|\bXAU\b/i;
const currencyHeadline = /\b(?:EUR|USD|GBP|JPY|AUD|CAD|forex|dollar|euro|yen|sterling)\b/i;
const fresh = {
  "news-gold":market.filter(item => goldHeadline.test(item.title)),
  "news-fx":market.filter(item => !goldHeadline.test(item.title) && currencyHeadline.test(item.title)),
  "news-fed":fed
};
for (const id of Object.keys(fresh)) {
  const candidates = [...fresh[id],...(news[id] ?? [])];
  const items = [...new Map(candidates.filter(item => item.href?.startsWith("https://") && item.title &&
    Date.parse(item.time) >= Date.now()-3*86400000).map(item => [item.href,item])).values()]
    .sort((a,b) => Date.parse(b.time)-Date.parse(a.time)).slice(0,5);
  if (items.length) home = put(home,id,items.map(item => '<li><a href="' + escape(item.href) + '">' +
    escape(item.title.trim()) + '</a><small>' + escape(item.source) + ' · <time datetime="' + new Date(item.time).toISOString() + '">' + escape(date(item.time)) + '</time></small></li>').join(""));
  else {
    home = put(home,id,"");
    home = home.replace(new RegExp('(<article class="panel")(?=><h3>[^<]+</h3><ul id="'+id+'")'),"$1 hidden");
  }
}
const names = {
  "^IXIC":"Nasdaq Composite","^NYA":"NYSE Composite","^KS11":"KOSPI","^TWII":"Taiwan Weighted Index",
  AVGO:"Broadcom",COST:"Costco Wholesale",GS:"Goldman Sachs",DIS:"Walt Disney",
  "BARC.L":"Barclays","VOD.L":"Vodafone","6758.T":"Sony Group","9988.HK":"Alibaba Group"
};
const stocks = Object.entries(names).flatMap(([symbol,name]) => {
  const q = quotes[symbol]?.series?.meta;
  if (q?.symbol !== symbol || !positive(q.regularMarketPrice) || !positive(q.regularMarketTime)) return [];
  const price = value => positive(value) ? number.format(value) + (q.instrumentType === "INDEX" ? "" : " " + (q.currency ?? "")) : "—";
  return ['<tr><th scope="row">' + escape(name) + '<small>' + escape(symbol) + '</small></th><td>' +
    escape(price(q.regularMarketPrice)) + '<small>' + observation(q.regularMarketTime*1000) + '</small></td><td>' +
    escape(change(q.regularMarketChangePercent)) + "</td>" +
    (symbol === "^KS11" && !positive(q.regularMarketDayHigh) && !positive(q.regularMarketDayLow)
      ? '<td colspan="2">Session range unavailable</td>'
      : "<td>" + escape(price(q.regularMarketDayHigh)) + "</td><td>" + escape(price(q.regularMarketDayLow)) + "</td>") + "</tr>"];
});
if (stocks.length) {
  home = home.replace(/(<table class="stock-table">[\s\S]*?<\/thead>)/,header =>
    header.replace("<tr>","<tr data-stock-snapshot-head>").replace(/<th scope="col">(Change|Open|Previous)<\/th>/g,""));
  home = put(home,"stock-rows",stocks.join(""));
  home = put(home,"stock-status","Yahoo Finance snapshot · Sample of " + stocks.length + " assets · Quote times shown in UTC.");
}

const histories = [["gold","XAU"],["silver","XAG"],["platinum","XPT"],["palladium","XPD"]];
const results = await Promise.allSettled([
  json("https://api.coinpaprika.com/v1/tickers"),
  json("https://showmytrades.com/api/public/calendar/v1?impact=high,medium&days=14"),
  json("https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=EUR&from=" + new Date(Date.now()-365*86400000).toISOString().slice(0,10)),
  ...histories.map(([,code]) => json("https://standardbullion.com/api/v1/market/history?range=1m&metal=" + code)),
  json(origin + "crypto-volume-basis.json?minute=" + Math.floor(Date.now()/60000)).catch(() => null)
]);
const value = index => {
  const result = results[index];
  if (result.status === "rejected") console.warn(String(result.reason));
  return result.value;
};
const coins = value(0);
const previousBasis = results.at(-1).value;
const previousVolume = previousBasis?.volume;
const tether = Array.isArray(coins) ? coins.find(coin => coin.symbol === "USDT") : null;
const tetherQuote = tether?.quotes?.USD;
const observed = Date.parse(tether?.last_updated);
const basis = positive(tetherQuote?.volume_24h) && tetherQuote.volume_24h <= tetherQuote.market_cap &&
  Number.isFinite(observed) && observed > (previousBasis?.observed ?? 0)
  ? {volume:tetherQuote.volume_24h,observed} : previousBasis;
if (basis) await write("crypto-volume-basis.json",JSON.stringify(basis));
if (Array.isArray(coins)) {
  const rows = coins.filter(coin => positive(coin.quotes?.USD?.price) && positive(coin.quotes.USD.market_cap) &&
    date(coin.last_updated)).sort((a,b) => b.quotes.USD.market_cap-a.quotes.USD.market_cap).slice(0,10);
  if (rows.length) {
    home = put(home,"crypto-rows",rows.map((coin,index) => {
      const q = coin.quotes.USD;
      return td([index+1,coin.name + " (" + coin.symbol + ")",(q.price < .0001 ? "<$0.0001" : (q.price >= 1 ? cents : smallUSD).format(q.price))+" · "+date(coin.last_updated),
        change(q.percent_change_24h),wholeUSD.format(q.market_cap),globalThis.rateAtelierVolumeFlag(coin.symbol,q,previousVolume) ? "Volume under review"
          : positive(q.volume_24h) ? wholeUSD.format(q.volume_24h) : "—"])
        .replace(escape(date(coin.last_updated)),observation(coin.last_updated));
    }).join(""));
    home = put(home,"crypto-state","Top 10 snapshot by market cap · CoinPaprika");
    home = put(home,"crypto-method","Top 10 snapshot by market cap. The interactive ranking expands to 50 when its feed loads.");
  }
}
const events = value(1)?.events;
if (Array.isArray(events)) {
  const rows = events.filter(event => event.title && date(event.time))
    .sort((a,b) => Date.parse(a.time)-Date.parse(b.time)).slice(0,12);
  if (rows.length) {
    home = put(home,"calendar-rows",rows.map(event => td([
      date(event.time),event.title+" · "+event.currency,event.actual || "—",event.forecast || "—",event.previous || "—"
    ]).replace("<td>"+escape(date(event.time))+"</td>","<td>"+observation(event.time)+"</td>")).join(""));
    home = home.replace("<th scope=\"col\">Local time</th>","<th scope=\"col\" id=\"calendar-time-heading\">Time (UTC in snapshot)</th>");
    home = put(home,"calendar-status","Published schedule · ShowMyTrades");
    home = put(home,"calendar-source","ShowMyTrades · " + rows.length + " displayed · " +
      observation(rows[0].time) + " to " + observation(rows.at(-1).time));
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

function spark(rows,label,width,height,gaps = false) {
  const prices = rows.map(row => row.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const first = Date.parse(rows[0].time);
  const duration = Date.parse(rows.at(-1).time)-first || 1;
  const path = rows.map((row,index) => {
    const time = Date.parse(row.time);
    const start = index === 0 || (gaps && time-Date.parse(rows[index-1].time)>1.5*86400000);
    const x = 2 + (width-4)*(time-first)/duration;
    const y = max === min ? height/2 : height-2-(height-4)*(row.price-min)/(max-min);
    return (start ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  const display = label + " · " + rows[0].time.slice(0,10) + " to " + rows.at(-1).time.slice(0,10) +
    " · Change " + change((prices.at(-1)/prices[0]-1)*100);
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape(display) +
    '"><title>' + escape(display) + '</title><path fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" d="' + path + '"/></svg>';
}
const bullionSparks = new Set(["gold","silver","ratio","platinum","palladium"]);
const weekdays = rows => rows.filter(row => ![0,6].includes(new Date(row.time).getUTCDay()));
const gold = weekdays(series.get("gold"));
if (gold.length > 1) {
  const first = gold[0], last = gold.at(-1);
  home = put(home,"published-gold-chart",spark(gold,"Gold price history with weekend gaps",600,160,true) +
    '<p>Gold · Standard Bullion · ' + escape(date(first.time) + " " + money.format(first.price) + " to " +
    date(last.time) + " " + money.format(last.price) + (/T00:00:00/.test(last.time) ? " · Last historical observation: daily 00:00 UTC" : " · Historical observation")) + '</p>');
  home = put(home,"chart-state","");
}
for (const [id,history] of series) {
  const week = (bullionSparks.has(id) ? weekdays(history) : history).filter(row => Date.parse(row.time) >= Date.parse(history.at(-1)?.time)-7*86400000).slice(-100);
  if (week.length > 1) home = put(home,id+"-spark",spark(week,id+" 7-day price history",176,52,bullionSparks.has(id)));
}
const fx = series.get("usd");
const published = await read("published-quote-snapshot.json").then(JSON.parse).catch(() => ({}));
if (fx.length > 1 && fx.at(-1).time === published.EUR?.date &&
    Math.abs(fx.at(-1).price-published.EUR.value) < 1e-9) {
  home = put(home,"usd-move",change((fx.at(-1).price/fx.at(-2).price-1)*100) + " · Daily");
}
await write("index.html",home);

// Use the same ECB observations for all three published ranges.
if (fx.length) {
  const file = "historical-exchange-rates.html";
  let html = await read(file);
  const today = new Date().toISOString().slice(0,10);
  const start = days => new Date(Date.parse(today)-(days-1)*86400000).toISOString().slice(0,10);
  const range = days => fx.filter(row => row.time >= start(days) && row.time <= today);
  const fourDigits = new Intl.NumberFormat("en-US",{minimumFractionDigits:4,maximumFractionDigits:4,useGrouping:false});
  const euros = new Intl.NumberFormat("en-US",{style:"currency",currency:"EUR",currencyDisplay:"code"});
  const format = fourDigits.format;
  const movement = (first,last) => change((last.price/first.price-1)*100);
  const extremes = rows => {
    const prices = rows.map(row => row.price);
    return [Math.min(...prices),Math.max(...prices)];
  };
  function lookupLink(from,to,days,label) {
    return '<a href="./historical-exchange-rates.html?from=' + from + '&amp;to=' + to +
      '&amp;start=' + start(days) + '&amp;end=' + today + '">' + label + "</a>";
  }
  function axisChart(rows) {
    const [low,high] = extremes(rows);
    const first = Date.parse(rows[0].time);
    const elapsed = Date.parse(rows.at(-1).time)-first || 1;
    const x = row => 76 + 504*(Date.parse(row.time)-first)/elapsed;
    const y = price => high === low ? 114 : 214 - 194*(price-low)/(high-low);
    const ticks = high === low ? [low] : [low,low+(high-low)/3,high-(high-low)/3,high];
    const grid = ticks.map(price =>
      '<line x1="76" x2="580" y1="' + y(price) + '" y2="' + y(price) +
      '" stroke="currentColor" opacity=".2"/><text x="67" y="' + (y(price)+4) +
      '" text-anchor="end" fill="currentColor">' + format(price) + "</text>").join("");
    const dates = [[rows[0],"start"],[rows.at(-1),"end"]].map(([row,anchor]) =>
      '<text x="' + x(row) + '" y="243" text-anchor="' + anchor +
      '" fill="currentColor">' + escape(row.time) + '</text>').join("");
    const line = rows.map((row,i) => (i ? "L" : "M") + x(row).toFixed(1) + "," + y(row.price).toFixed(1)).join(" ");
    return '<svg viewBox="0 0 600 252" font-size="14" role="img" aria-label="USD to EUR history, euros per US dollar">' +
      '<title>USD to EUR history</title>' + grid + dates +
      '<path fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" d="' + line + '"/></svg>';
  }
  const recent = range(30);
  if (recent.length) {
    const first = recent[0], last = recent.at(-1);
    const [low,high] = extremes(recent);
    html = put(html,"historical-snapshot-summary","ECB via Frankfurter · " + recent.length +
      " published observations · Latest published rate: " + last.time + ".");
    const stats = [
      ["First",format(first.price),first.time],["Last",format(last.price),last.time],
      ["Change",recent.length > 1 ? movement(first,last) : "—"],["Low",format(low),recent.find(row => row.price === low).time],["High",format(high),recent.find(row => row.price === high).time]
    ];
    html = put(html,"historical-snapshot-stats",stats.map(([label,value,observed]) =>
      "<div><dt>" + label + "</dt><dd>" + value + (observed
        ? '<time datetime="' + escape(observed) + '">' + escape(observed) + '</time>' : "") + "</dd></div>").join(""));
    html = put(html,"historical-snapshot-rows",recent.map((row,index) => {
      const daily = index ? movement(recent[index-1],row) : "—";
      const extreme = low < high && (row.price === low ? "low" : row.price === high ? "high" : "");
      const badge = extreme ? '<span class="historical-extreme">' + (extreme === "low" ? "Low" : "High") + "</span>" : "";
      return (extreme ? '<tr data-extreme="' + extreme + '">' : "<tr>") + '<td><time datetime="' + escape(row.time) +
        '">' + escape(row.time) + "</time>" + badge + "</td><td>" + format(row.price) +
        "</td><td>" + daily + "</td><td>" + euros.format(1000 * row.price) + "</td></tr>";
    }).reverse().join(""));
    if (recent.length > 1) html = put(html,"historical-snapshot-chart",axisChart(recent));
    html = put(html,"historical-snapshot-toggle","View published USD/EUR rates (" + recent.length + ")");
    html = put(html,"historical-snapshot-reverse",lookupLink("EUR","USD",30,"EUR to USD over the same period"));
  }
  const longer = [[90,"Last 90 days"],[365,"Last year"]].flatMap(([days,label]) => {
    const rows = range(days);
    if (rows.length < 2) return [];
    const first = rows[0], last = rows.at(-1);
    const [low,high] = extremes(rows);
    return '<section><h3>' + label + '</h3><p>' + escape(first.time) + ' to ' + escape(last.time) +
      '</p><p>' + format(first.price) + ' → ' + format(last.price) + ' EUR per USD · ' + movement(first,last) +
      '</p><p>Low ' + format(low) + ' · High ' + format(high) + '</p><p>' +
      lookupLink("USD","EUR",days,"View range and history") + '</p></section>';
  });
  if (longer.length) html = put(html,"historical-longer-content",'<div class="historical-longer-grid">' + longer.join("") + "</div>");
  await write(file,html);
}
