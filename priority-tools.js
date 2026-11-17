"use strict";

(() => {
  const byId = id => document.getElementById(id);
  const money = (value,currency) => new Intl.NumberFormat(undefined,{style:"currency",currency}).format(value);
  const decimal = new Intl.NumberFormat(undefined,{maximumSignificantDigits:7});
  const percent = new Intl.NumberFormat(undefined,{style:"percent",maximumFractionDigits:2});
  const day = value => new Date(value).toISOString().slice(0,10);
  const positive = value => Number.isFinite(value) && value > 0;
  const getJSON = async url => {
    const response = await fetch(url,{signal:AbortSignal.timeout(9000)});
    if (!response.ok) throw Error("Data unavailable");
    return response.json();
  };

  function showRates(body,rows,limit = 15) {
    body.replaceChildren();
    rows.slice(-limit).reverse().forEach(point => {
      const row = body.insertRow();
      const time = document.createElement("time");
      time.dateTime = point.date;
      time.textContent = point.date;
      row.insertCell().append(time);
      row.insertCell().textContent = decimal.format(point.value);
    });
  }

  const pair = document.querySelector("[data-fx-pair]");
  if (pair) {
    const [from,to] = pair.dataset.fxPair.split("/");
    const range = byId("fx-range");
    const status = byId("pair-status");
    const chart = byId("pair-chart");
    const amount = byId("pair-amount");
    const snapshot = byId("landing-quote")?.dataset;
    let latest = positive(Number(snapshot?.snapshotRate)) && Number.isFinite(Date.parse(snapshot.snapshotDate))
      ? {date:day(snapshot.snapshotDate),value:Number(snapshot.snapshotRate)} : null;
    let request = 0;
    const renderConverter = () => {
      if (!amount) return;
      const converted = amount.valueAsNumber * (latest?.value ?? NaN);
      byId("pair-result").textContent = Number.isFinite(converted) && converted >= 0 ? money(converted,to)
        : latest ? "Enter an amount" : "Reference rate unavailable";
      byId("pair-source").textContent = latest
        ? "1 " + from + " = " + decimal.format(latest.value) + " " + to + " · Frankfurter · " + latest.date : "";
    };
    amount?.addEventListener("input",renderConverter);
    if (latest) renderConverter();

    async function refreshPair() {
      const current = ++request;
      const days = Number(range.value);
      chart.replaceChildren();
      byId("pair-rows").replaceChildren();
      status.textContent = "Loading reference rates…";
      try {
        const rows = await financeHistory.fx(from,to,days);
        if (request !== current) return;
        const last = rows.at(-1);
        if (!last) throw Error("No observations");
        if (!latest || last.date >= latest.date) latest = last;
        renderConverter();
        showRates(byId("pair-rows"),rows);
        if (rows.length > 1) drawFinanceChart(chart,rows,value => decimal.format(value),from + " to " + to + " reference rate");
        status.textContent = (rows.length > 1 ? "" : "Only one published observation in this range. ") +
          (to === "EUR" ? "ECB via Frankfurter" : "Frankfurter") + " · Latest observation " + last.date;
      } catch {
        if (request !== current) return;
        renderConverter();
        status.textContent = "History unavailable for this range. Try a different range or try again later.";
      }
    }
    range.addEventListener("change",refreshPair);
    refreshPair();
  }

  const historical = byId("historical-lookup");
  if (historical) {
    const from = byId("historical-from");
    const to = byId("historical-to");
    const input = byId("historical-date");
    const status = byId("historical-status");
    const query = new URLSearchParams(location.search);
    const mode = byId("historical-mode");
    const endInput = byId("historical-end");
    const chart = byId("historical-chart");
    const caption = byId("historical-caption");
    const submit = historical.querySelector("button");
    const today = day(Date.now());
    input.max = endInput.max = today;
    input.value = endInput.value = today;

    function updateMode() {
      const isRange = mode.value === "range";
      byId("historical-end-field").hidden = !isRange;
      endInput.disabled = !isRange;
      endInput.required = isRange;
      byId("historical-date-label").textContent = isRange ? "Start date" : "Date";
      submit.textContent = isRange ? "Look up range" : "Look up rate";
    }
    mode.addEventListener("change",updateMode);
    updateMode();
    let request = 0;
    const choose = () => {
      for (const [key,select] of [["from",from],["to",to]]) {
        const code = query.get(key)?.toUpperCase();
        if ([...select.options].some(option => option.value === code)) select.value = code;
      }
    };
    choose();
    currencyFeed.latest().then(({names}) => {
      for (const select of [from,to]) {
        for (const [code,name] of names) {
          if (![...select.options].some(option => option.value === code)) select.add(new Option(code + " — " + name,code));
        }
      }
      if (!request) choose();
    }).catch(() => {});

    historical.addEventListener("submit",async event => {
      event.preventDefault();
      const current = ++request;
      const base = from.value;
      const target = to.value;
      const isRange = mode.value === "range";
      const start = input.value;
      const requested = isRange ? endInput.value : start;
      const end = Date.parse(requested);
      const startTime = Date.parse(start);
      const body = byId("historical-rows");
      body.replaceChildren();
      chart.replaceChildren();
      chart.hidden = true;
      caption.textContent = isRange ? "Published rates within the selected range" : "Published rates through the selected date";
      if (!Number.isFinite(end) || !Number.isFinite(startTime) || requested > today || start > today || base === target) {
        status.textContent = "Choose two different currencies and a date on or before today.";
        return;
      }
      if (isRange && start > requested) {
        status.textContent = "Start date must be on or before the end date.";
        return;
      }
      byId("historical-unit").textContent = target + " per " + base;
      status.textContent = "Looking up the published reference rate…";
      try {
        const days = isRange ? (end - startTime) / 86400000 : 30;
        const rows = (await financeHistory.fx(base,target,days,end))
          .filter(point => point.date <= requested && (!isRange || point.date >= start));
        if (request !== current) return;
        const last = rows.at(-1);
        if (!last) {
          status.textContent = isRange ? "No published rates for this pair between " + start + " and " + requested + "."
            : "No published rate for this pair in the 30 days through " + requested + ".";
          return;
        }
        const source = [base,target].includes("EUR") && [base,target].includes("USD") ? "ECB via Frankfurter" : "Frankfurter";
        if (isRange) {
          const first = rows[0];
          status.textContent = rows.length + (rows.length === 1 ? " published rate" : " published rates") +
            " · " + source + " · Observations: " + (first === last ? first.date : first.date + " to " + last.date);
          showRates(body,rows,rows.length);
          if (rows.length > 1) {
            chart.hidden = false;
            drawFinanceChart(chart,rows,decimal.format,base + " to " + target + " reference rates");
          }
          return;
        }
        status.textContent = "1 " + base + " = " + decimal.format(last.value) + " " + target + " · " + source + " · " +
          (last.date === requested ? last.date : "No observation on " + requested + ". Latest prior rate: " + last.date);
        showRates(body,rows);
      } catch {
        if (request === current) status.textContent = "Could not retrieve rates for that pair and date. Try again or choose another pair.";
      }
    });
  }

  const gold = byId("gold-by-currency");
  if (gold) {
    const currency = byId("gold-currency");
    const status = byId("gold-input-source");
    const body = byId("gold-unit-rows");
    const units = [["Gram",1],["Kilogram",1000],["Tola",31.1034768 * 3 / 8],["Troy ounce",31.1034768]];
    let quote;
    let data;
    let loading = true;
    const dateTime = value => new Date(value).toISOString().slice(0,16).replace("T"," ") + " UTC";
    const render = () => {
      const code = currency.value;
      const exchange = code === "USD" ? {rate:1} : data?.rates.get(code);
      body.replaceChildren();
      for (const [unit,grams] of units) {
        const row = body.insertRow();
        row.insertCell().textContent = unit;
        const value = rateAtelierMath.meltValue(quote?.value * exchange?.rate,1,grams,1);
        row.insertCell().textContent = positive(value) ? money(value,code) : "Unavailable";
      }
      if (!quote || !exchange) {
        status.textContent = loading ? "Checking published gold and exchange rates…" :
          !quote ? "Gold quote unavailable. Please try again later." : "Exchange rate unavailable for " + code + ".";
        return;
      }
      const stale = Date.now() - Date.parse(quote.date) > 3600000;
      status.textContent = "Gold: " + (stale ? "Stale · " : "") + "Standard Bullion · " + dateTime(quote.date) +
        (code === "USD" ? "" : " | FX: " + (exchange.source ?? data.source) + " · " + exchange.date);
    };
    currency.addEventListener("change",render);
    const accept = candidate => {
      if (positive(candidate?.value) && Number.isFinite(Date.parse(candidate.date)) &&
          (!quote || Date.parse(candidate.date) > Date.parse(quote.date))) {
        quote = candidate;
        render();
      }
    };
    const published = getJSON("./published-quote-snapshot.json").then(snapshot => accept(snapshot.XAU));
    const spot = getJSON("https://standardbullion.com/spot-prices.json").then(feed => {
      const metal = feed.metals?.find(item => item.symbol === "XAU");
      if (positive(metal?.bid) && positive(metal.ask)) accept({value:(metal.bid+metal.ask)/2,date:feed.updated});
    });
    const rates = currencyFeed.latest().then(feed => {
      data = feed;
      for (const [code,name] of feed.names) {
        if (![...currency.options].some(option => option.value === code)) currency.add(new Option(code + " — " + name,code));
      }
      render();
    });
    Promise.allSettled([published,spot,rates]).then(() => {
      loading = false;
      render();
    });
  }

  const breakEven = byId("bullion-break-even");
  if (breakEven) {
    const output = byId("break-even-result");
    const details = byId("break-even-details");
    const calculate = () => {
      const inputs = breakEven.elements;
      const result = rateAtelierMath.bullionBreakEven(...["purchase","buyFees","sellFees","weight","spot","buyback"]
        .map(name => inputs.namedItem(name).valueAsNumber));
      if (!result) {
        output.textContent = "Break-even unavailable";
        details.textContent = "Enter valid prices, a positive fine weight, and fees of zero or more.";
        return;
      }
      output.textContent = money(result.target,inputs.namedItem("currency").value) + " per troy oz";
      const relative = result.change > 0 ? percent.format(result.change) + " above spot"
        : result.change < 0 ? percent.format(-result.change) + " below spot" : "equal to spot";
      details.textContent = inputs.namedItem("metal").value + " · " + relative + " · Dealer buyback equals " +
        percent.format(result.fraction) + " of reference spot.";
    };
    breakEven.addEventListener("submit",event => {
      event.preventDefault();
      calculate();
    });
    breakEven.addEventListener("input",calculate);
    calculate();
  }
})();
