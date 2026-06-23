# Twilight Core Explorer Theme Audit

Date: 2026-06-23

## Verdict

Use the reference explorer's visual language, but not its product content. The valuable direction is a dark Twilight dashboard with purple/fuchsia accents, dense crypto-operator tables, monospace hashes, compact cards, status badges, and high-contrast data surfaces. The reference currently contains both a purple `legacy` theme and a gold `auction` theme. For Twilight Core, adapt the dark purple/fuchsia direction and rewrite the active information architecture around CoreSlot and rewards.

## Source Files Inspected

- `reference/twilight-explorer/packages/web/src/app/globals.css`
- `reference/twilight-explorer/packages/web/tailwind.config.js`
- `reference/twilight-explorer/packages/web/src/app/layout.tsx`
- `reference/twilight-explorer/packages/web/src/components/Header.tsx`
- `reference/twilight-explorer/packages/web/src/components/StatsCard.tsx`
- `reference/twilight-explorer/packages/web/src/components/SearchBar.tsx`
- `reference/twilight-explorer/packages/web/src/components/Loading.tsx`
- `reference/twilight-explorer/packages/web/src/components/BlockCard.tsx`
- `reference/twilight-explorer/packages/web/src/components/TxCard.tsx`
- `reference/twilight-explorer/packages/web/src/app/page.tsx`

## CSS Framework and Libraries

| Area | Reference choice | Recommendation |
|---|---|---|
| Framework | Tailwind CSS 3.4 with CSS variable-backed theme tokens | Keep Tailwind for MVP. It is already clean enough and fast for data-heavy explorer screens. |
| UI component library | No heavy component library; mostly custom components with lucide icons | Keep. Avoid a large component library unless accessibility gaps appear. |
| Fonts | Next font: Inter, Instrument Serif, Roboto Mono | Keep Inter and Roboto Mono. Use Instrument Serif sparingly or remove if it makes operator pages feel too editorial. |
| Data fetching | TanStack React Query | Keep for client-side API screens and polling. |
| Charts | Recharts | Keep optional; use for rewards/supply/block-time charts later, not MVP-critical. |
| Icons | lucide-react | Keep. |

## Theme Tokens to Reuse or Adapt

Recommended Twilight Core token set, adapted from `data-theme='legacy'`:

| Token | Recommended value/source | Notes |
|---|---|---|
| `background` | `rgb(17 19 31)` | Deep navy/purple page background. |
| `background-secondary` | `rgb(26 29 46)` | Main panels and table backgrounds. |
| `background-tertiary` | `rgb(36 40 59)` | Hover states, input fills, table headers. |
| `surface/card` | `rgb(26 29 46)` | Keep compact surfaces; avoid large nested cards. |
| `surface-hover` | `rgb(36 40 59)` | Subtle hover for rows/cards. |
| `border` | `rgb(51 65 85)` | Slate border; reduce opacity on dense tables. |
| `accent/primary` | `rgb(124 58 237)` | Purple base. |
| `accent/primary-light` | `rgb(167 139 250)` | Fuchsia/purple highlight for links, icons, active nav. |
| `accent/primary-dark` | `rgb(91 33 182)` | Pressed/selected states. |
| `text-primary` | `rgb(255 255 255)` | High-contrast headings and values. |
| `text-secondary` | `rgb(148 163 184)` | Labels, metadata, table secondary cells. |
| `text-muted` | `rgb(100 116 139)` | Placeholders, less important hashes. |
| `success` | `rgb(34 197 94)` | Successful tx, active slot, claim paid. |
| `warning` | `rgb(234 179 8)` | Pending slot, queued params, indexer lag. |
| `error` | `rgb(239 68 68)` | Failed tx, suspended/removed warning, failed decoder. |
| `info` | `rgb(59 130 246)` | Generic info, blocks, node status. |
| `mono/hash` | Roboto Mono/SFMono fallback | Use for block heights, tx hashes, addresses, amounts. |

Tokens to avoid as the default:

- Gold `auction` primary (`#E89E28`) as the main identity, unless the product intentionally chooses that theme later.
- Large decorative gradients or gold hero styling from the auction variant.
- Old BTC/sats-oriented color coding.

## Layout and Spacing Observations

| Element | Reference pattern | Recommendation |
|---|---|---|
| Page width | Fixed `1432px` desktop shell with generous side padding | Keep a constrained shell, but reduce giant desktop side padding for dense explorer screens if needed. |
| Header | Sticky translucent dark nav, logo, grouped dropdowns, search modal | Keep mechanics; rebuild nav items. |
| Cards | `rounded-[10.5px]`, border, shadow, compact padding | Keep, but standardize to radius 8-10px. Avoid nested cards. |
| Tables | Full-width, compact rows, uppercase headers, hover row states | Keep and expand for block/tx/account/CoreSlot/rewards tables. |
| Badges | Rounded pills and small monospace rectangular badges | Keep. Add semantic variants for CoreSlot status and rewards state. |
| Hash formatting | Mono text with truncation and hover accent | Keep. Add copy buttons/tooltips in implementation. |
| Loading states | Skeleton tables/cards plus spinner | Keep. |
| Empty/error states | Present but not consistently specialized | Rewrite with explorer-specific errors: indexer lag, route unavailable, decode unknown. |

## Components to Reuse or Adapt

| Component | Decision | Changes needed |
|---|---|---|
| `StatsCard` | Reuse/adapt | Remove `bg-gradient-hero` dependency if undefined or replace with tokenized accent wash. Use for latest height, TPS, active CoreSlots, current epoch, cumulative emitted, supply. |
| `SearchBar` | Reuse/adapt | Keep height/hash/address detection. Add optional CoreSlot slot id/operator/consensus address search in API search response. |
| `Loading`, `LoadingCard`, `LoadingTable` | Reuse | Make table skeleton column count configurable. |
| `BlockCard` | Reuse/adapt | Replace proposer enrichment with CoreSlot/proposer address display; keep compact mobile card. |
| `TxCard` | Rewrite lightly | Replace old module classifier with `rewards`, `coreslot`, `bank`, `auth`, `unknown`. |
| `Header` shell | Adapt | Rebuild nav and remove Bitcoin/Security groups. |
| `Pagination` | Reuse/adapt | Keep if simple and accessible. |
| `Tooltip` | Reuse | Useful for CoreSlot/rewards explanations without overloading pages. |
| Table CSS classes | Reuse | Add sticky headers later for wide tables. |

## Components and Pages to Delete or Rewrite

| Component/page | Decision | Reason |
|---|---|---|
| `/deposits`, `/withdrawals` | Delete | BTC bridge is not current target. |
| `/fragments` | Delete | Volt/fragments are old product. |
| `/scripts` | Delete or archive | Old zkOS-specific content. |
| `/validators` | Rewrite as `/coreslot` | Standard validators page misrepresents CoreSlot PoA. |
| `ZkosTransactionViewer` | Delete from active UI | zkOS decode API is obsolete. |
| Dashboard BTC/fragment/zkOS metrics | Rewrite | Use CoreSlot/rewards/network metrics. |
| Old `Header` nav groups | Rewrite | Current IA is different. |

## Dark/Light Mode Behavior

The reference is effectively dark-first. It has theme switching via `data-theme`, but no user-facing light mode was observed. For production MVP:

- Ship dark-only first.
- Keep CSS variable tokens so a future light/high-contrast mode is possible.
- Default to Twilight Core dark purple/fuchsia, not `auction`.

## Proposed Twilight Core Information Architecture

Primary navigation:

1. Dashboard
2. Blocks
3. Transactions
4. Accounts
5. CoreSlot
6. Rewards
7. Claims
8. Supply
9. Network
10. API Status

Suggested page responsibilities:

| Page | Primary content |
|---|---|
| Dashboard | Latest height, chain id, indexer lag, latest blocks/txs, active CoreSlots, current epoch, cumulative emitted, total `utwlt` supply. |
| Blocks | Paginated blocks, height, time, tx count, app hash, proposer consensus address/CoreSlot mapping if known. |
| Block detail | Header hashes, proposer, tx list, begin/end/block events, raw JSON drawer. |
| Transactions | Paginated txs with module/type/status/gas/height/time. |
| Transaction detail | Messages, events, fee, signers, decode status, raw tx/result JSON. |
| Accounts | Account lookup, `utwlt` balances, seen txs, CoreSlot/reward relationships if any. |
| CoreSlot | Slot list, active/suspended/removed/pending filters, operator/payout/consensus, reward weight, lifecycle timeline. |
| CoreSlot detail | Slot state, metadata, consensus key, payout, reward weight, lifecycle events, associated claims. |
| Rewards | Current epoch, epoch length/end height, finalized epochs, emitted amounts, active-block accounting, params/pause state. |
| Claims | Claim records by slot/epoch/payout address, claimed state, claim tx links from indexer. |
| Supply | Total `utwlt`, `TWLT` display conversion, cumulative emitted, module balances, supply schedule. |
| Network | Node info, CometBFT status, block time, peer/node metadata if exposed, API/RPC health. |
| API Status | Explorer API health, indexer cursor, decode failures, endpoint availability. |

## Visual Treatment by Domain

| Domain | Visual treatment |
|---|---|
| CoreSlot active | Green status pill, purple identity accents, consensus address mono. |
| CoreSlot pending/inactive | Blue or muted pill. |
| CoreSlot suspended/removed | Warning/error status with clear lifecycle context, not validator slashing language. |
| Rewards current epoch | Purple primary card with progress bar by height, not time-only. |
| Finalized epochs | Compact table with emission amount, allocated amount, carry, eligible slots. |
| Claims | Status badges: claimable, claimed, zero, disabled. |
| Unknown messages/events | Neutral warning treatment; never imply indexer failure by default. |

## Theme Implementation Boundary

Recommended approach: adapt old theme tokens/components where clean, rewrite pages and IA for Twilight Core.

Implementation notes:

- Create `packages/ui` only if multiple apps need shared UI soon; otherwise keep web-local components until the API/indexer are stable.
- Copy CSS variables intentionally into the new repo rather than importing the old app wholesale.
- Keep Tailwind and lucide.
- Remove old asset dependencies if they reference old product visuals. Logo can be reused if brand-current.
- Use real data-first pages, not a marketing landing page.
