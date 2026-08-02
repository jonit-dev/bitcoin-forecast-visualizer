export type LogNormalDistribution = {
  readonly kind: 'lognormal';
};

export type StudentTDistribution = {
  readonly kind: 'student-t';
  readonly nu: number;
};

export type PredictiveDistribution = LogNormalDistribution | StudentTDistribution;

/**
 * Return a price quantile for a distribution centred on `median` in log space.
 * The log-normal branch deliberately keeps the original multiplication and
 * exponentiation order so the shipped baseline remains bit-identical.
 */
export function quantileAt(
  distribution: PredictiveDistribution,
  median: number,
  sigma: number,
  probability: number
): number {
  assertScaleInputs(median, sigma);

  if (distribution.kind === 'lognormal' || distribution.kind === 'student-t' && distribution.nu === Number.POSITIVE_INFINITY) {
    return median * Math.exp(sigma * normalQuantile(probability));
  }

  const scale = standardizedStudentTScale(distribution.nu);
  return median * Math.exp(sigma * scale * studentTQuantile(probability, distribution.nu));
}

/** Return the CDF at a positive price for a distribution centred on `median`. */
export function cdfAt(
  distribution: PredictiveDistribution,
  median: number,
  sigma: number,
  price: number
): number {
  assertScaleInputs(median, sigma);
  if (!Number.isFinite(price) || price <= 0) return 0;

  const logValue = (Math.log(price) - Math.log(median)) / sigma;
  if (distribution.kind === 'lognormal' || distribution.kind === 'student-t' && distribution.nu === Number.POSITIVE_INFINITY) {
    return normalCdf(logValue);
  }

  return studentTCdf(logValue / standardizedStudentTScale(distribution.nu), distribution.nu);
}

/** Convert a Student-t variate to the unit-variance convention used by sigma. */
export function standardizedStudentTScale(nu: number): number {
  assertDegreesOfFreedom(nu);
  return nu === Number.POSITIVE_INFINITY ? 1 : Math.sqrt((nu - 2) / nu);
}

/**
 * Standard Student-t quantile.
 *
 * The initial value uses Hill's rational normal-tail expansion. A bracketed
 * inversion of the regularized-beta CDF corrects that approximation, keeping
 * the implementation dependency-free while meeting the published quantile
 * accuracy contract at low degrees of freedom.
 */
export function studentTQuantile(probability: number, nu: number): number {
  assertProbability(probability);
  assertDegreesOfFreedom(nu);
  if (nu === Number.POSITIVE_INFINITY) return normalQuantile(probability);
  if (probability === 0.5) return 0;

  const upperTailProbability = probability < 0.5 ? 1 - probability : probability;
  const sign = probability < 0.5 ? -1 : 1;
  const initial = Math.abs(studentTInitialRationalApproximation(upperTailProbability, nu));
  let lower = 0;
  let upper = Math.max(1, initial * 1.25);
  while (studentTCdf(upper, nu) < upperTailProbability) {
    upper *= 2;
    if (!Number.isFinite(upper)) throw new Error(`failed to bracket Student-t quantile for nu=${nu}`);
  }

  for (let iteration = 0; iteration < 100; iteration++) {
    const midpoint = (lower + upper) / 2;
    if (studentTCdf(midpoint, nu) < upperTailProbability) lower = midpoint;
    else upper = midpoint;
  }
  return sign * ((lower + upper) / 2);
}

/** Standard Student-t CDF before the unit-variance standardisation. */
export function studentTCdf(value: number, nu: number): number {
  assertDegreesOfFreedom(nu);
  if (Number.isNaN(value)) return Number.NaN;
  if (nu === Number.POSITIVE_INFINITY) return normalCdf(value);
  if (value === 0) return 0.5;

  const x = nu / (nu + value * value);
  const beta = regularizedIncompleteBeta(x, nu / 2, 0.5);
  return value > 0 ? 1 - 0.5 * beta : 0.5 * beta;
}

export function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

export function normalQuantile(probability: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  const p = Math.min(Math.max(probability, 1e-9), 1 - 1e-9);

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function studentTInitialRationalApproximation(probability: number, nu: number): number {
  const z = normalQuantile(probability);
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  const z9 = z7 * z2;
  return z
    + (z3 + z) / (4 * nu)
    + (5 * z5 + 16 * z3 + 3 * z) / (96 * nu * nu)
    + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * nu * nu * nu)
    + (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / (92160 * nu * nu * nu * nu);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const logBetaTerm = logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log1p(-x);
  const betaTerm = Math.exp(logBetaTerm);
  const threshold = (a + 1) / (a + b + 2);
  if (x < threshold) return betaTerm * betaContinuedFraction(x, a, b) / a;
  return 1 - betaTerm * betaContinuedFraction(1 - x, b, a) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const minimum = 1e-300;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < minimum) d = minimum;
  d = 1 / d;
  let h = d;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const m2 = 2 * iteration;
    let numerator = iteration * (b - iteration) * x / ((qam + m2) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < minimum) d = minimum;
    c = 1 + numerator / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    h *= d * c;

    numerator = -(a + iteration) * (qab + iteration) * x / ((a + m2) * (qap + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < minimum) d = minimum;
    c = 1 + numerator / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);

  const shifted = value - 1;
  let series = 0.9999999999998099;
  for (let index = 0; index < coefficients.length; index++) series += coefficients[index] / (shifted + index + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

function assertScaleInputs(median: number, sigma: number): void {
  if (!Number.isFinite(median) || median <= 0) throw new Error('predictive distribution median must be positive and finite');
  if (!Number.isFinite(sigma) || sigma <= 0) throw new Error('predictive distribution sigma must be positive and finite');
}

function assertProbability(probability: number): void {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error('predictive distribution probability must be strictly between zero and one');
  }
}

function assertDegreesOfFreedom(nu: number): void {
  if (nu !== Number.POSITIVE_INFINITY && (!Number.isFinite(nu) || nu <= 2)) {
    throw new Error('Student-t degrees of freedom must be greater than two');
  }
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
