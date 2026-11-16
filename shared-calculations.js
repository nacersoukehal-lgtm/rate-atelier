"use strict";

const rateAtelierMath = Object.freeze({
  transferPayout(budget,fee,rate) {
    return [budget,fee,rate].every(Number.isFinite) && budget >= 0 && fee >= 0 && fee <= budget && rate > 0
      ? (budget-fee)*rate : NaN;
  },
  meltValue(pricePerOunce,weight,gramsPerUnit,purity) {
    return [pricePerOunce,weight,gramsPerUnit,purity].every(Number.isFinite) &&
      pricePerOunce > 0 && weight >= 0 && gramsPerUnit > 0 && purity > 0 && purity <= 1
      ? pricePerOunce * weight * gramsPerUnit * purity / 31.1034768 : NaN;
  }
});
