"use strict";

const themeToggle = byId("theme-toggle");
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed",String(dark));
  themeToggle.textContent = dark ? "Light mode" : "Dark mode";
}
let savedTheme;
try { savedTheme = localStorage.getItem("rate-atelier-theme"); } catch {}
setTheme(savedTheme ? savedTheme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
themeToggle.addEventListener("click",() => {
  const dark = themeToggle.getAttribute("aria-pressed") !== "true";
  setTheme(dark);
  try { localStorage.setItem("rate-atelier-theme",dark ? "dark" : "light"); } catch {}
});

document.querySelectorAll("[data-pair]").forEach(button => button.addEventListener("click",() => {
  const pair = button.dataset.pair;
  if (!rates.has(pair)) {
    write("home-rate","This pair is temporarily unavailable. Try Refresh.");
    return;
  }
  byId("home-from").value = "USD";
  byId("home-to").value = pair;
  updateHomeConverter();
}));
byId("quick-gold").addEventListener("click",() => {
  byId("metal").value = "XAU";
  byId("weight").value = 5;
  byId("weight-unit").value = "31.1034768";
  setPurity();
  byId("purity").value = "1";
  calculateMetal();
});

const marketNewsFeed = "https://www.fxstreet.com/rss/news";
const fedNewsFeed = "https://www.federalreserve.gov/feeds/press_monetary.xml";
const goldHeadline = /\b(?:gold|xau\/usd|xauusd)\b/i;
const currencyHeadline = /\b(?:forex|currenc(?:y|ies)|dollar|yen|euro|pound|peso|franc|rupee|yuan)\b|[A-Z]{3}\/[A-Z]{3}/i;
const newsIds = ["news-gold","news-fx","news-fed"];
const newsStorageKey = "rate-atelier-news-v2";
let newsChecked = 0;
let newsBusy = false;
let savedNews = {};
try { savedNews = JSON.parse(localStorage.getItem(newsStorageKey) || "{}") ?? {}; } catch {}

async function readNewsFeed(url,source) {
  const response = await fetch("https://proxy.cors.dev/" + url,{signal:AbortSignal.timeout(9000)});
  if (!response.ok) throw new Error("News unavailable");
  const feed = new DOMParser().parseFromString(await response.text(),"application/xml");
  const items = Array.from(feed.querySelectorAll("item")).flatMap(item => {
    const title = item.querySelector("title")?.textContent?.trim();
    const href = item.querySelector("link")?.textContent?.trim();
    if (!title || !href?.startsWith("https://")) return [];
    return [{title,href,time:item.querySelector("pubDate")?.textContent,source}];
  });
  if (!items.length) throw new Error("No headlines returned");
  return items;
}

function showHeadlines(id,items) {
  const list = byId(id);
  const unique = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item?.title === "string" && item.href?.startsWith("https://") && !unique.has(item.title)) unique.set(item.title,item);
  }
  const rows = [...unique.values()].slice(0,5).map(item => {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title;
    const detail = document.createElement("small");
    detail.textContent = item.source + (Number.isFinite(Date.parse(item.time)) ? " · " + timestamp(item.time) : "");
    row.append(link,detail);
    return row;
  });
  if (!rows.length) return false;
  list.replaceChildren(...rows);
  return true;
}

async function refreshNews(force = false) {
  if (newsBusy || byId("news").hidden || (!force && Date.now()-newsChecked<900000)) return;
  newsBusy = true;
  for (const id of newsIds) showHeadlines(id,savedNews[id]);
  const results = await Promise.allSettled([
    readNewsFeed(marketNewsFeed,"FXStreet"),
    readNewsFeed(fedNewsFeed,"Federal Reserve"),
    json("./news-snapshot.json"),
    readNewsFeed("https://www.cnbc.com/id/100727362/device/rss/rss.html","CNBC"),
    readNewsFeed("https://www.ecb.europa.eu/rss/press.html","European Central Bank")
  ]);
  const market = [results[0],results[3]].flatMap(result => result.status === "fulfilled" ? result.value : []);
  const ecb = results[4].status === "fulfilled" ? results[4].value.filter(item => /euro|exchange rate|monetary policy/i.test(item.title)) : [];
  const fed = results[1].status === "fulfilled" ? results[1].value : [];
  const snapshot = results[2].status === "fulfilled" ? results[2].value : {};
  const feeds = {
    "news-gold":market.filter(item => goldHeadline.test(item.title)),
    "news-fx":market.filter(item => !goldHeadline.test(item.title) && currencyHeadline.test(item.title)).concat(ecb),
    "news-fed":fed
  };
  let fallback = false;
  for (const id of newsIds) {
    const live = feeds[id];
    const previous = Array.isArray(savedNews[id]) ? savedNews[id] : [];
    const backup = Array.isArray(snapshot[id]) ? snapshot[id] : [];
    fallback ||= live.length < Math.min(5,previous.length || backup.length || 1);
    if (live.length) savedNews[id] = [...new Map([...live,...previous].map(item => [item.href,item])).values()].slice(0,10);
    if (showHeadlines(id,[...live,...previous,...backup])) continue;
    const message = document.createElement("li");
    message.textContent = "Headlines unavailable. Use Refresh to retry.";
    byId(id).replaceChildren(message);
  }
  try { localStorage.setItem(newsStorageKey,JSON.stringify(savedNews)); } catch {}
  newsChecked = Date.now();
  write("news-updated",fallback ? "Some live feeds are unavailable. Saved headlines show their original publication dates." : "News checked " + timestamp(new Date()));
  newsBusy = false;
}
const newsPanel = byId("news");
new MutationObserver(() => refreshNews()).observe(newsPanel,{attributes:true,attributeFilter:["hidden"]});
byId("refresh").addEventListener("click",() => refreshNews(true));
setInterval(() => { if (!document.hidden) refreshNews(); },900000);
refreshNews();

byId("quick-aud").addEventListener("click",() => {
  if (!rates.has("AUD")) {
    write("fx-detail","The AUD rate is temporarily unavailable.");
    return;
  }
  byId("currency-search").value = "";
  populateCurrencySelects(true);
  byId("amount").value = 70000;
  byId("from").value = "AUD";
  byId("to").value = "USD";
  convert();
});

const overviewTrends = [
  ...metalCatalog.map(({id,code,name}) => ({id,code,label:name,type:"metal"})),
  {id:"usd",code:"USD/EUR",label:"USD to EUR",type:"fx"},
  {id:"ratio",code:"XAU/XAG",label:"Gold-to-silver ratio",type:"ratio"}
];
let overviewHistory = new Map();
let overviewLoading = false;
let overviewChecked = 0;

function sessionMove(item) {
  if (item.type === "metal") return metals.get(item.code)?.move;
  if (item.type === "ratio") {
    const gold = metals.get("XAU")?.move;
    const silver = metals.get("XAG")?.move;
    return Number.isFinite(gold) && Number.isFinite(silver) && silver > -100
      ? ((1+gold/100)/(1+silver/100)-1)*100 : undefined;
  }
  const history = overviewHistory.get(item.id);
  return history?.length > 1 ? (history.at(-1).price/history.at(-2).price-1)*100 : undefined;
}

function showOverviewTrends() {
  for (const item of overviewTrends) {
    const move = sessionMove(item);
    const value = byId(item.id+"-move");
    value.textContent = Number.isFinite(move)
      ? (move > 0 ? "▲ " : move < 0 ? "▼ " : "— ") + percent(move) : "";
    value.className = "quote-move " + (move > 0 ? "positive" : move < 0 ? "negative" : "");
    value.title = item.type === "fx" ? "Change from previous daily reference rate" : "Session change";
  }
}

function drawOverviewSparkline(item,series) {
  if (series.length < 2) return;
  const holder = byId(item.id+"-spark");
  const canvas = document.createElement("canvas");
  canvas.width = 176;
  canvas.height = 52;
  canvas.setAttribute("role","img");
  canvas.setAttribute("aria-label",item.label + " price history for the past seven days");
  const prices = series.map(point => point.price);
  const min = Math.min(...prices);
  const spread = Math.max(...prices)-min;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = prices.at(-1) < prices[0] ? "#cf6866" : "#4ca483";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  prices.forEach((price,index) => {
    const x = 3 + 170*index/(prices.length-1);
    const y = spread ? 47-42*(price-min)/spread : 26;
    if (index === 0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();
  holder.replaceChildren(canvas);
}

async function refreshOverviewTrends() {
  showOverviewTrends();
  if (overviewLoading || byId("markets").hidden || Date.now()-overviewChecked<300000) return;
  overviewLoading = true;
  const assets = overviewTrends.filter(item => item.type !== "ratio");
  const results = await Promise.allSettled(assets.map(item => watchHistory(item)));
  results.forEach((result,index) => {
    if (result.status !== "fulfilled" || result.value.length < 2) return;
    const item = assets[index];
    overviewHistory.set(item.id,result.value);
    drawOverviewSparkline(item,result.value);
  });
  const gold = overviewHistory.get("gold") ?? [];
  const silver = overviewHistory.get("silver") ?? [];
  const daily = series => new Map(series.map(point => [point.date.slice(0,10),point.price]));
  const silverByDay = daily(silver);
  const ratio = [...daily(gold)].filter(([date]) => silverByDay.has(date))
    .map(([date,price]) => ({date,price:price/silverByDay.get(date)}));
  drawOverviewSparkline(overviewTrends.at(-1),ratio);
  showOverviewTrends();
  overviewChecked = Date.now();
  overviewLoading = false;
}

document.addEventListener("market-quotes-updated",refreshOverviewTrends);
new MutationObserver(() => { if (!byId("markets").hidden) refreshOverviewTrends(); })
  .observe(byId("markets"),{attributes:true,attributeFilter:["hidden"]});
refreshOverviewTrends();
