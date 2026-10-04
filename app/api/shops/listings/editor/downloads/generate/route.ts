import { NextResponse } from 'next/server';
import { generateListingHowToPrintGuide, generateListingPrintableDownload } from '@/lib/listing-editor';
import { PRINTABLE_DOWNLOAD_SPECS, type PrintableDownloadRatio } from '@/lib/printable-download-specs';

type GeneratePrintableDownloadRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  ratio?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GeneratePrintableDownloadRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    if (!body.ratio || (body.ratio !== 'guide' && !PRINTABLE_DOWNLOAD_SPECS.some((spec) => spec.key === body.ratio))) {
      return NextResponse.json({ error: 'Choose a valid printable download ratio.' }, { status: 400 });
    }
    const context = {
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    };
    const data = body.ratio === 'guide'
      ? await generateListingHowToPrintGuide(context)
      : await generateListingPrintableDownload(context, body.ratio as PrintableDownloadRatio);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to generate printable download or guide:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to generate printable download.' },
      { status: 500 },
    );
  }
}
