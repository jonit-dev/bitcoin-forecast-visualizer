const GENESIS = new Date('2009-01-03T00:00:00Z');
export const POWER_LAW_MEAN_REVERSION_TAU_DAYS = 210;

export function daysSinceGenesis(date: Date): number {
  return Math.floor((date.getTime() - GENESIS.getTime()) / 86400000);
}

export function peakPowerLawPrice(t: number): number {
  return 9.89e-7 * Math.pow(t, 2.9379);
}

export function floorPowerLawPrice(t: number): number {
  const raw = Math.exp(-40.234) * Math.pow(t, 5.847);
  const a = 9.48e-10;
  const b = 3.6702;
  const cyclicAmplitude = Math.sqrt(0.2323 ** 2 + 0.4288 ** 2);
  const baseTrough = a * Math.pow(t, b) * (1 - cyclicAmplitude);
  return Math.min(raw, baseTrough);
}

export function basePowerLawPrice(t: number): number {
  const a = 9.48e-10;
  const b = 3.6702;
  const c1 = 0.2323;
  const c2 = 0.4288;
  const omega = (2 * Math.PI) / 1460;
  return a * Math.pow(t, b) * (1 + c1 * Math.sin(omega * t) + c2 * Math.cos(omega * t));
}

export function powerLawForecast(dateFuture: Date, currentPrice: number, currentDate: Date): number {
  const tNow = daysSinceGenesis(currentDate);
  const tFut = daysSinceGenesis(dateFuture);
  const hDays = Math.round((dateFuture.getTime() - currentDate.getTime()) / 86400000);
  const rT = Math.log(currentPrice) - Math.log(basePowerLawPrice(tNow));
  const corr = Math.exp(rT * Math.exp(-hDays / POWER_LAW_MEAN_REVERSION_TAU_DAYS));
  return basePowerLawPrice(tFut) * corr;
}
