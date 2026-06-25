import type protobuf from 'protobufjs';
import { getTwilightProtoRoot, lookupMessageByTypeUrl } from './protobuf-root.js';
import { toJsonSafe } from './json.js';
import {
  normalizeTypeUrl,
  typeUrlToLookupName,
  typeUrlToModule,
  typeUrlToTypeName,
} from './type-url.js';

export interface DecodedTxMessage {
  index: number;
  typeUrl: string;
  lookupName: string;
  module?: string;
  typeName?: string;
  decodedJson?: unknown;
  rawValueBase64: string;
  decodeError?: string;
}

export interface DecoderFailure {
  failureKind:
    | 'tx_raw_decode'
    | 'tx_body_decode'
    | 'auth_info_decode'
    | 'any_type_lookup'
    | 'any_value_decode';
  msgIndex?: number;
  typeUrl?: string;
  rawBase64?: string;
  decodeError: string;
}

export interface DecodedRawTx {
  body?: unknown;
  authInfo?: unknown;
  signaturesBase64: string[];
  messages: DecodedTxMessage[];
  decodeError?: string;
  failures: DecoderFailure[];
}

export function decodeRawTxBase64(rawTxBase64: string): DecodedRawTx {
  try {
    return decodeRawTxBytes(Buffer.from(rawTxBase64, 'base64'));
  } catch (error) {
    return {
      signaturesBase64: [],
      messages: [],
      decodeError: errorToString(error),
      failures: [{
        failureKind: 'tx_raw_decode',
        rawBase64: rawTxBase64,
        decodeError: errorToString(error),
      }],
    };
  }
}

export function decodeRawTxBytes(rawTxBytes: Uint8Array): DecodedRawTx {
  const root = getTwilightProtoRoot();
  const txRawType = root.lookupType('cosmos.tx.v1beta1.TxRaw');
  const txBodyType = root.lookupType('cosmos.tx.v1beta1.TxBody');
  const authInfoType = root.lookupType('cosmos.tx.v1beta1.AuthInfo');
  const failures: DecoderFailure[] = [];

  let txRaw: protobuf.Message<Record<string, unknown>>;
  try {
    txRaw = txRawType.decode(rawTxBytes) as protobuf.Message<Record<string, unknown>>;
  } catch (error) {
    return {
      signaturesBase64: [],
      messages: [],
      decodeError: errorToString(error),
      failures: [{
        failureKind: 'tx_raw_decode',
        rawBase64: Buffer.from(rawTxBytes).toString('base64'),
        decodeError: errorToString(error),
      }],
    };
  }

  const txRawRecord = txRaw as unknown as Record<string, unknown>;
  const bodyBytes = readBytes(txRawRecord.bodyBytes) ?? readBytes(txRawRecord.body_bytes);
  const authInfoBytes =
    readBytes(txRawRecord.authInfoBytes) ?? readBytes(txRawRecord.auth_info_bytes);
  const signatures = readRepeatedBytes(txRawRecord.signatures)
    .map((signature) => Buffer.from(signature).toString('base64'));

  let body: protobuf.Message<Record<string, unknown>> | undefined;
  let bodyJson: unknown;
  if (bodyBytes) {
    try {
      body = txBodyType.decode(bodyBytes) as protobuf.Message<Record<string, unknown>>;
      bodyJson = toJsonObject(txBodyType, body);
    } catch (error) {
      failures.push({
        failureKind: 'tx_body_decode',
        rawBase64: Buffer.from(bodyBytes).toString('base64'),
        decodeError: errorToString(error),
      });
    }
  }

  let authInfoJson: unknown;
  if (authInfoBytes) {
    try {
      const authInfo = authInfoType.decode(authInfoBytes);
      authInfoJson = toJsonObject(authInfoType, authInfo);
    } catch (error) {
      failures.push({
        failureKind: 'auth_info_decode',
        rawBase64: Buffer.from(authInfoBytes).toString('base64'),
        decodeError: errorToString(error),
      });
    }
  }

  const messages = body ? decodeAnyMessages(body, failures) : [];
  const decoded: DecodedRawTx = {
    signaturesBase64: signatures,
    messages,
    failures,
  };
  if (bodyJson !== undefined) decoded.body = bodyJson;
  if (authInfoJson !== undefined) decoded.authInfo = authInfoJson;
  if (failures[0]?.decodeError) decoded.decodeError = failures[0].decodeError;
  return decoded;
}

function decodeAnyMessages(
  body: protobuf.Message<Record<string, unknown>>,
  failures: DecoderFailure[],
): DecodedTxMessage[] {
  const bodyRecord = body as unknown as Record<string, unknown>;
  const anyMessages = readArray(bodyRecord.messages);

  return anyMessages.map((message, index) => {
    const anyRecord = asRecord(message);
    const rawTypeUrl = readString(anyRecord.typeUrl) ?? readString(anyRecord.type_url) ?? '';
    const typeUrl = normalizeTypeUrl(rawTypeUrl);
    const lookupName = typeUrlToLookupName(typeUrl);
    const rawValue = readBytes(anyRecord.value) ?? new Uint8Array();
    const rawValueBase64 = Buffer.from(rawValue).toString('base64');
    const base: DecodedTxMessage = {
      index,
      typeUrl,
      lookupName,
      rawValueBase64,
    };
    const module = typeUrlToModule(typeUrl);
    const typeName = typeUrlToTypeName(typeUrl);
    if (module) base.module = module;
    if (typeName) base.typeName = typeName;

    const messageType = lookupMessageByTypeUrl(typeUrl);
    if (!messageType) {
      const decodeError = `Unknown protobuf type URL: ${typeUrl || rawTypeUrl || 'unknown'}`;
      failures.push({
        failureKind: 'any_type_lookup',
        msgIndex: index,
        typeUrl,
        rawBase64: rawValueBase64,
        decodeError,
      });
      return { ...base, decodeError };
    }

    try {
      const decoded = messageType.decode(rawValue);
      return { ...base, decodedJson: toJsonObject(messageType, decoded) };
    } catch (error) {
      const decodeError = errorToString(error);
      failures.push({
        failureKind: 'any_value_decode',
        msgIndex: index,
        typeUrl,
        rawBase64: rawValueBase64,
        decodeError,
      });
      return { ...base, decodeError };
    }
  });
}

function toJsonObject(type: protobuf.Type, message: protobuf.Message): unknown {
  return toJsonSafe(type.toObject(message, {
    bytes: String,
    defaults: false,
    enums: String,
    longs: String,
    arrays: true,
    objects: true,
  }));
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRepeatedBytes(value: unknown): Uint8Array[] {
  return readArray(value).map(readBytes).filter((item): item is Uint8Array => Boolean(item));
}

function readBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return value;
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
