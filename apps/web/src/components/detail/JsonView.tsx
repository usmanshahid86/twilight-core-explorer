// Renders unknown JSON (decodedJson, event attributes, fee, raw payloads) WITHOUT assuming its shape.
// Strings render verbatim; everything else is pretty-printed. Circular/throwing values degrade safely.
export function JsonView({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-text-muted">—</span>;
  }
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="overflow-x-auto rounded-lg border border-card-border bg-background-secondary p-3 text-xs text-text-secondary">
      {text}
    </pre>
  );
}
