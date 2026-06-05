import { POWER_LAW_CONFIG } from './modelConfig';

const GENESIS = new Date(POWER_LAW_CONFIG.genesisDate);
export const POWER_LAW_MEAN_REVERSION_TAU_DAYS = POWER_LAW_CONFIG.meanReversionTauDays;

export function daysSinceGenesis(date: Date): number {
  return Math.floor((date.getTime() - GENESIS.getTime()) / 86400000);
}

export function peakPowerLawPrice(t: number): number {
  return POWER_LAW_CONFIG.peak.coefficient * Math.pow(t, POWER_LAW_CONFIG.peak.exponent);
}

export function floorPowerLawPrice(t: number): number {
  const raw = POWER_LAW_CONFIG.floor.rawCoefficient * Math.pow(t, POWER_LAW_CONFIG.floor.rawExponent);
  const a = POWER_LAW_CONFIG.floor.cyclicCoefficient;
  const b = POWER_LAW_CONFIG.floor.cyclicExponent;
  const cyclicAmplitude = Math.sqrt(POWER_LAW_CONFIG.floor.sinAmplitude ** 2 + POWER_LAW_CONFIG.floor.cosAmplitude ** 2);
  const baseTrough = a * Math.pow(t, b) * (1 - cyclicAmplitude);
  return Math.min(raw, baseTrough);
}

export function basePowerLawPrice(t: number): number {
  const a = POWER_LAW_CONFIG.base.coefficient;
  const b = POWER_LAW_CONFIG.base.exponent;
  const c1 = POWER_LAW_CONFIG.base.sinAmplitude;
  const c2 = POWER_LAW_CONFIG.base.cosAmplitude;
  const omega = (2 * Math.PI) / POWER_LAW_CONFIG.base.cycleDays;
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
