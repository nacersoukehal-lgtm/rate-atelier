"use strict";
const quoteOutput = document.getElementById("landing-quote");
const sourceOutput = document.getElementById("landing-source");
const asset = quoteOutput.dataset.asset;
const decimal = (value,digits) => new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}).format(value);
const cacheKey = "rate-atelier-landing-quote:" + asset + (asset === "EUR" || asset === "EURUSD" ? ":ecb" : "");
const landingAmount = document.getElementById("landing-amount");
const landingResult = document.getElementById("landing-result");
const publishedDate = quoteOutput.dataset.snapshotDate;
let lastQuote = publishedDate ? {
  text:quoteOutput.textContent,detail:sourceOutput.textContent,
  date:publishedDate,rate:Number(quoteOutput.dataset.snapshotRate)
} : undefined;

function updateLandingAmount() {
  if (!landingAmount) return;
  const amount = landingAmount.valueAsNumber;
  const rate = lastQuote?.rate;
  const converted = amount * rate;
  landingResult.textContent = !landingAmount.validity.valid ? "Enter an amount of zero or more." :
    Number.isFinite(converted) && rate > 0 ?
      new Intl.NumberFormat(undefined,{style:"currency",currency:asset === "EURUSD" ? "USD" : "EUR"}).format(converted) :
      "Reference rate unavailable";
}
landingAmount?.addEventListener("input",updateLandingAmount);
try {
  const stored = JSON.parse(localStorage.getItem(cacheKey));
  if (stored?.text && (!lastQuote || Date.parse(stored.date) >= Date.parse(lastQuote.date))) lastQuote = stored;
} catch {}
function showQuote(text,detail,stale = false) {
  updateLandingAmount();
  quoteOutput.textContent = text;
  sourceOutput.textContent = (stale ? "Stale · " : "") + detail;
}
function rememberQuote(text,detail,date,maxAge = 0,rate) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) throw new Error("Quote timestamp unavailable");
  if (time < Date.parse(lastQuote?.date)) throw new Error("Older quote");
  lastQuote = {text,detail,rate,date};
  try { localStorage.setItem(cacheKey,JSON.stringify(lastQuote)); } catch {}
  showQuote(text,detail,maxAge > 0 && Date.now()-time > maxAge);
}
const usd = new Intl.NumberFormat(undefined,{style:"currency",currency:"USD"});

async function updateLandingQuote() {
  try {
    if (asset === "HG") {
      const url = "https://query1.finance.yahoo.com/v8/finance/chart/HG%3DF?range=5d&interval=1d";
      const readCopper = async endpoint => {
        const response = await fetch(endpoint,{signal:AbortSignal.timeout(6000)});
        if (!response.ok) throw Error("Copper feed unavailable");
        const result = (await response.json()).chart?.result?.[0]?.meta;
        if (result?.symbol !== "HG=F" || !(result.regularMarketPrice > 0) || !(result.regularMarketTime > 0)) throw Error("Copper quote unavailable");
        return result;
      };
      const quote = await readCopper(url).catch(() => readCopper("https://proxy.cors.dev/" + url));
      const date = new Date(quote.regularMarketTime*1000).toISOString();
      rememberQuote("$" + quote.regularMarketPrice.toFixed(4) + " per lb",
        "Yahoo Finance · " + new Date(date).toLocaleString(),date,36*3600000);
      return;
    }
    const isCurrency = ["EUR","AUD","DZD","EURUSD"].includes(asset);
    const baseCurrency = asset === "EURUSD" ? "EUR" : "USD";
    const quoteCurrency = asset === "EURUSD" ? "USD" : asset;
    const ecbPair = asset === "EUR" || asset === "EURUSD";
    const endpoint = asset === "BTC" ? "https://api.coinpaprika.com/v1/tickers/btc-bitcoin" : isCurrency ? "https://api.frankfurter.dev/v2/" + (ecbPair ? "providers/ecb/" : "") + "rate/" + baseCurrency + "/" + quoteCurrency
      : "https://standardbullion.com/spot-prices.json";
    const response = await fetch(endpoint,{signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("Feed unavailable");
    const data = await response.json();
    if (asset === "BTC") {
      const quote = data.quotes?.USD;
      if (!(quote?.price > 0)) throw new Error("Bitcoin price unavailable");
      const move = quote.percent_change_24h;
      const text = usd.format(quote.price) + (Number.isFinite(move) ? " · " + (move > 0 ? "+" : "") + decimal(move,2) + "% in 24h" : "");
      rememberQuote(text,"CoinPaprika · " + new Date(data.last_updated).toLocaleString(),data.last_updated,1800000);
      return;
    }
    if (isCurrency) {
      if (!(data.rate > 0)) throw new Error("Rate unavailable");
      rememberQuote("1 " + baseCurrency + " = " + decimal(data.rate,6) + " " + quoteCurrency,
        (ecbPair ? "ECB via Frankfurter" : "Frankfurter") + " · Reference rate dated " + data.date,data.date,0,data.rate);
      return;
    }
    const spot = code => {
      const metal = data.metals.find(item => item.symbol === code);
      return metal?.ask > 0 && metal.bid > 0 ? (metal.ask+metal.bid)/2 : NaN;
    };
    const price = asset === "ratio" ? spot("XAU")/spot("XAG") : spot(asset);
    if (!Number.isFinite(price)) throw new Error("Price unavailable");
    const text = asset === "ratio" ? decimal(price,2) + " ounces of silver per ounce of gold"
      : usd.format(price) + " per troy oz · " + usd.format(price/31.1034768) + " per gram";
    rememberQuote(text,"Data by Standard Bullion · " + new Date(data.updated).toLocaleString(),data.updated,3600000);
  } catch {
    if (lastQuote) showQuote(lastQuote.text,lastQuote.detail,true);
    else showQuote("Quote unavailable","The feed could not be reached. Try again later.");
  }
}
try { document.documentElement.dataset.theme = localStorage.getItem("rate-atelier-theme") ?? ""; } catch {}
if (lastQuote) showQuote(lastQuote.text,lastQuote.detail,lastQuote.date !== publishedDate);
updateLandingQuote();
setInterval(() => { if (!document.hidden) updateLandingQuote(); },60000);



