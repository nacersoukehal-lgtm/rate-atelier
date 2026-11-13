"use strict";
const quoteOutput = document.getElementById("landing-quote");
const sourceOutput = document.getElementById("landing-source");
const asset = quoteOutput.dataset.asset;
const decimal = (value,digits) => new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}).format(value);
const cacheKey = "rate-atelier-landing-quote:" + asset;
const landingAmount = document.getElementById("landing-amount");
const landingResult = document.getElementById("landing-result");
let lastQuote;

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
try { lastQuote = JSON.parse(localStorage.getItem(cacheKey)); } catch {}
function showQuote(text,detail,stale = false) {
  updateLandingAmount();
  quoteOutput.textContent = text;
  sourceOutput.textContent = (stale ? "Stale · " : "") + detail;
}
function rememberQuote(text,detail,date,maxAge = 0,rate) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) throw new Error("Quote timestamp unavailable");
  lastQuote = {text,detail,rate};
  try { localStorage.setItem(cacheKey,JSON.stringify(lastQuote)); } catch {}
  showQuote(text,detail,maxAge > 0 && Date.now()-time > maxAge);
}
const usd = new Intl.NumberFormat(undefined,{style:"currency",currency:"USD"});

async function updateLandingQuote() {
  try {
    const isCurrency = ["EUR","AUD","DZD","EURUSD"].includes(asset);
    const baseCurrency = asset === "EURUSD" ? "EUR" : "USD";
    const quoteCurrency = asset === "EURUSD" ? "USD" : asset;
    const endpoint = asset === "BTC" ? "https://api.coinpaprika.com/v1/tickers/btc-bitcoin" : isCurrency ? "https://api.frankfurter.dev/v2/rate/" + baseCurrency + "/" + quoteCurrency
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
        "Frankfurter · Reference rate dated " + data.date,data.date,0,data.rate);
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
if (lastQuote) showQuote(lastQuote.text,lastQuote.detail,true);
updateLandingQuote();
setInterval(() => { if (!document.hidden) updateLandingQuote(); },60000);
