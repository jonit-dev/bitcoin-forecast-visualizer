const FRED_OBSERVATIONS_ENDPOINT = 'https://api.stlouisfed.org/fred/series/observations';
export const FRED_OBSERVATION_START = '2010-07-17';

export function requireFredApiKey(value = process.env.FRED_API_KEY) {
  const key = String(value ?? '').trim();
  if (!key) {
    throw new Error('Missing FRED_API_KEY. Set FRED_API_KEY in .env before fetching FRED observations.');
  }
  return key;
}

export function fredObservationUrl(seriesId, apiKey, observationStart = FRED_OBSERVATION_START) {
  const id = String(seriesId ?? '').trim();
  if (!/^[A-Z0-9_]+$/.test(id)) throw new Error('Invalid FRED series id.');
  const key = requireFredApiKey(apiKey);
  const params = new URLSearchParams({
    series_id: id,
    api_key: key,
    file_type: 'json',
    observation_start: observationStart,
    sort_order: 'asc',
  });
  return `${FRED_OBSERVATIONS_ENDPOINT}?${params.toString()}`;
}

export function parseFredObservations(payload, seriesId) {
  if (!payload || !Array.isArray(payload.observations)) {
    throw new Error(`Unexpected FRED observations response for ${seriesId}.`);
  }

  const observations = payload.observations
    .map(row => ({
      date: String(row.observation_date ?? row.date ?? ''),
      value: Number(row.value),
    }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && row.date >= FRED_OBSERVATION_START
      && Number.isFinite(row.value))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (observations.length === 0) {
    throw new Error(`FRED ${seriesId} returned no finite observations after ${FRED_OBSERVATION_START}.`);
  }
  return observations;
}

export async function fetchFredObservations(seriesId, apiKey, fetchImpl = fetch) {
  const url = fredObservationUrl(seriesId, apiKey);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': 'bitcoin-forecast-visualizer' },
    });
  } catch (error) {
    throw new Error(`FRED ${seriesId} request failed: ${safeErrorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(`FRED ${seriesId} request failed with HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`FRED ${seriesId} returned invalid JSON.`);
  }
  return parseFredObservations(payload, seriesId);
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/api_key=[^&\s]+/gi, 'api_key=[redacted]').replace(/FRED_API_KEY[=:][^\s]+/gi, 'FRED_API_KEY=[redacted]');
}
