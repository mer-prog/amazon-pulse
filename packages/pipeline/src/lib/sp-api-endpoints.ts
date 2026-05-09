/**
 * SP-API region routing.
 *
 * Amazon partitions SP-API into three regional endpoints — every marketplace
 * is served by exactly one of them, and per-operation rate limits are tracked
 * independently per region. Phase 4 adds first-class multi-region awareness so
 * a single sync run can hit multiple EU marketplaces (UK + DE + FR + …)
 * without colliding on a shared rate-limit bucket.
 *
 * Sources (last verified 2026-05):
 *   - SP-API endpoints (regional URLs, marketplace → region):
 *       https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints
 *   - Marketplace IDs (canonical id list):
 *       https://developer-docs.amazon.com/sp-api/docs/marketplace-ids
 *   - Usage Plans and Rate Limits — per-region bucket scoping:
 *       https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits
 *
 * Wave 1 scope: only the EU region is exercised end-to-end. NA + FE constants
 * are declared so future phases can opt in without revisiting this file, but
 * the pipeline's marketplace → region resolver only knows about EU IDs today
 * (unknown marketplace ids throw rather than silently fall back to a region).
 *
 * Sandbox-first: every constant below points at the *sandbox* hostname.
 * Production endpoints live at the same paths under
 * `sellingpartnerapi-{eu,na,fe}.amazon.com` (no `sandbox.` prefix); switching
 * is a deliberate later-phase action and intentionally not wired up here.
 */

export type SpApiRegion = 'eu' | 'na' | 'fe';

/**
 * Sandbox endpoints, keyed by region. These are the URLs the SP-API client
 * sets as its axios `baseURL` once the marketplace_id has been resolved to a
 * region.
 */
export const SP_API_SANDBOX_ENDPOINTS: Readonly<Record<SpApiRegion, string>> = {
  eu: 'https://sandbox.sellingpartnerapi-eu.amazon.com',
  na: 'https://sandbox.sellingpartnerapi-na.amazon.com',
  fe: 'https://sandbox.sellingpartnerapi-fe.amazon.com',
} as const;

/**
 * Production endpoints. Declared for completeness only — Wave 1 never reads
 * from this map. A future phase that flips to production will wire endpoint
 * selection through a `useProduction` boolean rather than mutating this file.
 */
export const SP_API_PRODUCTION_ENDPOINTS: Readonly<Record<SpApiRegion, string>> = {
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  na: 'https://sellingpartnerapi-na.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
} as const;

/**
 * EU-region marketplace ids (14 marketplaces, all served by the EU endpoint).
 *
 * Values are Amazon-issued marketplace ids; both the constant names (country
 * codes) and the values are public. See "Marketplace IDs" doc above.
 */
export const EU_MARKETPLACES = {
  UK: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH',
  IT: 'APJ6JRA9NG5V4',
  ES: 'A1RKKUPIHCS9HS',
  NL: 'A1805IZSGTT6HS',
  BE: 'AMEN7PMS3EDWL',
  IE: 'A28R8C7NBKEWEA',
  SE: 'A2NODRKZP88ZB9',
  PL: 'A1C3SOZRARQ6R3',
  TR: 'A33AVAJ2PDY3EV',
  EG: 'ARBP9OOSHTCHU',
  SA: 'A17E79C6D8DWNP',
  AE: 'A2VIGQ35RCS4UG',
} as const;

/**
 * NA + FE constants. Not used by Wave 1 — listed so a later phase can register
 * them with `marketplaceIdToRegion` without introducing typos.
 *
 * NA: US, CA, MX, BR.
 * FE: JP, AU, SG, IN.
 */
export const NA_MARKETPLACES = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
  BR: 'A2Q3Y263D00KWC',
} as const;

export const FE_MARKETPLACES = {
  JP: 'A1VC38T7YXB528',
  AU: 'A39IBJ37TRP1C6',
  SG: 'A19VAU5U5O7RUS',
  IN: 'A21TJRUUN4KGV',
} as const;

/**
 * Region mapping for every marketplace id we currently support. Wave 1 scope
 * is EU-only: NA/FE entries are intentionally absent so an unknown id throws
 * instead of being silently mis-routed.
 */
const MARKETPLACE_TO_REGION: Readonly<Record<string, SpApiRegion>> = Object.freeze({
  ...Object.fromEntries(Object.values(EU_MARKETPLACES).map((id) => [id, 'eu' as const])),
});

/**
 * Resolve a marketplace id to its SP-API region. Throws on unknown ids — the
 * caller has either typo'd or is asking for an out-of-scope region.
 */
export function regionForMarketplace(marketplaceId: string): SpApiRegion {
  const region = MARKETPLACE_TO_REGION[marketplaceId];
  if (!region) {
    throw new Error(
      `Unknown SP-API marketplace id: ${marketplaceId}. ` +
        `Known EU ids: ${Object.values(EU_MARKETPLACES).join(', ')}.`,
    );
  }
  return region;
}

export interface EndpointResolveOptions {
  /** Use production endpoints. Defaults to false (sandbox). */
  readonly production?: boolean;
}

/**
 * Resolve a marketplace id to its full HTTPS endpoint URL. Sandbox-first: the
 * `production` flag must be set explicitly.
 */
export function endpointForMarketplace(
  marketplaceId: string,
  opts: EndpointResolveOptions = {},
): string {
  const region = regionForMarketplace(marketplaceId);
  const map = opts.production ? SP_API_PRODUCTION_ENDPOINTS : SP_API_SANDBOX_ENDPOINTS;
  return map[region];
}

/**
 * Partition a list of marketplace ids by SP-API region. Used by the
 * multi-marketplace orchestrator: one SpApiClient per region (so the
 * `<operation>:<region>` rate-limit buckets stay separate), iterating the
 * marketplaces inside each region group sequentially.
 *
 * Order within each region preserves caller order so logs read predictably.
 */
export function groupMarketplacesByRegion(
  marketplaceIds: readonly string[],
): Map<SpApiRegion, string[]> {
  const out = new Map<SpApiRegion, string[]>();
  for (const id of marketplaceIds) {
    const region = regionForMarketplace(id);
    const existing = out.get(region);
    if (existing) {
      existing.push(id);
    } else {
      out.set(region, [id]);
    }
  }
  return out;
}
