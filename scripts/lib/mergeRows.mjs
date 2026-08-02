function mergeValues(existing, incoming) {
  if (
    existing &&
    incoming &&
    typeof existing === 'object' &&
    typeof incoming === 'object' &&
    !Array.isArray(existing) &&
    !Array.isArray(incoming)
  ) {
    const merged = { ...existing };
    for (const [name, value] of Object.entries(incoming)) {
      merged[name] = Object.hasOwn(existing, name) ? mergeValues(existing[name], value) : value;
    }
    return merged;
  }

  return incoming;
}

function assertKey(row, key, collectionName) {
  if (!row || row[key] === undefined || row[key] === null || row[key] === '') {
    throw new Error(`mergeByKey: ${collectionName} row is missing required key "${key}"`);
  }
}

/**
 * Union two row collections by key.
 *
 * Incoming values win when both rows provide a value. Object fields that are
 * omitted by an incoming row remain intact so a partial vendor response does
 * not erase a previously observed metric on the same date.
 */
export function mergeByKey(existing, incoming, key) {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) {
    throw new TypeError('mergeByKey expects existing and incoming arrays');
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('mergeByKey expects a non-empty key name');
  }

  const byKey = new Map();
  for (const row of existing) {
    assertKey(row, key, 'existing');
    byKey.set(String(row[key]), row);
  }
  for (const row of incoming) {
    assertKey(row, key, 'incoming');
    const rowKey = String(row[key]);
    byKey.set(rowKey, byKey.has(rowKey) ? mergeValues(byKey.get(rowKey), row) : row);
  }

  return [...byKey.values()].sort((left, right) => {
    const leftKey = String(left[key]);
    const rightKey = String(right[key]);
    if (leftKey === rightKey) return 0;
    return leftKey < rightKey ? -1 : 1;
  });
}
