import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';

export default function NotFound() {
  return (
    <Card>
      <CardBody className="space-y-3 py-12 text-center">
        <h1 className="font-serif text-3xl text-text">404 — not found</h1>
        <p className="text-sm text-text-muted">That page does not exist in the explorer.</p>
        <Link href="/" className="inline-block text-primary hover:text-primary-light">
          ← Back to overview
        </Link>
      </CardBody>
    </Card>
  );
}
