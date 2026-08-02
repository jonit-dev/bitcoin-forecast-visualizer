const ENV_CONSUMERS = {
  FRED_API_KEY: 'update:macro',
};

export class MissingEnvironmentVariableError extends Error {
  constructor(name) {
    const consumer = ENV_CONSUMERS[name] ?? 'this command';
    super(
      `Missing required environment variable ${name} for ${consumer}. ` +
        `Set ${name} in the shell or configure the matching CI secret before running the updater.`
    );
    this.name = 'MissingEnvironmentVariableError';
    this.variableName = name;
  }
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new MissingEnvironmentVariableError(name);
  return value;
}
