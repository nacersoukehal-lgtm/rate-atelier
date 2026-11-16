(() => {
  "use strict";
  const get = id => document.getElementById(id);
  const number = id => get(id).valueAsNumber;
  const money = (value,currency) => new Intl.NumberFormat(undefined,{style:"currency",currency}).format(value);
  const validCurrency = code => /^[A-Z]{3}$/.test(code ?? "");
  const positive = value => Number.isFinite(value) && value > 0;

  if (get("standalone-transfer")) {
    const params = new URLSearchParams(location.search);
    const common = ["USD","EUR","GBP","CAD","AUD","MXN","INR","PHP","DZD","JPY","CHF","AED","BRL","MAD","NGN"];
    let known = common;
    try { known = Intl.supportedValuesOf("currency").concat(common); } catch {}
    const names = new Intl.DisplayNames(undefined,{type:"currency"});
    for (const [id,fallback] of [["send","USD"],["receive","EUR"]]) {
      const chosen = params.get(id)?.toUpperCase();
      const currencies = [...new Set(known)].sort();
      const select = get(id);
      select.replaceChildren(...currencies.map(code => new Option(code+" — "+names.of(code),code)));
      select.value = validCurrency(chosen) && currencies.includes(chosen) ? chosen : fallback;
    }
    const amount = params.get("budget");
    if (amount !== null && amount.trim() && Number.isFinite(Number(amount)) && Number(amount)>=0) get("budget").value = amount;
    for (const id of ["a","b"]) {
      const provider = get("provider-"+id);
      const chosen = params.get(id);
      if ([...provider.options].some(option => option.value === chosen)) provider.value = chosen;
    }
    function update() {
      const send = get("send").value;
      const receive = get("receive").value;
      const budget = number("budget");
      get("offer-units").textContent = "Fee in "+send+" · Quoted rate in "+receive+" per "+send;
      const amounts = ["a","b"].map(id => {
        const payout = rateAtelierMath.transferPayout(budget,number("fee-"+id),number("rate-"+id));
        get("offer-"+id).textContent = Number.isFinite(payout) ? money(payout,receive) : "—";
        get("effective-"+id).textContent = Number.isFinite(payout) && budget > 0
          ? "Effective rate: " + new Intl.NumberFormat(undefined,{maximumFractionDigits:6}).format(payout/budget) + " "+receive+" per "+send : "";
        return payout;
      });
      let result = "Enter both quoted rates and fees within your budget.";
      if (amounts.every(Number.isFinite)) {
        const difference = money(Math.abs(amounts[0]-amounts[1]),receive);
        const winner = amounts[0] > amounts[1] ? "a" : "b";
        const provider = get("provider-"+winner).value;
        result = difference === money(0,receive) ? "Both offers deliver the same amount at display precision."
          : (provider || "Offer "+winner.toUpperCase()) + " delivers " + difference + " more.";
      }
      get("verdict").textContent = result;
    }
    get("standalone-transfer").addEventListener("input",update);
    get("standalone-transfer").addEventListener("change",update);
    update();
  }

  if (get("standalone-melt")) {
    const choices = {
      XAU:[["18K",.75],["24K",1],["22K",22/24],["21K",21/24],["14K",14/24],["10K",10/24],["9K",9/24]],
      XAG:[["Sterling · 92.5%",.925],["Fine · 99.9%",.999],["Coin silver · 90%",.9],["Pure",1]],
      XPT:[["Platinum 950",.95],["Platinum 900",.9],["Pure",1]],
      XPD:[["Palladium 950",.95],["Palladium 500",.5],["Pure",1]]
    };
    let quotes = {};
    const form = get("standalone-melt");
    const asset = get("melt-metal");
    const purity = get("melt-purity");
    const history = get("melt-history");
    const details = history.closest("details");
    function updatePurity() {
      purity.replaceChildren(...choices[asset.value].map(([label,value]) => new Option(label,value)));
    }
    function updateValue() {
      const quote = quotes[asset.value];
      const override = number("melt-price");
      const manual = get("melt-price").value !== "";
      const value = rateAtelierMath.meltValue(manual ? override : quote?.value,number("melt-weight"),+get("melt-unit").value,+purity.value);
      get("melt-answer").textContent = Number.isFinite(value) ? money(value,"USD") : "—";
      const quoteTime = Date.parse(quote?.date);
      const note = Number.isFinite(quoteTime) ? new Date(quoteTime).toLocaleString() : "";
      get("melt-source").textContent = manual ? (positive(override) ? "Using your reference price." : "Enter a reference price above zero.")
        : positive(quote?.value) ? money(quote.value,"USD") + " per troy ounce · Standard Bullion · " + note +
          (Date.now()-quoteTime > 3600000 ? " · Last known quote" : "")
        : "Reference price unavailable. Enter a price above to calculate.";
    }
    async function getJson(url) {
      const response = await fetch(url,{signal:AbortSignal.timeout(6500)});
      if (!response.ok) throw Error("Feed unavailable");
      return response.json();
    }
    async function updateQuotes() {
      const fallback = getJson("./published-quote-snapshot.json");
      const live = getJson("https://standardbullion.com/spot-prices.json").then(payload =>
        Object.fromEntries(payload.metals.filter(row => positive(row.bid) && positive(row.ask)).map(row =>
          [row.symbol,{date:payload.updated,value:(row.bid+row.ask)/2}])));
      function remember(rows) {
        for (const [code,row] of Object.entries(rows)) {
          const time = Date.parse(row.date);
          if (positive(row.value) && Number.isFinite(time) && !(time < Date.parse(quotes[code]?.date))) quotes[code] = row;
        }
        updateValue();
      }
      await Promise.allSettled([fallback.then(remember),live.then(remember)]);
    }
    const updateHistory = mountFinanceHistory(history,async () => {
      const code = asset.value;
      const points = await financeHistory.metal(code,30);
      return {points,format:v=>money(v,"USD"),label:asset.selectedOptions[0].text+" reference price per troy ounce"};
    },() => asset.value);
    asset.addEventListener("change",() => {
      updatePurity();
      updateValue();
      if (details.open) updateHistory();
    });
    form.addEventListener("input",updateValue);
    form.addEventListener("change",updateValue);
    details.addEventListener("toggle",() => {if (details.open) updateHistory();});
    updatePurity();
    updateValue();
    updateQuotes();
    setInterval(() => {if (!document.hidden) updateQuotes();},60000);
  }
})();
