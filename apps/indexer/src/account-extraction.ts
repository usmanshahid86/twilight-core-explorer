const ADDRESS_FIELD_PATTERN = /(address|operator|signer|sender|recipient|authority|payout)$/i;

export function extractAccountsFromValues(values: unknown[]): string[] {
  const accounts = new Set<string>();
  for (const value of values) collectAccounts(value, accounts);
  return [...accounts].sort();
}

export function isExplorerAccountAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('twilight1') && value.length >= 20) return true;
  if (value.startsWith('module:') && value.length > 'module:'.length) return true;
  return false;
}

function collectAccounts(value: unknown, accounts: Set<string>, keyHint?: string): void {
  if (isExplorerAccountAddress(value) && (!keyHint || ADDRESS_FIELD_PATTERN.test(keyHint))) {
    accounts.add(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectAccounts(item, accounts, keyHint);
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isExplorerAccountAddress(nested) && ADDRESS_FIELD_PATTERN.test(key)) {
      accounts.add(nested);
    } else {
      collectAccounts(nested, accounts, key);
    }
  }
}
