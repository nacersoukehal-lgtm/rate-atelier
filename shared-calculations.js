"use strict";

const rateAtelierMath = Object.freeze({
  transferPayout(budget,fee,rate) {
    return [budget,fee,rate].every(Number.isFinite) && budget >= 0 && fee >= 0 && fee <= budget && rate > 0
      ? (budget-fee)*rate : NaN;
  },
  bullionBreakEven(purchase,buyFees,sellFees,weight,spot,buyback) {
    const cost = purchase + buyFees + sellFees;
    const fraction = buyback / (weight * spot);
    const target = cost / (weight * fraction);
    return [purchase,buyFees,sellFees,weight,spot,buyback,fraction,target].every(Number.isFinite) &&
      purchase > 0 && buyFees >= 0 && sellFees >= 0 && weight > 0 && spot > 0 && buyback > 0 && fraction > 0
      ? {target,fraction,change:(target / spot - 1)} : null;
  },
  meltValue(pricePerOunce,weight,gramsPerUnit,purity) {
    return [pricePerOunce,weight,gramsPerUnit,purity].every(Number.isFinite) &&
      pricePerOunce > 0 && weight >= 0 && gramsPerUnit > 0 && purity > 0 && purity <= 1
      ? pricePerOunce * weight * gramsPerUnit * purity / 31.1034768 : NaN;
  }
});
