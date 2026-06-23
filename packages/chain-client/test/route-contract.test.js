import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_SLOT_REST_ROUTES,
  REQUIRED_TWILIGHT_REST_ROUTES,
  REWARDS_REST_ROUTES,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const swaggerPath = join(repoRoot, 'app/openapi/twilight.swagger.json');
const restRoutesPath = join(repoRoot, 'docs/reference/rest-routes.md');

const swagger = JSON.parse(readFileSync(swaggerPath, 'utf8'));
const restRoutes = readFileSync(restRoutesPath, 'utf8');
const paths = new Set(Object.keys(swagger.paths ?? {}));

const rewardsRoutes = [
  '/twilight/rewards/v1/params',
  '/twilight/rewards/v1/epoch-info',
  '/twilight/rewards/v1/next-halving',
  '/twilight/rewards/v1/epochs/{epoch_number}',
  '/twilight/rewards/v1/slots/{slot_id}/rewards',
  '/twilight/rewards/v1/slots/{slot_id}/claimable',
  '/twilight/rewards/v1/cumulative-emitted',
  '/twilight/rewards/v1/supply-schedule',
  '/twilight/rewards/v1/current-epoch/active-blocks',
  '/twilight/rewards/v1/module-balances',
];

const coreSlotRoutes = [
  '/twilight/coreslot/v1/params',
  '/twilight/coreslot/v1/slots/{slot_id}',
  '/twilight/coreslot/v1/slots',
  '/twilight/coreslot/v1/active-slots',
  '/twilight/coreslot/v1/operators/{operator_address}',
  '/twilight/coreslot/v1/consensus/{consensus_address}',
  '/twilight/coreslot/v1/pending-key-rotations',
  '/twilight/coreslot/v1/last-applied-validators',
  '/twilight/coreslot/v1/reserved-consensus-address/{consensus_address}',
  '/twilight/coreslot/v1/slots/{slot_id}/reward-weight',
];

const forbiddenStandardModulePatterns = [
  /\/cosmos\/staking\//,
  /\/cosmos\/gov\//,
  /\/cosmos\/mint\//,
  /\/cosmos\/distribution\//,
];

const ignoredDirs = new Set([
  '.git',
  '.agents',
  '.codex',
  'node_modules',
  'reference',
]);

const ignoredFiles = new Set([
  'docs/reference/rest-routes.md',
  'docs/research/explorer-old-repo-audit.md',
]);

function assertRoutesPresent(expectedRoutes) {
  for (const route of expectedRoutes) {
    assert.equal(paths.has(route), true, `missing route in Swagger contract: ${route}`);
    assert.match(restRoutes, new RegExp(escapeRegExp(route)), `missing route in rest-routes.md: ${route}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(fullPath, files);
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Twilight REST route contract', () => {
  it('imports the current Swagger route inventory', () => {
    assert.equal(swagger.swagger, '2.0');
    assert.equal(paths.size, 61);
  });

  it('contains all 10 x/rewards query routes', () => {
    assertRoutesPresent(rewardsRoutes);
    assert.deepEqual(Object.values(REWARDS_REST_ROUTES).sort(), [...rewardsRoutes].sort());
  });

  it('contains all 10 x/coreslot query routes', () => {
    assertRoutesPresent(coreSlotRoutes);
    assert.deepEqual(Object.values(CORE_SLOT_REST_ROUTES).sort(), [...coreSlotRoutes].sort());
  });

  it('uses the validated active slots route', () => {
    const legacyActiveSlotsRoute = `/twilight/coreslot/v1/slots/${'active'}`;
    assert.equal(paths.has('/twilight/coreslot/v1/active-slots'), true);
    assert.equal(paths.has(legacyActiveSlotsRoute), false);
    assert.equal(CORE_SLOT_REST_ROUTES.activeSlots, '/twilight/coreslot/v1/active-slots');
    assert.equal(Object.values(CORE_SLOT_REST_ROUTES).includes(legacyActiveSlotsRoute), false);
    assert.match(restRoutes, /\/twilight\/coreslot\/v1\/active-slots/);
    assert.doesNotMatch(restRoutes, /\|\s*`\/twilight\/coreslot\/v1\/slots\/active`\s*\|/);
  });

  it('keeps route constants aligned with the imported route contract', () => {
    assert.equal(REQUIRED_TWILIGHT_REST_ROUTES.length, 20);
    for (const route of REQUIRED_TWILIGHT_REST_ROUTES) {
      assert.equal(paths.has(route), true, `route constant missing from Swagger: ${route}`);
      assert.match(restRoutes, new RegExp(escapeRegExp(route)));
    }
  });

  it('does not expose unsupported standard module routes in Swagger', () => {
    for (const route of paths) {
      for (const pattern of forbiddenStandardModulePatterns) {
        assert.doesNotMatch(route, pattern, `unsupported route exposed in Swagger: ${route}`);
      }
    }
  });

  it('keeps unsupported standard module paths out of implementation files', () => {
    const offenders = [];
    for (const file of walkFiles(repoRoot)) {
      const rel = relative(repoRoot, file);
      if (ignoredFiles.has(rel)) continue;
      if (rel === 'app/openapi/twilight.swagger.json') continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbiddenStandardModulePatterns) {
        if (pattern.test(text)) offenders.push(rel);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
