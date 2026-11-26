import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {invalidateListingImageGeneration} from '@/lib/listing-image-generation-state';
type Client=Pick<typeof prisma,'$queryRaw'|'$executeRaw'>;

/** Same-shop JSON references supplement the existing grouped-source foreign-key dependencies. */
export async function findListingTemplateArtworkConsumers(sourceListingIds:number[],client:Pick<Client,'$queryRaw'>=prisma){
  const ids=[...new Set(sourceListingIds)];
  if(ids.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Invalid source listing id.');
  if(!ids.length)return[];
  const rows=await client.$queryRaw<Array<{id:number}>>`
    SELECT DISTINCT consumer.id FROM etsy_listings consumer
    JOIN etsy_listings source ON source.id IN (${Prisma.join(ids)}) AND source.shopId=consumer.shopId
    WHERE JSON_SEARCH(consumer.templateArtworkAssignments,'one',CAST(source.id AS CHAR),NULL,'$.*.*') IS NOT NULL
    UNION
    SELECT DISTINCT parent.id FROM etsy_listing_group_items assignment
    JOIN etsy_listings source ON source.id=assignment.sourceListingId
    JOIN etsy_listings parent ON parent.id=assignment.groupListingId AND parent.shopId=source.shopId
    WHERE source.id IN (${Prisma.join(ids)})
    ORDER BY id`;
  return[...new Set(rows.map(row=>Number(row.id)))];
}

export async function invalidateListingTemplateArtworkConsumers(sourceListingIds:number[],client:Client=prisma){
  const consumers=await findListingTemplateArtworkConsumers(sourceListingIds,client);
  const ids=[...new Set([...sourceListingIds,...consumers])];
  if(!ids.length)return ids;
  await invalidateListingImageGeneration(ids,client);
  await client.$executeRaw`UPDATE etsy_listings SET overviewGenerationFingerprint=${'0'.repeat(64)} WHERE id IN (${Prisma.join(ids)})`;
  return ids;
}
