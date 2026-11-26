"use strict";
const rateAtelierPracticalMath = Object.freeze({
  travel(budget,percent,fixed,count,rate) {
    if (![budget,percent,fixed,count,rate].every(Number.isFinite) || budget < 0 || percent < 0 ||
        fixed < 0 || !Number.isInteger(count) || count < 1 || count > 1000 || rate <= 0 || fixed*count > budget) return null;
    const principal = (budget-fixed*count)/(1+percent/100);
    const received = principal*rate;
    return [principal,received].every(Number.isFinite) ? {principal,received,fees:budget-principal} : null;
  },
  dealer(melt,offer,fee) {
    if (![melt,offer,fee].every(Number.isFinite) || melt <= 0 || offer < 0 || fee < 0 || fee > offer) return null;
    const net = offer-fee;
    return {net,percent:net/melt*100,difference:net-melt};
  }
});

