import { NextResponse } from 'next/server';
import { archiveDeliveryProfile, duplicateDeliveryProfile, getDeliveryProfileImpact, getMarketsDeliveryPageData, importDeliveryProfiles, saveDeliveryProfile, syncDeliveryProfile } from '@/lib/markets-delivery';
import { MarketsDeliveryError } from '@/lib/markets-delivery-core';
import { deliveryHttpError, deliveryMutationBody, deliveryParameter } from '@/lib/markets-delivery-http';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const shopId = new URL(request.url).searchParams.get('shopId');
    return NextResponse.json({ data: await getMarketsDeliveryPageData(shopId ? deliveryParameter(shopId, 'shop') : undefined) });
  } catch (error) { return deliveryHttpError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await deliveryMutationBody(request);
    const shopId = deliveryParameter(body.shopId, 'shop');
    const action = body.action;
    const profileId = body.profileId === undefined ? undefined : deliveryParameter(body.profileId, 'delivery profile');
    const revision = body.expectedRevision;
    if (revision !== undefined && (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1)) throw new MarketsDeliveryError('Choose a valid profile revision.');
    const confirmAffected = body.confirmAffected === true;
    let importedCount: number | undefined;
    if (action === 'create') await saveDeliveryProfile(shopId, body.values);
    else if (action === 'import') {
      if (body.resolveConflict !== undefined) throw new MarketsDeliveryError('Choose a specific profile and Reload from Etsy to resolve a conflict.');
      importedCount = await importDeliveryProfiles(shopId);
    } else {
      if (!profileId) throw new MarketsDeliveryError('Choose a delivery profile.');
      if (action === 'impact') return NextResponse.json({ affectedListings: await getDeliveryProfileImpact(shopId, profileId, body.values) });
      if (action === 'update') await saveDeliveryProfile(shopId, body.values, profileId, revision as number | undefined, confirmAffected);
      else if (action === 'duplicate') await duplicateDeliveryProfile(shopId, profileId);
      else if (action === 'archive') await archiveDeliveryProfile(shopId, profileId);
      else if (action === 'sync') {
        if (body.resolveConflict !== undefined && body.resolveConflict !== 'overwrite') throw new MarketsDeliveryError('Choose Keep local and Sync to explicitly overwrite an Etsy conflict.');
        await syncDeliveryProfile(shopId, profileId, { expectedRevision: revision as number | undefined, confirmAffected, resolveConflict: body.resolveConflict as string | undefined });
      } else if (action === 'reload-remote') {
        if (body.resolveConflict !== 'import') throw new MarketsDeliveryError('Confirm Reload from Etsy to replace this profile’s local rate changes.');
        importedCount = await importDeliveryProfiles(shopId, { profileId, resolveConflict: true, expectedRevision: revision as number | undefined });
      } else throw new MarketsDeliveryError('Choose a supported delivery action.');
    }
    return NextResponse.json({ data: await getMarketsDeliveryPageData(shopId), ...(importedCount !== undefined ? { importedCount } : {}) });
  } catch (error) { return deliveryHttpError(error); }
}
