import { describe, it, expect } from 'vitest';
import {
  EU_MARKETPLACES,
  NA_MARKETPLACES,
  FE_MARKETPLACES,
  SP_API_SANDBOX_ENDPOINTS,
  SP_API_PRODUCTION_ENDPOINTS,
  endpointForMarketplace,
  groupMarketplacesByRegion,
  regionForMarketplace,
} from '../../src/lib/sp-api-endpoints.js';

describe('regionForMarketplace', () => {
  it('returns "eu" for every EU marketplace id', () => {
    for (const id of Object.values(EU_MARKETPLACES)) {
      expect(regionForMarketplace(id)).toBe('eu');
    }
  });

  it('throws for unknown marketplace ids (NA / FE / nonsense)', () => {
    // NA + FE are declared as constants but intentionally not registered with
    // the resolver in Wave 1 — we want loud failure if a worker accidentally
    // routes outside the EU region.
    expect(() => regionForMarketplace(NA_MARKETPLACES.US)).toThrow(/Unknown SP-API marketplace/);
    expect(() => regionForMarketplace(FE_MARKETPLACES.JP)).toThrow(/Unknown SP-API marketplace/);
    expect(() => regionForMarketplace('NOT_A_REAL_ID')).toThrow(/Unknown SP-API marketplace/);
  });

  it('error message includes the offending id and the EU id list', () => {
    let captured: Error | null = null;
    try {
      regionForMarketplace('OOPS');
    } catch (e) {
      captured = e as Error;
    }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain('OOPS');
    expect(captured!.message).toContain(EU_MARKETPLACES.UK);
  });
});

describe('endpointForMarketplace', () => {
  it('defaults to the sandbox endpoint for the resolved region', () => {
    expect(endpointForMarketplace(EU_MARKETPLACES.UK)).toBe(SP_API_SANDBOX_ENDPOINTS.eu);
    expect(endpointForMarketplace(EU_MARKETPLACES.DE)).toBe(SP_API_SANDBOX_ENDPOINTS.eu);
    expect(endpointForMarketplace(EU_MARKETPLACES.FR)).toBe(SP_API_SANDBOX_ENDPOINTS.eu);
  });

  it('returns the production endpoint when production:true is requested', () => {
    expect(endpointForMarketplace(EU_MARKETPLACES.UK, { production: true })).toBe(
      SP_API_PRODUCTION_ENDPOINTS.eu,
    );
  });

  it('sandbox endpoint URL is the one this phase is allowed to call', () => {
    // Hard-coded so a rename in the constants table doesn't silently flip the
    // pipeline off the sandbox host (would violate the Phase 4 寸止め原則).
    expect(SP_API_SANDBOX_ENDPOINTS.eu).toBe('https://sandbox.sellingpartnerapi-eu.amazon.com');
  });
});

describe('groupMarketplacesByRegion', () => {
  it('partitions ids by region, preserving caller order within each group', () => {
    const result = groupMarketplacesByRegion([
      EU_MARKETPLACES.UK,
      EU_MARKETPLACES.DE,
      EU_MARKETPLACES.FR,
    ]);
    expect(result.size).toBe(1);
    expect(result.get('eu')).toEqual([
      EU_MARKETPLACES.UK,
      EU_MARKETPLACES.DE,
      EU_MARKETPLACES.FR,
    ]);
  });

  it('returns an empty map for an empty input list', () => {
    expect(groupMarketplacesByRegion([]).size).toBe(0);
  });

  it('throws when an unknown id is in the batch (no silent skip)', () => {
    expect(() =>
      groupMarketplacesByRegion([EU_MARKETPLACES.UK, 'BOGUS_ID']),
    ).toThrow(/Unknown SP-API marketplace/);
  });
});
