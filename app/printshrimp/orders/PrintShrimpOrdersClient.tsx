'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ISO_COUNTRY_CODES } from '@/lib/iso-country-codes';
import {
  PRINTSHRIMP_CUSTOM_FONTS,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';
import type {
  PrintShrimpOrder,
  PrintShrimpOrderPreviewInput,
  PrintShrimpOrdersPageData,
} from '@/lib/printshrimp/orders';

type Tab = 'create' | 'list';

const inputGridClass = 'grid gap-2';

function Field({ label, value, onChange, type = 'text', maxLength }: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  maxLength?: number;
}) {
  const id = useId();
  return <div className={inputGridClass}>
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type={type} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
  </div>;
}

function Selector({ label, value, onChange, children, disabled = false }: {
  label: string;
  value: string;
  onChange(value: string): void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return <div className={inputGridClass}>
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  </div>;
}

export function PrintShrimpOrdersClient({ initialData }: { initialData: PrintShrimpOrdersPageData }) {
  const readyProducts = useMemo(() => initialData.products.filter((product) => product.ready), [initialData.products]);
  const firstProduct = readyProducts[0] ?? initialData.products[0] ?? null;
  const firstSize = firstProduct?.availableSizes.includes('A4') ? 'A4' : firstProduct?.availableSizes[0] ?? 'A4';
  const sections = useMemo(() => {
    const unique = new Map<string, string>();
    for (const product of initialData.products) unique.set(product.sectionId, product.sectionName);
    return [...unique]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [initialData.products]);
  const [tab, setTab] = useState<Tab>('create');
  const [sectionId, setSectionId] = useState(firstProduct?.sectionId ?? '');
  const [listingId, setListingId] = useState(firstProduct?.listingId ?? '');
  const [size, setSize] = useState(firstSize);
  const [productType, setProductType] = useState<'Print' | 'Frame'>('Print');
  const [paperType, setPaperType] = useState('Matte');
  const [frameColour, setFrameColour] = useState('Black');
  const [fontId, setFontId] = useState<PrintShrimpCustomFontId>('nunito-semibold');
  const [topText, setTopText] = useState('');
  const [bottomText, setBottomText] = useState('');
  const [externalOrderNumber, setExternalOrderNumber] = useState('ORD-123');
  const [giftMessage, setGiftMessage] = useState('Happy birthday');
  const [name, setName] = useState('Dave F');
  const [email, setEmail] = useState('dave@harmonydata.co.uk');
  const [address1, setAddress1] = useState('The Farmhouse');
  const [address2, setAddress2] = useState('');
  const [city, setCity] = useState('Woking');
  const [region, setRegion] = useState('Surrey');
  const [zip, setZip] = useState('GU21 4DS');
  const [country, setCountry] = useState('GB');
  const [phone, setPhone] = useState('+447973631381');
  const [shipping, setShipping] = useState('standard');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [customOrderResult, setCustomOrderResult] = useState<{
    artworkUrl: string;
    fileName: string;
  } | null>(null);
  const [customPreviewLoading, setCustomPreviewLoading] = useState(false);
  const [customPreviewError, setCustomPreviewError] = useState<string | null>(null);
  const [customPreviewUrl, setCustomPreviewUrl] = useState<string | null>(null);
  const [orderCreated, setOrderCreated] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<PrintShrimpOrder | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [apiResponse, setApiResponse] = useState<Record<string, unknown> | null>(null);
  const [orders, setOrders] = useState<PrintShrimpOrder[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PrintShrimpOrder | null>(null);

  const sectionProducts = initialData.products.filter((product) => product.sectionId === sectionId);
  const selectedProduct = initialData.products.find((product) => product.listingId === listingId) ?? null;
  const countryNames = useMemo(() => new Intl.DisplayNames(['en-GB'], { type: 'region' }), []);

  useEffect(() => () => {
    if (customPreviewUrl) URL.revokeObjectURL(customPreviewUrl);
  }, [customPreviewUrl]);

  useEffect(() => {
    setOrderCreated(false);
    setCreatedOrder(null);
  }, [
    sectionId,
    listingId,
    size,
    productType,
    paperType,
    frameColour,
    fontId,
    topText,
    bottomText,
    externalOrderNumber,
    giftMessage,
    name,
    email,
    address1,
    address2,
    city,
    region,
    zip,
    country,
    phone,
    shipping,
  ]);

  function changeProduct(nextListingId: string) {
    setListingId(nextListingId);
    const product = initialData.products.find((candidate) => candidate.listingId === nextListingId);
    setSize(product?.availableSizes.includes('A4') ? 'A4' : product?.availableSizes[0] ?? 'A4');
    setPayload(null);
    setApiResponse(null);
    setCustomOrderResult(null);
    setPreviewError(null);
    setCustomPreviewUrl(null);
  }

  function changeSection(nextSectionId: string) {
    setSectionId(nextSectionId);
    const products = initialData.products.filter((product) => product.sectionId === nextSectionId);
    const product = products.find((candidate) => candidate.ready) ?? products[0] ?? null;
    setListingId(product?.listingId ?? '');
    setSize(product?.availableSizes.includes('A4') ? 'A4' : product?.availableSizes[0] ?? 'A4');
    setPayload(null);
    setApiResponse(null);
    setCustomOrderResult(null);
    setPreviewError(null);
    setCustomPreviewUrl(null);
  }

  async function createOrder() {
    if (!selectedProduct) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPayload(null);
    setApiResponse(null);
    setCustomOrderResult(null);
    setOrderCreated(false);
    setCreatedOrder(null);
    try {
      const requestBody: PrintShrimpOrderPreviewInput = {
        listingId: selectedProduct.listingId,
        size,
        productType,
        paperType,
        frameColour,
        fontId,
        topText,
        bottomText,
        externalOrderNumber,
        giftMessage,
        name,
        email,
        address1,
        address2,
        city,
        state: region,
        zip,
        country,
        phone,
        shipping,
      };
      const response = await fetch('/api/printshrimp/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const result = await response.json() as {
        custom?: boolean;
        folderUrl?: string | null;
        artworkUrl?: string | null;
        fileName?: string | null;
        payload?: Record<string, unknown>;
        response?: Record<string, unknown> | null;
        order?: PrintShrimpOrder | null;
        error?: string;
      };
      if (result.payload) setPayload(result.payload);
      if (result.response) setApiResponse(result.response);
      if (result.custom && result.artworkUrl && result.fileName) {
        setCustomOrderResult({
          artworkUrl: result.artworkUrl,
          fileName: result.fileName,
        });
      }
      if (!response.ok || !result.payload) {
        throw new Error(result.error ?? 'Unable to prepare the PrintShrimp order payload.');
      }
      setOrderCreated(true);
      setCreatedOrder(result.order ?? null);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Unable to prepare the PrintShrimp order payload.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function generateCustomPreview() {
    if (!selectedProduct || (!topText.trim() && !bottomText.trim())) return;
    setCustomPreviewLoading(true);
    setCustomPreviewError(null);
    setCustomPreviewUrl(null);
    try {
      const response = await fetch('/api/printshrimp/orders/custom-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: selectedProduct.listingId,
          size,
          topText,
          bottomText,
          fontId,
          externalOrderNumber,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? 'Unable to generate the custom artwork preview.');
      }
      const image = await response.blob();
      if (!image.type.startsWith('image/')) throw new Error('The custom artwork preview was not an image.');
      setCustomPreviewUrl(URL.createObjectURL(image));
    } catch (error) {
      setCustomPreviewError(error instanceof Error ? error.message : 'Unable to generate the custom artwork preview.');
    } finally {
      setCustomPreviewLoading(false);
    }
  }

  async function retrieveOrders() {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const response = await fetch('/api/printshrimp/orders', { cache: 'no-store' });
      const result = await response.json() as { orders?: PrintShrimpOrder[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Unable to retrieve PrintShrimp orders.');
      setOrders(result.orders ?? []);
      setOrdersLoaded(true);
    } catch (error) {
      setOrdersError(error instanceof Error ? error.message : 'Unable to retrieve PrintShrimp orders.');
    } finally {
      setOrdersLoading(false);
    }
  }

  return <div className="grid gap-6">
    <div>
      <h1 className="text-2xl font-semibold">PrintShrimp Orders</h1>
      <p className="mt-2 text-muted-foreground">Create a new PrintShrimp order or retrieve paid orders.</p>
    </div>

    {!initialData.configured ? <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{initialData.configurationMessage}</div> : null}

    <div role="tablist" aria-label="PrintShrimp order sections" className="flex gap-2 border-b">
      <button type="button" role="tab" aria-selected={tab === 'create'} className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === 'create' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab('create')}>Create Order</button>
      <button type="button" role="tab" aria-selected={tab === 'list'} className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === 'list' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab('list')}>List Orders</button>
    </div>

    {tab === 'create' ? <div role="tabpanel" className="grid gap-6">
      <Card>
        <CardHeader><CardTitle>Order and recipient</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="ORDER No" value={externalOrderNumber} onChange={setExternalOrderNumber} />
          <Field label="Message No" value={giftMessage} onChange={setGiftMessage} />
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Email" value={email} type="email" onChange={setEmail} />
          <Field label="Address 1" value={address1} onChange={setAddress1} />
          <Field label="Address 2" value={address2} onChange={setAddress2} />
          <Field label="City" value={city} onChange={setCity} />
          <Field label="State" value={region} onChange={setRegion} />
          <Field label="Zip" value={zip} onChange={setZip} />
          <Selector label="Country" value={country} onChange={setCountry}>
            {ISO_COUNTRY_CODES.map((code) => <SelectItem key={code} value={code}>{code} — {countryNames.of(code) ?? code}</SelectItem>)}
          </Selector>
          <Field label="Phone" value={phone} type="tel" onChange={setPhone} />
          <Selector label="Shipping" value={shipping} onChange={setShipping}>
            <SelectItem value="standard">standard</SelectItem>
            <SelectItem value="tracking upgrade">tracking upgrade</SelectItem>
            <SelectItem value="priority">priority</SelectItem>
          </Selector>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>PrintShrimp item</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 rounded-md border p-4">
            <p className="font-medium">Custom text</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-1">
                <Field label="Top text" value={topText} maxLength={40} onChange={(value) => { setTopText(value); setPayload(null); setApiResponse(null); setCustomOrderResult(null); setCustomPreviewUrl(null); }} />
                <p className="text-right text-xs text-muted-foreground">{topText.length}/40</p>
              </div>
              <div className="grid gap-1">
                <Field label="Bottom text" value={bottomText} maxLength={40} onChange={(value) => { setBottomText(value); setPayload(null); setApiResponse(null); setCustomOrderResult(null); setCustomPreviewUrl(null); }} />
                <p className="text-right text-xs text-muted-foreground">{bottomText.length}/40</p>
              </div>
              <div className="grid gap-1">
                <Selector label="Font" value={fontId} onChange={(value) => { setFontId(value as PrintShrimpCustomFontId); setPayload(null); setApiResponse(null); setCustomOrderResult(null); setCustomPreviewUrl(null); }}>
                  {PRINTSHRIMP_CUSTOM_FONTS.map((font) => <SelectItem key={font.id} value={font.id}>{font.label}</SelectItem>)}
                </Selector>
                <p aria-hidden="true" className="invisible text-right text-xs">0/40</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={generateCustomPreview} disabled={!selectedProduct || customPreviewLoading || (!topText.trim() && !bottomText.trim())}>
                {customPreviewLoading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Generating…</> : 'Generate'}
              </Button>
              {customPreviewError ? <p role="alert" className="text-sm text-destructive">{customPreviewError}</p> : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Selector label="Section" value={sectionId} onChange={changeSection} disabled={sections.length === 0}>
              {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
            </Selector>
            <Selector label="Listing" value={listingId} onChange={changeProduct} disabled={sectionProducts.length === 0}>
              {sectionProducts.map((product) => <SelectItem key={product.listingId} value={product.listingId} disabled={!product.ready}>{product.name} ({product.sku})</SelectItem>)}
            </Selector>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Selector label="Print / Frame" value={productType} onChange={(value) => setProductType(value as 'Print' | 'Frame')}>
              <SelectItem value="Print">Print</SelectItem>
              <SelectItem value="Frame">Frame</SelectItem>
            </Selector>
            <Selector label="Size" value={size} onChange={(value) => { setSize(value); setPayload(null); setApiResponse(null); setCustomOrderResult(null); setCustomPreviewUrl(null); }} disabled={!selectedProduct}>
              {(selectedProduct?.availableSizes ?? initialData.sizes).map((availableSize) => <SelectItem key={availableSize} value={availableSize}>{availableSize}</SelectItem>)}
            </Selector>
            {productType === 'Print' ? <Selector label="Paper type" value={paperType} onChange={setPaperType}>
              <SelectItem value="Matte">Matte</SelectItem>
              <SelectItem value="Satin">Satin</SelectItem>
              <SelectItem value="Gloss">Gloss</SelectItem>
            </Selector> : <Selector label="Frame colour" value={frameColour} onChange={setFrameColour}>
              <SelectItem value="Black">Black</SelectItem>
              <SelectItem value="White">White</SelectItem>
              <SelectItem value="Oak">Oak</SelectItem>
            </Selector>}
          </div>

          {selectedProduct?.unavailableReason ? <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{selectedProduct.unavailableReason}</div> : null}
          {previewError ? <p role="alert" className="text-sm text-destructive">{previewError}</p> : null}
          {orderCreated ? <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <p className="font-medium">PrintShrimp order created successfully.</p>
            {createdOrder ? <p className="mt-1">
              Order: {String(createdOrder.order_id ?? createdOrder.external_order_number ?? externalOrderNumber)}
              {createdOrder.status ? ` · ${createdOrder.status}` : ''}
            </p> : null}
          </div> : null}

          <div>
            <Button type="button" onClick={createOrder} disabled={!selectedProduct || previewLoading || !initialData.configured}>
              {previewLoading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />{topText.trim() || bottomText.trim() ? 'Creating custom artwork and order…' : 'Sending order…'}</> : 'Create Order'}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">This submits a pending order to PrintShrimp. Payment and production follow your PrintShrimp account settings.</p>
          </div>

          {customOrderResult ? <div className="grid gap-2 rounded-md border bg-muted/30 p-4 text-sm">
            <p className="font-medium">Custom artwork stored in S3: {customOrderResult.fileName}</p>
            <a className="inline-flex w-fit items-center gap-1 text-primary underline underline-offset-4" href={customOrderResult.artworkUrl} target="_blank" rel="noreferrer">Open custom artwork <ExternalLink className="h-3.5 w-3.5" /></a>
          </div> : null}

          {previewLoading ? <div role="status" className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            Preparing the exact PrintShrimp payload and submitting the order…
          </div> : null}

          {payload ? <div className="grid gap-2 rounded-md border bg-muted/30 p-4">
            <div>
              <h3 className="font-semibold">PrintShrimp payload</h3>
              <p className="text-xs text-muted-foreground">This is the exact payload sent to PrintShrimp when Create Order was pressed.</p>
            </div>
            <pre aria-label="PrintShrimp payload JSON" className="max-h-[32rem] overflow-auto rounded-md bg-muted p-4 text-xs">{JSON.stringify(payload, null, 2)}</pre>
          </div> : null}

          {apiResponse ? <div className="grid gap-2 rounded-md border bg-muted/30 p-4">
            <div>
              <h3 className="font-semibold">PrintShrimp API response</h3>
              <p className="text-xs text-muted-foreground">This is the response returned by PrintShrimp for the order request.</p>
            </div>
            <pre aria-label="PrintShrimp API response JSON" className="max-h-[32rem] overflow-auto rounded-md bg-muted p-4 text-xs">{JSON.stringify(apiResponse, null, 2)}</pre>
          </div> : null}
        </CardContent>
      </Card>
    </div> : null}

    {tab === 'list' ? <div role="tabpanel" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">The PrintShrimp API returns paid orders, newest first.</p>
        <Button type="button" onClick={retrieveOrders} disabled={ordersLoading || !initialData.configured}>
          {ordersLoading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Retrieving…</> : 'Retrieve Orders'}
        </Button>
      </div>
      {ordersError ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{ordersError}</div> : null}
      <Card><CardContent className="pt-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>External order number</TableHead><TableHead>Status</TableHead><TableHead>Paid</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {orders.map((order, index) => <TableRow key={String(order.order_id ?? `${order.external_order_number ?? 'order'}-${index}`)}>
                <TableCell className="font-medium">{String(order.external_order_number ?? '—')}</TableCell>
                <TableCell>{String(order.status ?? '—')}</TableCell>
                <TableCell>{order.paid === true ? 'Yes' : order.paid === false ? 'No' : '—'}</TableCell>
                <TableCell className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => setSelectedOrder(order)}>Info</Button></TableCell>
              </TableRow>)}
              {ordersLoaded && orders.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No paid orders were returned.</TableCell></TableRow> : null}
              {!ordersLoaded ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Press Retrieve Orders to load orders from PrintShrimp.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>
    </div> : null}

    <Dialog open={customPreviewUrl !== null} onOpenChange={(open) => { if (!open) setCustomPreviewUrl(null); }}>
      <DialogContent className="max-h-[90vh] max-w-[90vw] overflow-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Custom artwork preview</DialogTitle>
          <DialogDescription>{PRINTSHRIMP_CUSTOM_FONTS.find((font) => font.id === fontId)?.label ?? 'Selected font'} · {size}</DialogDescription>
        </DialogHeader>
        {customPreviewUrl ? <div className="flex justify-center rounded-md bg-muted/30 p-3">
          <img src={customPreviewUrl} alt="Generated custom PrintShrimp artwork preview" className="max-h-[75vh] max-w-full object-contain" />
        </div> : null}
      </DialogContent>
    </Dialog>

    <Dialog open={selectedOrder !== null} onOpenChange={(open) => { if (!open) setSelectedOrder(null); }}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>PrintShrimp order information</DialogTitle>
          <DialogDescription>{String(selectedOrder?.external_order_number ?? selectedOrder?.order_id ?? 'Order details')}</DialogDescription>
        </DialogHeader>
        {selectedOrder ? <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap break-words">{JSON.stringify(selectedOrder, null, 2)}</pre> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
