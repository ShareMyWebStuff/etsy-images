import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  data: vi.fn(), findListing: vi.fn(), readFingerprint: vi.fn(), saveFingerprint: vi.fn(),
  deleteImages: vi.fn(), generateImages: vi.fn(), generateDetails: vi.fn(), groupedPdf: vi.fn(),
  singleDetails:vi.fn(), printable:vi.fn(),guide:vi.fn(),dropbox:vi.fn(),singlePdf:vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyListing: { findUnique: mocks.findListing }, $queryRaw: mocks.readFingerprint, $executeRaw: mocks.saveFingerprint,
} }));
vi.mock('@/lib/listing-editor', () => ({
  getListingEditorData: mocks.data, deleteAllListingImages: mocks.deleteImages,
  generateListingTemplateImages: mocks.generateImages, generateListingPrintableDownload: mocks.printable,
  generateListingHowToPrintGuide: mocks.guide,
}));
vi.mock('@/lib/bedrock-listing-details', () => ({
  generateListingDetailsWithBedrock: mocks.singleDetails, generateMultipleListingDetailsWithBedrock: mocks.generateDetails,
}));
vi.mock('@/lib/dropbox-bundle', () => ({
  createDropboxInstructionPdf: mocks.singlePdf, createGroupedDropboxInstructionPdf: mocks.groupedPdf,
  createOrUpdateDropbox: mocks.dropbox, isDropboxInstructionPdfFile: (file: { localFileName: string }) => file.localFileName === 'instructions.pdf',
}));

import { generateListingOverview, recordCurrentListingOverviewFingerprint } from '@/lib/listing-overview-generation';
import {PRINTABLE_DOWNLOAD_SPECS} from '@/lib/printable-download-specs';

const context = { shopId: '66615491', sectionId: '15', subSectionId: '27', listingId: '99' };
let fingerprint: string | null;
let sourceCrop: Record<string, unknown>;
let sourceTextAreas: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  fingerprint = null;
  sourceCrop = { version: 4, regions: { '2x3': { x: 0, y: 0, width: 5 / 6, height: 1 } } };
  sourceTextAreas = { version: 2, areasByRatio: { '2x3': { top: { y: 0.1 } } } };
  mocks.data.mockResolvedValue({
    section: { sectionName: 'Jellyfish' }, subSection: { name: 'Sets' },
    template: { templateType: 'multiple', digitalDownload:true,printsFrames:true,customisePrints:false,
      imageTemplates: [{ id: 94, name: 'Wall', generated: true }] },
    etsyProducts:{config:{digitalDownload:true,digitalDownloadOverride:null,customisePrints:false}},
    listing: {
      artworkOrientation: 'portrait', printCropSettings: null, personalisationTextAreas: null,
      title: 'Set', description: 'Set description', digitalTitle: 'Digital set', digitalDescription: 'Digital set description',
      quantity: 99, digitalQuantity: 99, primaryColour: 'Green', secondaryColour: 'White',
    },
    tags: [{ value: 'art' }],
    dropbox: { current: true },
  });
  mocks.findListing.mockImplementation(async (args) => {
    // Return only selected source fields, as Prisma does, so the regression
    // detects a crop field omitted from the actual generation snapshot.
    const sourceFields = args.select.groupItems.select.sourceListing.select as Record<string, unknown>;
    const source = {
      localDirectoryName: 'Source', thumbnailFileName: 'thumbnail.png',
      thumbnailUpdatedAt: new Date('2026-11-13T00:00:00.000Z'), artworkOrientation: 'portrait',
      downloadsRevision: 1, printCropSettings: sourceCrop, personalisationTextAreas: sourceTextAreas,
    };
    return {
      id: 99, images: [{ ourCategoryImageTemplateId: 94 }], files: [{ localFileName: 'instructions.pdf' }],
      groupItems: [{ position: 1, sourceListingId: 548, sourceListing: Object.fromEntries(
        Object.entries(source).filter(([key]) => sourceFields[key]),
      ) }],
    };
  });
  mocks.readFingerprint.mockImplementation(async () => [{ overviewGenerationFingerprint: fingerprint }]);
  mocks.saveFingerprint.mockImplementation(async (query) => { fingerprint = query.values[0] as string; });
  mocks.generateDetails.mockImplementation(async()=>mocks.data());
  mocks.guide.mockImplementation(async()=>mocks.data());
});

describe('grouped generation source crops', () => {
  it('accepts a current baseline when disabled roles have no generated output', async () => {
    const data = await mocks.data();
    data.template.imageTemplates.push({ id: 95, name: 'Unsupported room', generated: false, enabled: false,
      disabledReason: 'No landscape image is assigned.' });
    await expect(recordCurrentListingOverviewFingerprint(context)).resolves.toBe(data);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const result = await generateListingOverview(context, 'changed');
    expect(result.generation.regenerated).toBe(false);
    expect(mocks.generateImages).not.toHaveBeenCalled();
  });

  it.each(['category flags', 'eligible roles'])('invalidates Only Changed when orientation configuration changes its %s', async (change) => {
    const data = await mocks.data();
    data.template.portraitEnabled = true; data.template.landscapeEnabled = true;
    await recordCurrentListingOverviewFingerprint(context);
    const before = fingerprint;
    if (change === 'category flags') data.template.landscapeEnabled = false;
    else Object.assign(data.template.imageTemplates[0], { enabled: false, generated: false, disabledReason: 'The scene uses landscape paper.' });
    const result = await generateListingOverview(context, 'changed');
    expect(result.generation.regenerated).toBe(true);
    expect(mocks.generateImages).toHaveBeenCalledWith(context);
    expect(mocks.generateDetails).toHaveBeenCalledWith(context);
    expect(mocks.groupedPdf).toHaveBeenCalledWith(context);
    expect(fingerprint).not.toBe(before);
  });

  it('does not start generation or record completion when old image cleanup fails', async () => {
    mocks.deleteImages.mockRejectedValueOnce(new Error('Stored image cleanup failed'));
    await expect(generateListingOverview(context, 'all')).rejects.toThrow('Stored image cleanup failed');
    expect(mocks.generateImages).not.toHaveBeenCalled();
    expect(mocks.saveFingerprint).not.toHaveBeenCalled();
  });

  it.each(['crop', 'text areas'] as const)('regenerates Only Changed when a grouped source changes its %s before downloads are rebuilt', async (change) => {
    await recordCurrentListingOverviewFingerprint(context);
    const unchanged = await generateListingOverview(context, 'changed');
    expect(unchanged.generation.regenerated).toBe(false);
    expect(mocks.generateImages).not.toHaveBeenCalled();

    if (change === 'crop') sourceCrop = { ...sourceCrop, regions: { '2x3': { x: 1 / 6, y: 0, width: 5 / 6, height: 1 } } };
    else sourceTextAreas = { ...sourceTextAreas, areasByRatio: { '2x3': { top: { y: 0.2 } } } };
    const updated = await generateListingOverview(context, 'changed');
    expect(updated.generation.regenerated).toBe(true);
    expect(mocks.deleteImages).toHaveBeenCalledWith(context, { forGeneration: true });
    expect(mocks.generateImages).toHaveBeenCalledWith(context);
    expect(mocks.generateDetails).toHaveBeenCalledWith(context);
    expect(mocks.groupedPdf).toHaveBeenCalledWith(context);
  });

  it('regenerates a pending scene even when a legacy listing has no fingerprint', async () => {
    const data = await mocks.data();
    data.listing.imagesNeedRegeneration = true;
    mocks.generateImages.mockImplementationOnce(async () => { data.listing.imagesNeedRegeneration = false; });
    const result = await generateListingOverview(context, 'changed');
    expect(result.generation).toEqual({ regenerated: true, baselineCreated: false });
    expect(mocks.generateImages).toHaveBeenCalledWith(context);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not accept a generation baseline while scene outputs are stale', async () => {
    const data = await mocks.data();
    data.listing.imagesNeedRegeneration = true;
    await expect(recordCurrentListingOverviewFingerprint(context)).rejects.toThrow('listing images need regeneration');
    expect(mocks.saveFingerprint).not.toHaveBeenCalled();
  });

  it.each(['all', 'changed'] as const)('blocks the entire %s workflow before cleanup or paid generation when artwork is invalid', async (mode) => {
    const data = await mocks.data();
    data.templateArtwork = { valid: false, errors: ['Living room: Choose artwork item 2.'], fingerprint: 'invalid' };
    await expect(generateListingOverview(context, mode)).rejects.toThrow('Living room: Choose artwork item 2.');
    expect(mocks.deleteImages).not.toHaveBeenCalled();
    expect(mocks.generateImages).not.toHaveBeenCalled();
    expect(mocks.generateDetails).not.toHaveBeenCalled();
    expect(mocks.groupedPdf).not.toHaveBeenCalled();
    expect(mocks.saveFingerprint).not.toHaveBeenCalled();
  });

  it('includes the effective artwork selections and their source version in Only Changed', async () => {
    const data = await mocks.data();
    data.templateArtwork = { valid: true, errors: [], fingerprint: 'source-version-1' };
    await recordCurrentListingOverviewFingerprint(context);
    expect((await generateListingOverview(context, 'changed')).generation.regenerated).toBe(false);
    data.templateArtwork.fingerprint = 'source-version-2';
    expect((await generateListingOverview(context, 'changed')).generation.regenerated).toBe(true);
  });

  it('rechecks artwork validity after image generation before starting paid details generation', async () => {
    const data = await mocks.data();
    mocks.generateImages.mockImplementationOnce(async () => {
      data.templateArtwork = { valid: false, errors: ['Selected source artwork was removed.'] };
    });
    await expect(generateListingOverview(context, 'all')).rejects.toThrow('Selected source artwork was removed.');
    expect(mocks.generateImages).toHaveBeenCalled(); expect(mocks.generateDetails).not.toHaveBeenCalled();
    expect(mocks.saveFingerprint).not.toHaveBeenCalled();
  });
});

describe('Dropbox delivery follows the effective digital-download setting',()=>{
  async function setup(type:'single'|'multiple',digitalDownload:boolean,override:boolean|null){
    const data=await mocks.data();
    data.template.templateType=type;
    data.template.digitalDownload=digitalDownload;
    data.etsyProducts.config.digitalDownloadOverride=override;
    data.listing.printCropSettings=type==='single'?{version:4}:null;
    data.dropbox.current=false;
    const files:Array<{localFileName:string;widthPixels?:number;heightPixels?:number}>=type==='single'?[
      ...PRINTABLE_DOWNLOAD_SPECS.map(spec=>({localFileName:`Artwork_${spec.fileToken}.jpg`,
        widthPixels:spec.portraitWidth,heightPixels:spec.portraitHeight})),
      {localFileName:'How_To_Print_Guide.pdf'},
    ]:[];
    const row={id:99,images:[{ourCategoryImageTemplateId:94}],files,groupItems:[]};
    mocks.findListing.mockResolvedValue(row);
    return{data,row};
  }

  for(const type of ['single','multiple'] as const){
    it.each([
      {templateDigital:false,override:null},
      {templateDigital:false,override:true},
      {templateDigital:true,override:false},
    ])(`${type}: skips Dropbox and instruction PDFs when digital delivery is disabled (%j)`,async({templateDigital,override})=>{
      const {row}=await setup(type,templateDigital,override);
      const originalFiles=structuredClone(row.files);
      const result=await generateListingOverview(context,'all');
      expect(result.generation.regenerated).toBe(true);
      expect(mocks.generateImages).toHaveBeenCalledWith(context);
      expect(type==='single'?mocks.singleDetails:mocks.generateDetails).toHaveBeenCalledWith(context);
      expect(mocks.dropbox).not.toHaveBeenCalled();expect(mocks.singlePdf).not.toHaveBeenCalled();
      expect(mocks.groupedPdf).not.toHaveBeenCalled();expect(row.files).toEqual(originalFiles);
      expect(mocks.printable).toHaveBeenCalledTimes(type==='single'?PRINTABLE_DOWNLOAD_SPECS.length:0);
      expect(mocks.guide).toHaveBeenCalledTimes(type==='single'?1:0);
      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect((await generateListingOverview(context,'changed')).generation.regenerated).toBe(false);
    });

    it(`${type}: keeps digital delivery enabled when its override is inherited despite the legacy product flag`,async()=>{
      const {data,row}=await setup(type,true,null);
      data.etsyProducts.config.digitalDownload=false;
      row.files.push({localFileName:'instructions.pdf'});data.dropbox.current=true;
      const anotherShop={...context,shopId:'12345678'};
      await generateListingOverview(anotherShop,'all');
      if(type==='single'){
        expect(mocks.dropbox).toHaveBeenCalledExactlyOnceWith(anotherShop);
        expect(mocks.singlePdf).toHaveBeenCalledExactlyOnceWith(anotherShop);
        expect(mocks.groupedPdf).not.toHaveBeenCalled();
      }else{
        expect(mocks.groupedPdf).toHaveBeenCalledExactlyOnceWith(anotherShop);
        expect(mocks.dropbox).not.toHaveBeenCalled();expect(mocks.singlePdf).not.toHaveBeenCalled();
      }
    });

    it(`${type}: rejects a digital completion baseline without its required delivery assets`,async()=>{
      await setup(type,true,null);
      await expect(recordCurrentListingOverviewFingerprint(context)).rejects.toThrow(
        type==='single'?'Dropbox download instructions PDF':'grouped download instructions PDF');
      expect(mocks.saveFingerprint).not.toHaveBeenCalled();
    });

    it(`${type}: rechecks the latest returned listing settings before its Dropbox stage`,async()=>{
      const {data}=await setup(type,true,null);
      const disableDigital=async()=>{
        const refreshed={...data,etsyProducts:{...data.etsyProducts,
          config:{...data.etsyProducts.config,digitalDownloadOverride:false}}};
        mocks.data.mockResolvedValue(refreshed);
        return refreshed;
      };
      (type==='single'?mocks.guide:mocks.generateDetails).mockImplementationOnce(disableDigital);
      await generateListingOverview(context,'all');
      expect(mocks.dropbox).not.toHaveBeenCalled();expect(mocks.singlePdf).not.toHaveBeenCalled();
      expect(mocks.groupedPdf).not.toHaveBeenCalled();
    });
  }

  it('tracks the effective digital override so Only Changed schedules delivery when digital is enabled later',async()=>{
    const {data,row}=await setup('multiple',true,false);
    await recordCurrentListingOverviewFingerprint(context);
    const physicalFingerprint=fingerprint;
    data.etsyProducts.config.digitalDownloadOverride=null;
    row.files.push({localFileName:'instructions.pdf'});
    const result=await generateListingOverview(context,'changed');
    expect(result.generation.regenerated).toBe(true);
    expect(mocks.groupedPdf).toHaveBeenCalledExactlyOnceWith(context);
    expect(fingerprint).not.toBe(physicalFingerprint);
    expect(mocks.findListing).toHaveBeenCalledWith(expect.objectContaining({select:expect.objectContaining({
      productConfig:expect.objectContaining({select:expect.objectContaining({digitalDownloadOverride:true})}),
    })}));
  });
});
