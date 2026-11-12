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
