'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

// Copy a full (often truncated-in-display) value to the clipboard, with a transient "copied" state.
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — fail silently; the value is still visible.
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? 'Copied' : `Copy ${label ?? 'value'}`}
      title={copied ? 'Copied' : 'Copy'}
      className="inline-flex items-center text-text-muted hover:text-primary"
    >
      {copied ? <Check size={14} className="text-accent-green" /> : <Copy size={14} />}
    </button>
  );
}
