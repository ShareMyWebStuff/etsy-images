'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Listing = {
  id: number;
  title: string;
  price: number | null;
  shopName: string | null;
};

type ListingMode = 'active' | 'draft';
type EtsyToolMode = 'shops' | 'shop-sections';
type LoadingMode = ListingMode | EtsyToolMode;

type ListingsClientProps = {
  showEtsyTools?: boolean;
  showJsonResponse?: boolean;
};

export function ListingsClient({ showEtsyTools = false, showJsonResponse = false }: ListingsClientProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMode, setLoadingMode] = useState<LoadingMode | null>(null);
  const [jsonResponse, setJsonResponse] = useState<unknown>(null);

  async function loadListings(mode: ListingMode) {
    setError(null);
    setLoadingMode(mode);

    try {
      const response = await fetch(`/api/listings?refresh=1&state=${mode}`);
      const payload = (await response.json()) as { listings?: Listing[]; error?: string };
      if (showJsonResponse) {
        setJsonResponse(payload);
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to load Etsy listings.');
      }

      setListings(payload.listings ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load Etsy listings.');
    } finally {
      setLoadingMode(null);
    }
  }

  async function loadEtsyTool(mode: EtsyToolMode) {
    setError(null);
    setLoadingMode(mode);

    try {
      const endpoint = mode === 'shops' ? '/api/etsy/shops' : '/api/etsy/shop-sections';
      const response = await fetch(endpoint);
      const payload = (await response.json()) as { error?: string };
      if (showJsonResponse) {
        setJsonResponse(payload);
      }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to load Etsy data.');
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load Etsy data.');
    } finally {
      setLoadingMode(null);
    }
  }

  return (
    <Card>
      <CardHeader className="listings-header pb-4">
        <CardTitle>Listings</CardTitle>
        <div className="actions">
          <Button type="button" onClick={() => loadListings('active')} disabled={loadingMode !== null}>
            {loadingMode === 'active' ? 'Loading...' : 'Load Active Listings'}
          </Button>
          <Button type="button" onClick={() => loadListings('draft')} disabled={loadingMode !== null}>
            {loadingMode === 'draft' ? 'Loading...' : 'Load Draft Listings'}
          </Button>
          {showEtsyTools ? (
            <>
              <Button type="button" variant="secondary" onClick={() => loadEtsyTool('shops')} disabled={loadingMode !== null}>
                {loadingMode === 'shops' ? 'Loading...' : 'Get Shops'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => loadEtsyTool('shop-sections')}
                disabled={loadingMode !== null}
              >
                {loadingMode === 'shop-sections' ? 'Loading...' : 'Get Shop Sections'}
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {error ? <p className="error">{error}</p> : null}

        {listings.length > 0 ? (
          <ul className="listing-list">
            {listings.map((listing) => (
              <li key={listing.id} className="listing-row">
                <span>{listing.title}</span>
                <span>{listing.price === null ? 'No price' : listing.price.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No listings loaded.</p>
        )}

        {showJsonResponse && jsonResponse ? (
          <div className="json-panel">
            <h2>Returned JSON</h2>
            <pre>{JSON.stringify(jsonResponse, null, 2)}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
