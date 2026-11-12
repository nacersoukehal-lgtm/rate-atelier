"use strict";

const calc = id => document.getElementById(id);
const usdProjection = new Intl.NumberFormat(undefined,{style:"currency",currency:"USD",maximumFractionDigits:0});
const compoundForm = calc("compound-fields");

function updateCompound() {
  const [initial,monthly,annual,years] = ["compound-start","compound-monthly","compound-rate","compound-years"]
    .map(id => calc(id).valueAsNumber);
  const chart = calc("compound-chart");
  if (!compoundForm.checkValidity() || ![initial,monthly,annual,years].every(Number.isFinite)) {
    calc("compound-total").textContent = "—";
    calc("compound-detail").textContent = "";
    chart.textContent = "Enter a value in each field within the stated limits.";
    return;
  }
  const monthlyRate = Math.expm1(Math.log1p(annual/100)/12);
  let balance = initial;
  const points = [{date:0,value:balance}];
  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) balance = balance*(1+monthlyRate)+monthly;
    points.push({date:year,value:balance});
  }
  const contributed = initial+monthly*years*12;
  calc("compound-total").textContent = usdProjection.format(balance);
  calc("compound-detail").textContent = usdProjection.format(contributed) + " contributed · " + usdProjection.format(balance-contributed) + " growth";
  drawFinanceChart(chart,points,usdProjection.format,"Projected compound interest balance");
}

compoundForm.addEventListener("input",updateCompound);
updateCompound();

const fxPanel = calc("fx-tool-history");
const meltPanel = calc("melt-tool-history");
const fxChart = mountFinanceHistory(calc("fx-tool-chart"),async () => {
  const from = calc("from").value;
  const to = calc("to").value;
  const amount = calc("amount").valueAsNumber;
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid amount");
  const points = (await financeHistory.fx(from,to)).map(row => ({...row,value:row.value*amount}));
  return {points,format:value => money(value,to),label:"Historical value of " + money(amount,from) + " in " + to};
});
const meltChart = mountFinanceHistory(calc("melt-tool-chart"),async () => {
  const metal = calc("metal").value;
  const currency = calc("metal-currency").value;
  const ounces = calc("weight").valueAsNumber * +calc("weight-unit").value * +calc("purity").value / ouncesInGrams;
  if (!Number.isFinite(ounces) || ounces < 0) throw new Error("Invalid weight");
  const [history,fx] = await Promise.all([financeHistory.metal(metal),financeHistory.fx("USD",currency,42)]);
  let index = -1;
  const points = [];
  for (const row of history) {
    while (index+1 < fx.length && fx[index+1].date.slice(0,10) <= row.date.slice(0,10)) index++;
    if (index >= 0) points.push({date:row.date,value:row.value*fx[index].value*ounces});
  }
  return {points,format:value => money(value,currency),label:"Estimated historical melt value in " + currency};
});

for (const [panel,refreshChart,ids,buttons] of [
  [fxPanel,fxChart,["from","to","amount"],["swap","quick-aud"]],
  [meltPanel,meltChart,["metal","metal-currency","weight","weight-unit","purity"],["quick-gold"]]
]) {
  const refresh = () => { if (panel.open) refreshChart(); };
  panel.addEventListener("toggle",refresh);
  for (const id of ids) calc(id).addEventListener("input",refresh);
  for (const id of buttons) calc(id).addEventListener("click",refresh);
}
