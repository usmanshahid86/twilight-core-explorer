import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

// Clear "coming in Phase X" surface for routes whose full page lands in a later slice. Keeps nav
// wired and the shell proven without shipping broken/empty pages.
export function PlaceholderPage({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-3xl text-text">{title}</h1>
        <Badge tone="info">Phase {phase}</Badge>
      </div>
      <Card>
        <CardBody className="space-y-3 py-8 text-center">
          <p className="text-text-secondary">{description}</p>
          <p className="text-sm text-text-muted">
            This section arrives in Phase {phase}. The Phase 9 API already serves its data.
          </p>
          <Link href="/" className="inline-block text-primary hover:text-primary-light">
            ← Back to overview
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
