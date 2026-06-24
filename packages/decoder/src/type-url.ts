const TYPE_GOOGLEAPIS_PREFIX = 'type.googleapis.com/';

export function normalizeTypeUrl(typeUrl: string): string {
  const lookupName = typeUrlToLookupName(typeUrl);
  return lookupName ? `/${lookupName}` : '';
}

export function typeUrlToLookupName(typeUrl: string): string {
  const trimmed = typeUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(TYPE_GOOGLEAPIS_PREFIX)) {
    return trimmed.slice(TYPE_GOOGLEAPIS_PREFIX.length);
  }
  if (trimmed.includes('/')) {
    return trimmed.slice(trimmed.lastIndexOf('/') + 1);
  }
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
}

export function typeUrlToModule(typeUrl: string): string | undefined {
  const lookupName = typeUrlToLookupName(typeUrl);
  if (lookupName.startsWith('twilight.coreslot.v1.')) return 'coreslot';
  if (lookupName.startsWith('twilight.rewards.v1.')) return 'rewards';
  if (lookupName.startsWith('cosmos.bank.v1beta1.')) return 'bank';
  if (lookupName.startsWith('cosmos.auth.v1beta1.')) return 'auth';
  if (lookupName.startsWith('cosmos.tx.v1beta1.')) return 'tx';
  return undefined;
}

export function typeUrlToTypeName(typeUrl: string): string | undefined {
  const lookupName = typeUrlToLookupName(typeUrl);
  return lookupName ? lookupName.split('.').at(-1) : undefined;
}

export function isTwilightMsgTypeUrl(typeUrl: string): boolean {
  const lookupName = typeUrlToLookupName(typeUrl);
  return (
    lookupName.startsWith('twilight.coreslot.v1.Msg') ||
    lookupName.startsWith('twilight.rewards.v1.Msg')
  );
}
