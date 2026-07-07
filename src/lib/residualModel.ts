export interface RidgeNormalizer {
  featureNames: string[];
  means: number[];
  stds: number[];
}

export interface RidgeResidualModel {
  normalizer: RidgeNormalizer;
  coefficients: number[];
  trainingRows: number;
  trainingEndDate: string;
}

export interface ResidualTrainingRow {
  originDate: string;
  targetResidualLog: number;
  features: Record<string, number>;
}

export function fitRidgeResidualModel(input: {
  rows: ResidualTrainingRow[];
  featureNames: string[];
  lambda: number;
  trainingEndDate: string;
}): RidgeResidualModel | null {
  if (input.rows.length === 0 || input.featureNames.length === 0) return null;
  const normalizer = buildNormalizer(input.rows, input.featureNames);
  const width = input.featureNames.length + 1;
  const xtx = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const xty = Array.from({ length: width }, () => 0);

  for (const row of input.rows) {
    const x = rowVector(row.features, normalizer);
    for (let i = 0; i < width; i++) {
      xty[i] += x[i] * row.targetResidualLog;
      for (let j = 0; j < width; j++) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < width; i++) xtx[i][i] += input.lambda;
  const coefficients = solveLinearSystem(xtx, xty);
  if (!coefficients) return null;
  return {
    normalizer,
    coefficients,
    trainingRows: input.rows.length,
    trainingEndDate: input.trainingEndDate,
  };
}

export function predictRidgeResidual(model: RidgeResidualModel, features: Record<string, number>): number | null {
  if (model.normalizer.featureNames.some(name => !Number.isFinite(features[name]))) return null;
  const x = rowVector(features, model.normalizer);
  return x.reduce((sum, value, index) => sum + value * (model.coefficients[index] ?? 0), 0);
}

function buildNormalizer(rows: ResidualTrainingRow[], featureNames: string[]): RidgeNormalizer {
  const means = featureNames.map(name => mean(rows.map(row => row.features[name]).filter(Number.isFinite)) ?? 0);
  const stds = featureNames.map((name, index) => {
    const values = rows.map(row => row.features[name]).filter(Number.isFinite);
    const variance = mean(values.map(value => (value - means[index]) ** 2)) ?? 0;
    return variance > 0 ? Math.sqrt(variance) : 1;
  });
  return { featureNames, means, stds };
}

function rowVector(features: Record<string, number>, normalizer: RidgeNormalizer): number[] {
  return [
    1,
    ...normalizer.featureNames.map((name, index) => (features[name] - normalizer.means[index]) / normalizer.stds[index]),
  ];
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) return null;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const divisor = augmented[col][col];
    for (let j = col; j <= n; j++) augmented[col][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = col; j <= n; j++) augmented[row][j] -= factor * augmented[col][j];
    }
  }
  return augmented.map(row => row[n]);
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}
