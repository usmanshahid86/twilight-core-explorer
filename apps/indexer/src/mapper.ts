import type {
  BlockResultsSource,
  BlockSource,
  TxSource,
} from '@twilight-explorer/chain-client';
import {
  decodeRawTxBase64,
  typeUrlToModule,
  typeUrlToTypeName,
} from '@twilight-explorer/decoder';

export interface BlockRow {
  height: bigint;
  hash: string | null;
  time: Date | null;
  chainId: string | null;
  proposerAddress: string | null;
  appHash: string | null;
  validatorsHash: string | null;
  nextValidatorsHash: string | null;
  lastBlockHash: string | null;
  txCount: number;
  rawJson: unknown;
}

export interface TransactionRow {
  hash: string;
  height: bigint;
  index: number;
  code: number | null;
  codespace: string | null;
  status: string;
  gasWanted: bigint | null;
  gasUsed: bigint | null;
  memo: string | null;
  feeJson: unknown | null;
  signerAddressesJson: string[];
  messageTypesJson: string[];
  rawTx: unknown | null;
  rawResultJson: unknown;
}

export interface MessageRow {
  txHash: string;
  height: bigint;
  msgIndex: number;
  typeUrl: string;
  module: string | null;
  typeName: string | null;
  decodedJson: unknown | null;
  rawJson: unknown | null;
  decodeError: string | null;
}

export interface EventRow {
  eventKey: string;
  height: bigint;
  txHash: string | null;
  txIndex: number | null;
  msgIndex: number | null;
  eventIndex: number;
  phase: string;
  type: string;
  attributesJson: unknown;
  module: string | null;
  keyFieldsJson: unknown | null;
}

export interface DecodeFailureRow {
  height: bigint;
  txHash: string | null;
  msgIndex: number | null;
  eventIndex: number | null;
  typeUrl: string | null;
  eventType: string | null;
  failureKind: string;
  rawJson: unknown | null;
  rawBase64: string | null;
  decodeError: string;
  resolved: boolean;
}

export function mapBlockSourceToBlockRow(
  chainId: string,
  source: BlockSource,
  txCount: number,
): BlockRow {
  const raw = asRecord(source.raw);
  const result = asRecord(raw.result);
  const block = asRecord(result.block);
  const header = asRecord(block.header);
  const blockId = asRecord(result.block_id);

  return {
    height: BigInt(source.height),
    hash: source.hash ?? readString(blockId.hash) ?? null,
    time: parseDate(source.time ?? readString(header.time)),
    chainId,
    proposerAddress: readString(header.proposer_address) ?? null,
    appHash: readString(header.app_hash) ?? null,
    validatorsHash: readString(header.validators_hash) ?? null,
    nextValidatorsHash: readString(header.next_validators_hash) ?? null,
    lastBlockHash: readString(asRecord(header.last_block_id).hash) ?? null,
    txCount,
    rawJson: source.raw,
  };
}

export function mapTxSourceToTransactionRow(
  source: TxSource,
  height: bigint,
  index: number,
): TransactionRow {
  const raw = asRecord(source.raw);
  const tx = asRecord(raw.tx);
  const body = asRecord(tx.body);
  const authInfo = asRecord(tx.auth_info);
  const fee = authInfo.fee ?? null;
  const code = readNumber(raw.code) ?? source.code ?? null;
  const gasWanted = readBigInt(raw.gas_wanted);
  const gasUsed = readBigInt(raw.gas_used);
  const messageTypes = extractMessagesFromTx(source).map((message) => message.typeUrl);
  const signerAddresses = extractSignerAddresses(source);

  return {
    hash: source.hash || readString(raw.txhash) || `height-${height.toString()}-tx-${index}`,
    height,
    index,
    code,
    codespace: readString(raw.codespace) ?? null,
    status: code === null || code === 0 ? 'success' : 'failed',
    gasWanted,
    gasUsed,
    memo: readString(body.memo) ?? null,
    feeJson: fee,
    signerAddressesJson: signerAddresses,
    messageTypesJson: messageTypes,
    rawTx: raw.tx ?? null,
    rawResultJson: source.raw,
  };
}

export function extractMessagesFromTx(source: TxSource): MessageRow[] {
  const raw = asRecord(source.raw);
  const tx = asRecord(raw.tx);
  const body = asRecord(tx.body);
  const messages = readArray(body.messages);

  if (messages.length > 0) {
    return messages.map((message, msgIndex) => {
      const record = asRecord(message);
      const typeUrl = readString(record['@type']) ?? readString(record.typeUrl) ?? 'unknown';
      return {
        txHash: source.hash,
        height: BigInt(source.height ?? '0'),
        msgIndex,
        typeUrl,
        module: inferModuleFromTypeUrl(typeUrl) ?? null,
        typeName: inferTypeName(typeUrl),
        decodedJson: inferModuleFromTypeUrl(typeUrl) ? message : null,
        rawJson: message,
        decodeError: null,
      };
    });
  }

  const rawTxBase64 = getRawTxBase64(source);
  if (!rawTxBase64) return [];

  return decodeRawTxBase64(rawTxBase64).messages.map((message) => ({
    txHash: source.hash,
    height: BigInt(source.height ?? '0'),
    msgIndex: message.index,
    typeUrl: message.typeUrl || 'unknown',
    module: message.module ?? null,
    typeName: message.typeName ?? null,
    decodedJson: message.decodedJson ?? null,
    rawJson: {
      typeUrl: message.typeUrl,
      lookupName: message.lookupName,
      rawValueBase64: message.rawValueBase64,
    },
    decodeError: message.decodeError ?? null,
  }));
}

export function extractDecodeFailuresFromTx(source: TxSource): DecodeFailureRow[] {
  const rawTxBase64 = getRawTxBase64(source);
  if (!rawTxBase64) return [];

  return decodeRawTxBase64(rawTxBase64).failures.map((failure) => ({
    height: BigInt(source.height ?? '0'),
    txHash: source.hash || null,
    msgIndex: failure.msgIndex ?? null,
    eventIndex: null,
    typeUrl: failure.typeUrl ?? null,
    eventType: null,
    failureKind: failure.failureKind,
    rawJson: {
      source: 'raw_tx_base64',
      typeUrl: failure.typeUrl ?? null,
    },
    rawBase64: failure.rawBase64 ?? rawTxBase64,
    decodeError: failure.decodeError,
    resolved: false,
  }));
}

export function extractEventsFromTx(source: TxSource, txIndex: number): EventRow[] {
  const raw = asRecord(source.raw);
  const events = readArray(raw.events);
  const height = BigInt(source.height ?? '0');

  return events.map((event, eventIndex) => mapEvent({
    event,
    height,
    txHash: source.hash,
    txIndex,
    eventIndex,
    phase: 'tx',
  }));
}

export function extractBlockResultEvents(source: BlockResultsSource): EventRow[] {
  const height = BigInt(source.height);
  const beginEvents = source.beginBlockEvents.map((event, eventIndex) => mapEvent({
    event,
    height,
    txHash: null,
    txIndex: null,
    eventIndex,
    phase: 'begin_block',
  }));
  const endEvents = source.endBlockEvents.map((event, eventIndex) => mapEvent({
    event,
    height,
    txHash: null,
    txIndex: null,
    eventIndex,
    phase: 'end_block',
  }));

  return [...beginEvents, ...endEvents];
}

export function inferModuleFromTypeUrl(typeUrl: string): string | undefined {
  const module = typeUrlToModule(typeUrl);
  if (module) return module;
  if (typeUrl.includes('twilight.coreslot.v1')) return 'coreslot';
  if (typeUrl.includes('twilight.rewards.v1')) return 'rewards';
  if (typeUrl.includes('cosmos.bank.v1beta1')) return 'bank';
  if (typeUrl.includes('cosmos.auth.v1beta1')) return 'auth';
  if (typeUrl.includes('cosmos.tx.v1beta1')) return 'tx';
  return undefined;
}

export function inferModuleFromEventType(type: string): string | undefined {
  if (type.startsWith('coreslot') || type.includes('core_slot')) return 'coreslot';
  if (type.startsWith('rewards') || type.includes('reward')) return 'rewards';
  if (type.startsWith('coin_') || type === 'transfer') return 'bank';
  if (type === 'tx' || type === 'message') return 'tx';
  return undefined;
}

export function extractSignerAddresses(source: TxSource): string[] {
  const raw = asRecord(source.raw);
  const signerAddresses = readArray(raw.signers)
    .map(readString)
    .filter((value): value is string => Boolean(value));
  return [...new Set(signerAddresses)].sort();
}

function mapEvent(args: {
  event: unknown;
  height: bigint;
  txHash: string | null;
  txIndex: number | null;
  eventIndex: number;
  phase: string;
}): EventRow {
  const record = asRecord(args.event);
  const type = readString(record.type) ?? 'unknown';
  const attributes = normalizeAttributes(record.attributes);

  return {
    eventKey: `${args.height.toString()}:${args.phase}:${args.txHash ?? 'none'}:${args.eventIndex}`,
    height: args.height,
    txHash: args.txHash,
    txIndex: args.txIndex,
    msgIndex: readNumber(record.msg_index) ?? null,
    eventIndex: args.eventIndex,
    phase: args.phase,
    type,
    attributesJson: attributes,
    module: inferModuleFromEventType(type) ?? null,
    keyFieldsJson: extractKeyFields(attributes),
  };
}

function normalizeAttributes(attributes: unknown): unknown[] {
  return readArray(attributes).map((attribute) => {
    const record = asRecord(attribute);
    const normalized: Record<string, string | boolean> = {
      key: readString(record.key) ?? '',
      value: readString(record.value) ?? '',
    };
    if (typeof record.index === 'boolean') normalized.index = record.index;
    return normalized;
  });
}

function extractKeyFields(attributes: unknown[]): Record<string, string> | null {
  const keyFields: Record<string, string> = {};
  for (const attribute of attributes) {
    const record = asRecord(attribute);
    const key = readString(record.key);
    const value = readString(record.value);
    if (!key || !value) continue;
    if (/(address|operator|signer|sender|recipient|slot_id|epoch|height)$/i.test(key)) {
      keyFields[key] = value;
    }
  }
  return Object.keys(keyFields).length > 0 ? keyFields : null;
}

function inferTypeName(typeUrl: string): string | null {
  const typeName = typeUrlToTypeName(typeUrl);
  if (typeName) return typeName;
  if (typeUrl === 'unknown') return null;
  return typeUrl.split('.').at(-1) ?? null;
}

function getRawTxBase64(source: TxSource): string | undefined {
  if (source.rawTxBase64) return source.rawTxBase64;
  const raw = asRecord(source.raw);
  return readString(raw.raw_tx_base64) ?? readString(raw.rawTxBase64);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBigInt(value: unknown): bigint | null {
  const stringValue = readString(value);
  if (!stringValue) return null;
  try {
    return BigInt(stringValue);
  } catch {
    return null;
  }
}
