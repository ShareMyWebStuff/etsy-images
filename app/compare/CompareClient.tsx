'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CompareRow, EtsyListingComparison } from '@/lib/etsy-compare';

const FIRST_LISTING_ID = '4541292006';
const SECOND_LISTING_ID = '4534029059';

function rowColour(matches: boolean) {
  return matches ? 'bg-green-50 hover:bg-green-100' : 'bg-red-50 hover:bg-red-100';
}

function ComparisonTable({ title, rows, firstId, secondId }: { title: string; rows: CompareRow[]; firstId: string; secondId: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>{firstId}</TableHead><TableHead>{secondId}</TableHead><TableHead>Match</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((row) => (
            <TableRow key={row.field} className={rowColour(row.matches)}>
              <TableCell className="font-medium">{row.field}</TableCell><TableCell className="max-w-md whitespace-pre-wrap break-words">{row.first}</TableCell><TableCell className="max-w-md whitespace-pre-wrap break-words">{row.second}</TableCell><TableCell>{row.matches ? 'Yes' : 'No'}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function CompareClient() {
  const [firstId, setFirstId] = useState(FIRST_LISTING_ID);
  const [secondId, setSecondId] = useState(SECOND_LISTING_ID);
  const [data, setData] = useState<EtsyListingComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getComparison() {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/etsy/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstId, secondId }) });
      const payload = (await response.json()) as { data?: EtsyListingComparison; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Unable to compare Etsy listings.');
      setData(payload.data);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to compare Etsy listings.');
    } finally { setLoading(false); }
  }

  return <div className="grid gap-6">
    <div><h1 className="text-2xl font-semibold">Compare Etsy Listings</h1><p className="mt-2 text-muted-foreground">Compare listing setup, properties, image contents, and download metadata.</p></div>
    <Card><CardContent className="grid gap-4 pt-6 md:grid-cols-[1fr_1fr_auto]">
      <Input value={firstId} onChange={(event) => setFirstId(event.target.value)} aria-label="First Etsy listing ID" />
      <Input value={secondId} onChange={(event) => setSecondId(event.target.value)} aria-label="Second Etsy listing ID" />
      <Button onClick={getComparison} disabled={loading}>{loading ? 'Getting...' : 'Get'}</Button>
    </CardContent></Card>
    {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
    {data ? <>
      <ComparisonTable title="Listing Setup" rows={data.setup} firstId={data.firstId} secondId={data.secondId} />
      <ComparisonTable title="Properties" rows={data.properties} firstId={data.firstId} secondId={data.secondId} />
      <Card><CardHeader><CardTitle>Images</CardTitle></CardHeader><CardContent><Table>
        <TableHeader><TableRow><TableHead>Position</TableHead><TableHead>{data.firstId}</TableHead><TableHead>{data.secondId}</TableHead><TableHead>Same content</TableHead></TableRow></TableHeader>
        <TableBody>{data.images.map((row) => <TableRow key={row.position} className={rowColour(row.matches)}><TableCell>{row.position}</TableCell><TableCell>{row.firstUrl ? <img src={row.firstUrl} alt={`Listing ${data.firstId} image ${row.position}`} className="mb-2 h-24 w-24 rounded object-cover" /> : null}{row.first}</TableCell><TableCell>{row.secondUrl ? <img src={row.secondUrl} alt={`Listing ${data.secondId} image ${row.position}`} className="mb-2 h-24 w-24 rounded object-cover" /> : null}{row.second}</TableCell><TableCell>{row.matches ? 'Yes' : 'No'}</TableCell></TableRow>)}</TableBody>
      </Table></CardContent></Card>
      <Card><CardHeader><CardTitle>Download Files</CardTitle></CardHeader><CardContent><Table>
        <TableHeader><TableRow><TableHead>Position</TableHead><TableHead>{data.firstId}</TableHead><TableHead>{data.secondId}</TableHead><TableHead>Match</TableHead></TableRow></TableHeader>
        <TableBody>{data.downloads.map((row) => <TableRow key={row.position} className={rowColour(row.matches)}><TableCell>{row.position}</TableCell><TableCell>{row.first}</TableCell><TableCell>{row.second}</TableCell><TableCell>{row.matches ? 'Yes' : 'No'}</TableCell></TableRow>)}</TableBody>
      </Table><p className="mt-3 text-sm text-muted-foreground">Etsy exposes download filenames, order, and sizes, but not the downloadable file contents.</p></CardContent></Card>
    </> : null}
  </div>;
}
