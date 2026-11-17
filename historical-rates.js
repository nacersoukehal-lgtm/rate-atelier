"use strict";

(() => {
  const get = id => document.getElementById("historical-" + id);
  const form = get("lookup");
  const from = get("from"), to = get("to"), mode = get("mode");
  const startInput = get("date"), endInput = get("end"), amount = get("amount");
  const status = get("status"), chart = get("chart"), body = get("rows");
  const day = 86400000;
  const pageSize = 30;
  const date = ms => new Date(ms).toISOString().slice(0,10);
  const todayLocal = new Date();
  const today = date(Date.UTC(todayLocal.getFullYear(),todayLocal.getMonth(),todayLocal.getDate()));
  const rate = new Intl.NumberFormat(undefined,{maximumSignificantDigits:8});
  const axis = new Intl.NumberFormat(undefined,{minimumFractionDigits:4,maximumFractionDigits:4});
  const percent = new Intl.NumberFormat(undefined,{style:"percent",signDisplay:"exceptZero",maximumFractionDigits:2});
  const currency = (value,code) => new Intl.NumberFormat(undefined,{style:"currency",currency:code,currencyDisplay:"code"}).format(value);
  let result;
  let page = 0;
  let sequence = 0;

  startInput.max = endInput.max = today;
  startInput.value = date(Date.parse(today) - 29 * day);
  endInput.value = today;

  function updateMode() {
    const isRange = mode.value === "range";
    get("end-field").hidden = !isRange;
    endInput.disabled = !isRange;
    get("shortcuts").hidden = !isRange;
    get("date-label").textContent = isRange ? "Start date" : "Date";
    form.querySelector('[type="submit"]').textContent = isRange ? "Look up range" : "Look up rate";
  }

  function renderPage() {
    const rows = result.rows;
    const last = rows.length - page * pageSize;
    const first = Math.max(0,last - pageSize);
    body.replaceChildren();
    for (const point of rows.slice(first,last).reverse()) {
      const row = body.insertRow();
      const time = document.createElement("time");
      time.setAttribute("datetime",point.date);
      time.textContent = point.date;
      row.insertCell().append(time);
      row.insertCell().textContent = rate.format(point.value);
    }
    get("prev").disabled = page === 0;
    get("next").disabled = first === 0;
    get("page-count").textContent = (page * pageSize + 1) + "–" + (rows.length - first) + " of " + rows.length;
  }

  function clearResults() {
    result = undefined;
    chart.hidden = true;
    chart.replaceChildren();
    get("table").hidden = true;
    get("table").open = false;
    get("csv").hidden = true;
    get("share").hidden = true;
    for (const id of ["summary","conversion"]) get(id).textContent = "";
    get("results").hidden = false;
  }

  function permalink(values) {
    const url = new URL(location.pathname,location.origin);
    for (const [name,value] of Object.entries(values)) url.searchParams.set(name,value);
    history.replaceState(null,"",url);
    get("share").href = url;
    get("share").hidden = false;
  }

  async function lookup() {
    const request = ++sequence;
    const base = from.value, target = to.value, quantity = amount.valueAsNumber;
    const isRange = mode.value === "range";
    const start = startInput.value, end = isRange ? endInput.value : start;
    clearResults();
    if (base === target) {
      status.textContent = "Choose two different currencies.";
      return;
    }
    if (!start || !end || start > today || end > today) {
      status.textContent = "Enter dates on or before today.";
      return;
    }
    if (start > end) {
      status.textContent = "Start date must be on or before the end date.";
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      status.textContent = "Enter an amount of zero or more.";
      return;
    }
    const params = {from:base,to:target,...(isRange ? {start,end} : {date:start})};
    if (quantity !== 1000) params.amount = quantity;
    permalink(params);
    status.textContent = "Looking up published reference rates…";
    try {
      const days = isRange ? (Date.parse(end) - Date.parse(start)) / day : 30;
      const rows = (await financeHistory.fx(base,target,days,Date.parse(end)))
        .filter(point => point.date <= end && (!isRange || point.date >= start));
      if (request !== sequence) return;
      get("snapshot").hidden = true;
      const last = rows.at(-1);
      if (!last) {
        status.textContent = isRange ? "No published rates between " + start + " and " + end + "."
          : "No published rate in the 30 days through " + end + ".";
        return;
      }
      const first = rows[0];
      const source = [base,target].includes("USD") && [base,target].includes("EUR") ? "ECB via Frankfurter" : "Frankfurter";
      status.textContent = isRange ? source + " · " + rows.length + " published " +
        (rows.length === 1 ? "rate" : "rates") + " from " + start + " through " + end + "."
        : source + " · " + (last.date === end ? "Observation on " + end + "."
          : "No observation on " + end + ". Latest prior rate: " + last.date + ".");
      if (isRange) {
        const low = rows.reduce((value,point) => Math.min(value,point.value),Infinity);
        const high = rows.reduce((value,point) => Math.max(value,point.value),0);
        get("summary").textContent = target + " per " + base + " · First " + rate.format(first.value) +
          " (" + first.date + ") · Last " + rate.format(last.value) + " (" + last.date + ") · Change " +
          percent.format(last.value/first.value-1) + " · Low " + rate.format(low) + " · High " + rate.format(high);
      }
      get("conversion").textContent = currency(quantity,base) + " was worth " +
        (isRange && rows.length > 1 ? currency(quantity*first.value,target) + " on " + first.date + " and " : "") +
        currency(quantity*last.value,target) + " on " + last.date + " at the published reference rate.";
      if (isRange && rows.length > 1) {
        chart.hidden = false;
        drawFinanceChart(chart,rows,rate.format,base + " to " + target + " reference rates",false,
          {tall:true,axisFormat:axis.format,showHistory:false});
      }
      result = {rows,base,target};
      page = 0;
      get("unit").textContent = target + " per " + base;
      get("caption").textContent = isRange ? "Published rates within the selected dates" : "Published rates through " + end;
      get("table").querySelector("summary").textContent = "View rate history (" + rows.length + ")";
      get("table").hidden = get("csv").hidden = false;
      renderPage();
    } catch {
      if (request === sequence) status.textContent = "Could not retrieve rates for those dates. Try again or choose another pair.";
    }
  }

  mode.addEventListener("change",updateMode);
  from.addEventListener("change",() => { get("base").textContent = from.value; });
  get("swap").addEventListener("click",() => {
    [from.value,to.value] = [to.value,from.value];
    get("base").textContent = from.value;
    lookup();
  });
  get("shortcuts").addEventListener("click",event => {
    const preset = event.target.dataset.range;
    if (!preset) return;
    const end = Date.parse(today);
    const first = new Date(end);
    if (preset === "year") {
      first.setUTCDate(1);
      first.setUTCFullYear(todayLocal.getFullYear() - 1);
      const lastDay = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
      first.setUTCDate(Math.min(todayLocal.getDate(),lastDay));
    } else if (preset === "ytd") first.setUTCMonth(0,1);
    else first.setTime(end - (Number(preset) - 1) * day);
    startInput.value = date(first);
    endInput.value = today;
    lookup();
  });
  form.addEventListener("submit",event => {
    event.preventDefault();
    lookup();
  });
  for (const [id,step] of [["prev",-1],["next",1]]) get(id).addEventListener("click",() => {
    page += step;
    renderPage();
  });
  get("csv").addEventListener("click",() => {
    const {rows,base,target} = result;
    const data = ["date," + target + "_per_" + base,...[...rows].reverse().map(point => point.date + "," + point.value)];
    const url = URL.createObjectURL(new Blob([data.join("\r\n") + "\r\n"],{type:"text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = base + "-" + target + "-rates.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  });

  const query = new URLSearchParams(location.search);
  function setPair() {
    for (const [key,select] of [["from",from],["to",to]]) {
      const code = query.get(key)?.toUpperCase();
      if ([...select.options].some(option => option.value === code)) select.value = code;
    }
    get("base").textContent = from.value;
  }
  if (query.has("date") || ((query.has("from") || query.has("to")) && !query.has("start") && !query.has("end"))) {
    mode.value = "single";
    startInput.value = query.get("date") ?? today;
  } else {
    if (query.has("start")) startInput.value = query.get("start");
    if (query.has("end")) endInput.value = query.get("end");
  }
  if (query.has("amount")) amount.value = query.get("amount");
  updateMode();
  setPair();
  const missingCode = [["from",from],["to",to]].some(([key,select]) =>
    query.has(key) && select.value !== query.get(key).toUpperCase());
  if (!missingCode && (query.has("date") || query.has("start") || query.has("end"))) lookup();
  currencyFeed.latest().then(({names}) => {
    for (const select of [from,to]) {
      for (const [code,name] of names) {
        if (![...select.options].some(option => option.value === code)) select.add(new Option(code + " — " + name,code));
      }
    }
  }).catch(() => {}).finally(() => {
    if (!missingCode || sequence) return;
    setPair();
    if (query.has("date") || query.has("start") || query.has("end")) {
      const unsupported = [["from",from],["to",to]].some(([key,select]) =>
        query.has(key) && select.value !== query.get(key).toUpperCase());
      if (unsupported) {
        clearResults();
        status.textContent = "A currency in this link is unavailable. Choose a pair from the lists.";
      } else lookup();
    }
  });
})();
