import protobuf from 'protobufjs';
import descriptor from 'protobufjs/ext/descriptor/index.js';
import { getDescriptorBytes } from '@twilight-explorer/proto';
import { typeUrlToLookupName } from './type-url.js';

let cachedRoot: protobuf.Root | undefined;

export function getTwilightProtoRoot(): protobuf.Root {
  if (!cachedRoot) {
    const descriptorSet = descriptor.FileDescriptorSet.decode(getDescriptorBytes());
    const rootFactory = protobuf.Root as unknown as {
      fromDescriptor(value: unknown): protobuf.Root;
    };
    cachedRoot = rootFactory.fromDescriptor(descriptorSet);
  }
  return cachedRoot;
}

export function lookupMessageByTypeUrl(typeUrl: string): protobuf.Type | undefined {
  const lookupName = typeUrlToLookupName(typeUrl);
  if (!lookupName) return undefined;
  const found = getTwilightProtoRoot().lookup(lookupName);
  return found instanceof protobuf.Type ? found : undefined;
}
