import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),invalidate:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:mocks.query,$executeRaw:mocks.execute}}));
vi.mock('@/lib/listing-image-generation-state',()=>({invalidateListingImageGeneration:mocks.invalidate}));
import {findListingTemplateArtworkConsumers,invalidateListingTemplateArtworkConsumers} from './listing-template-artwork-dependencies';
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockResolvedValue([{id:90},{id:91},{id:90}]);});
describe('assignment source dependencies',()=>{
  it('finds exact string-valued source IDs only within the same canonical shop',async()=>{
    expect(await findListingTemplateArtworkConsumers([10,11,10])).toEqual([90,91]);
    const sql=mocks.query.mock.calls[0][0].join('');
    expect(sql).toMatch(/source\.shopId=consumer\.shopId/);
    expect(sql).toMatch(/parent\.shopId=source\.shopId/);expect(sql).toContain('etsy_listing_group_items');
    expect(sql).toContain("JSON_SEARCH(consumer.templateArtworkAssignments,'one',CAST(source.id AS CHAR),NULL,'$.*.*')");
    expect(mocks.query.mock.calls[0][1].values).toEqual([10,11]);expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('uses the source mutation transaction for local revisions and fingerprint invalidation only',async()=>{
    const client={$queryRaw:mocks.query,$executeRaw:mocks.execute};
    expect(await invalidateListingTemplateArtworkConsumers([10],client)).toEqual([10,90,91]);
    expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith([10,90,91],client);
    const sql=mocks.execute.mock.calls[0][0].join('');
    expect(sql).toMatch(/overviewGenerationFingerprint=/);expect(sql).not.toMatch(/DELETE|thumbnail|printCropSettings|productsChanged|downloadsRevision/);
  });
  it('avoids queries and writes for no sources or no consumers, and rejects invalid IDs',async()=>{
    expect(await invalidateListingTemplateArtworkConsumers([])).toEqual([]);expect(mocks.query).not.toHaveBeenCalled();
    await expect(findListingTemplateArtworkConsumers([0])).rejects.toThrow('Invalid source listing id');
    mocks.query.mockResolvedValueOnce([]);expect(await invalidateListingTemplateArtworkConsumers([10])).toEqual([10]);
    expect(mocks.invalidate).toHaveBeenCalledWith([10],expect.anything());expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
