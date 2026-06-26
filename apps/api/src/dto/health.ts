import { Type } from '@sinclair/typebox';

export const HealthLiveResponse = Type.Object(
  { data: Type.Object({ status: Type.Literal('live') }) },
  { $id: 'HealthLiveResponse' },
);

// On readiness the body is the data envelope; on failure the route returns the standard error
// envelope (503 not_ready) with the failing checks in details (lock #6).
export const HealthReadyResponse = Type.Object(
  {
    data: Type.Object({
      status: Type.Literal('ready'),
      checks: Type.Object({
        database: Type.Literal('ok'),
        migrations: Type.Literal('ok'),
      }),
    }),
  },
  { $id: 'HealthReadyResponse' },
);
