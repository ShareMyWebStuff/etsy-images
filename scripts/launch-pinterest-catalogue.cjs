// Applies the reviewed 2026-11 catalogue and fresh future schedules. Never posts a Pin immediately.
// Default: read-only validation. Explicit --apply-drafts and --schedule select the two write stages.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const directory = path.resolve('output/pinterest/2026-11-launch');
const flags = new Set(process.argv.slice(2));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2);
const read = async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
const save = (name, value) => fs.writeFile(path.join(directory, name), json(value));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function parallel(items, concurrency, action) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { for (;;) { const index = cursor++; if (index >= items.length) return; await action(items[index], index); } }));
}

function orderedPins(pins) {
  const groups = new Map();
  for (const pin of pins) { const group = groups.get(pin.listingId) ?? []; group.push(pin); groups.set(pin.listingId, group); }
  const designs = [...groups.values()].sort((a, b) => a[0].context.subject.localeCompare(b[0].context.subject, 'en-GB'));
  // One artwork per turn; separate print and download versions across the campaign.
  for (const group of designs) group.sort((a, b) => Number(a.destinationVariant === 'digital') - Number(b.destinationVariant === 'digital') || (a.existingPinId ?? 1e9) - (b.existingPinId ?? 1e9));
  const result = [];
  for (let round = 0; designs.some(group => group.length > round); round++) for (const group of designs) if (group[round]) result.push(group[round]);
  return result;
}

async function main() {
  const plan = await read('plan.json');
  const creativeManifest = await read('creative-manifest.json');
  const creatives = new Map(creativeManifest.pins.map(pin => [pin.key, pin]));
  const prisma = new PrismaClient();
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null }, resolve: { alias: { '@': process.cwd() } } });
  const nativeFetch = globalThis.fetch;
  // This launch deliberately delegates all future Pin posts to the scheduled publisher.
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    if (/api(?:-sandbox)?\.pinterest\.com$/.test(url.hostname) && /^\/v5\/pins(?:\/|$)/.test(url.pathname) && (init.method ?? 'GET') !== 'GET') throw new Error('Immediate Pinterest Pin mutations are disabled in this launch script.');
    return nativeFetch(input, init);
  };
  let s3;
  try {
    const { validatePinDescription } = await vite.ssrLoadModule('/lib/pinterest/description.ts');
    const { buildPinterestSchedule, schedulePinterestPins } = await vite.ssrLoadModule('/lib/pinterest/scheduling.ts');
    const { attachPinCreativeStorageKey } = await vite.ssrLoadModule('/lib/pinterest/creative-storage.ts');
    const rows = await prisma.etsyListing.findMany({ where: { id: { in: [...new Set(plan.pins.map(pin => pin.listingId))] } }, include: { images: true, subSection: { include: { shopSection: { include: { shop: true } } } } } });
    const pinRows = await prisma.pinterestPin.findMany();
    const connection = await prisma.pinterestConnection.findUnique({ where: { id: 1 }, select: { username: true, environment: true } });
    if (connection?.username !== plan.account.username || connection.environment !== 'production' || process.env.PINTEREST_ENVIRONMENT !== 'production') throw new Error('The authorized production Pinterest account changed.');
    if (plan.startDate !== '2026-11-17' || plan.timeZone !== 'Europe/London' || plan.pinsPerBoardPerDay !== 2) throw new Error('The authorized launch date or publishing pace changed.');
    const baseline = JSON.parse(await fs.readFile('.tmp/pinterest-launch/before.json', 'utf8'));
    for (const pin of plan.pins) {
      const listing = rows.find(row => row.id === pin.listingId);
      const variant = pin.variant === 'download' ? { id: listing?.etsyDownloadId, url: listing?.etsyDownloadUrl, state: listing?.etsyDownloadState } : pin.variant === 'customised' ? { id: listing?.etsyCustomisedId, url: listing?.etsyCustomisedUrl, state: listing?.etsyCustomisedState } : { id: listing?.etsyId, url: listing?.url, state: listing?.state };
      if (!listing || variant.id !== pin.etsyListingId || variant.url !== pin.destinationUrl || variant.state !== 'active') throw new Error(`The active Etsy destination changed for ${pin.key}.`);
      if (!listing.images.some(image => image.id === pin.imageId)) throw new Error(`The Pin source image changed for ${pin.key}.`);
      const copy = await read(`copy/${pin.key}.json`);
      if (copy.inputHash !== sha(json(pin.context))) throw new Error(`The generated copy context changed for ${pin.key}.`);
      pin.description = validatePinDescription(copy.description);
      if (!pin.needsCopy && pin.description !== pin.existingDescription) throw new Error(`Reviewed copy must remain unchanged for ${pin.key}.`);
      if (Array.from(pin.title).length > 100) throw new Error(`The Pin title is too long: ${pin.key}.`);
      if (pin.existingPinId) {
        const row = pinRows.find(row => row.id === pin.existingPinId);
        const original = baseline.pins.find(row => row.id === pin.existingPinId);
        if (!row || !original || row.boardId !== original.boardId || row.imageId !== original.imageId || row.title !== pin.title || row.creativeStorageKey !== original.creativeStorageKey || row.destinationUrl !== pin.destinationUrl || row.pinterestPinId || row.publishedAt || !['DRAFT', 'PAUSED', 'FAILED', ...(flags.has('--schedule') ? ['SCHEDULED'] : [])].includes(row.status)) throw new Error(`An existing Pin changed before launch: ${pin.key}.`);
        if (row.description !== pin.description && (row.description !== pin.existingDescription || row.updatedAt.toISOString() !== pin.existingUpdatedAt)) throw new Error(`An existing description changed before launch: ${pin.key}.`);
      }
      if (pin.needsCreative) {
        const creative = creatives.get(pin.key);
        const image = listing.images.find(image => image.id === pin.imageId);
        if (!creative || creative.layoutVersion !== 2 || creative.listingId !== pin.listingId || creative.imageId !== pin.imageId
          || creative.sourceImageUpdatedAt !== image.updatedAt.toISOString()
          || (pin.destinationVariant === 'digital' && creative.thumbnailUpdatedAt !== listing.thumbnailUpdatedAt?.toISOString())) throw new Error(`Creative source metadata changed for ${pin.key}.`);
        const identity = { sourceKey: creative.sourceKey, sourceImageUpdatedAt: creative.sourceImageUpdatedAt, thumbnailUpdatedAt: pin.destinationVariant === 'digital' ? creative.thumbnailUpdatedAt : null };
        const expectedHash = sha(json({ layoutVersion: 2, listingId: pin.listingId, imageId: pin.imageId, title: pin.title, context: pin.context, boardKey: pin.boardKey, destinationVariant: pin.destinationVariant, sourceIdentity: identity }));
        if (creative.inputHash !== expectedHash || creative.sourceIdentityHash !== sha(json(identity))) throw new Error(`Creative context changed for ${pin.key}.`);
        const bytes = await fs.readFile(path.join(directory, creative.imageFile));
        const metadata = await sharp(bytes).metadata();
        if (sha(bytes) !== creative.sha256 || metadata.width !== 1000 || metadata.height !== 1500 || creative.creativeStorageKey !== `.pinterest-creatives/${pin.listingId}/${creative.sha256}.png`
          || sha(await fs.readFile(path.join(directory, creative.sourceFile))) !== creative.sourceSha256) throw new Error(`Creative integrity check failed for ${pin.key}.`);
      }
    }
    const previews = plan.boards.map(board => {
      const pins = orderedPins(plan.pins.filter(pin => pin.boardKey === board.key));
      const dates = buildPinterestSchedule(plan.startDate, pins.length, plan.pinsPerBoardPerDay, plan.timeZone);
      return { ...board, count: pins.length, firstScheduledAt: dates[0], lastScheduledAt: dates.at(-1), pins: pins.map((pin, index) => ({ key: pin.key, listingId: pin.listingId, variant: pin.destinationVariant, scheduledAt: dates[index] })) };
    });
    await save('schedule-preview.json', { startDate: plan.startDate, timeZone: plan.timeZone, pinsPerBoardPerDay: plan.pinsPerBoardPerDay, boards: previews });
    const cards = plan.boards.map(board => `<section><h2>${esc(board.name)}</h2><div class="grid">${plan.pins.filter(pin => pin.boardKey === board.key).map(pin => `<article><img loading="lazy" src="${esc(pin.needsCreative ? creatives.get(pin.key).imageFile : `http://localhost:3002/api/pinterest/pins/${pin.existingPinId}/image`)}" alt="${esc(pin.context.subject)}"><div><small>${esc(pin.destinationVariant.toUpperCase())}</small><h3>${esc(pin.title)}</h3><p>${esc(pin.description)}</p><a href="${esc(pin.destinationUrl)}">Open Etsy product</a></div></article>`).join('')}</div></section>`).join('');
    await fs.writeFile(path.join(directory, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CosyHousePrints Pinterest launch</title><style>body{font:16px/1.5 system-ui;background:#f7f4ee;color:#2c3e33;max-width:1500px;margin:auto;padding:32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}article{background:#fff;border:1px solid #ded8cb;border-radius:12px;overflow:hidden}img{display:block;width:100%;height:400px;object-fit:contain;background:#ece9e0}article>div{padding:20px}h3{font-size:18px}a{color:#365c40}small{font-weight:700}h2{margin-top:48px}</style><h1>570 Pins for CosyHousePrints</h1><p>Scheduled from 17 November 2026 at two Pins per board per day, London time. This review file does not publish anything.</p>${cards}</html>`);
    console.log(JSON.stringify({ stage: 'validated', pins: plan.pins.length, newCreatives: creatives.size, boards: previews.map(({ name, count, firstScheduledAt, lastScheduledAt }) => ({ name, count, firstScheduledAt, lastScheduledAt })), applyDrafts: flags.has('--apply-drafts'), schedule: flags.has('--schedule') }));

    if (flags.has('--verify-existing-images')) {
      const { imageMediaSource } = await vite.ssrLoadModule('/lib/pinterest/pins.ts');
      let verified = 0;
      await parallel(plan.pins.filter(pin => pin.existingPinId), 4, async pin => {
        const media = await imageMediaSource(pin.listingId, pin.imageId, pin.existingPinId);
        const bytes = media.source_type === 'image_base64' ? Buffer.from(media.data, 'base64') : await fetch(media.url, { signal: AbortSignal.timeout(30000) }).then(async response => { if (!response.ok) throw new Error('Existing Pin image URL failed.'); return Buffer.from(await response.arrayBuffer()); });
        await sharp(bytes).metadata(); verified++;
      });
      await save('existing-images-verification.json', { checkedAt: new Date().toISOString(), verified });
      console.log(JSON.stringify({ stage: 'existing-images-verified', verified }));
    }

    if (flags.has('--apply-drafts')) {
      const imageVerification = await read('existing-images-verification.json');
      if (imageVerification.verified !== plan.pins.filter(pin => pin.existingPinId).length) throw new Error('Verify every existing Pin image before applying the launch.');
      const { pinterestRequest } = await vite.ssrLoadModule('/lib/pinterest/client.ts');
      const account = await pinterestRequest('/user_account');
      if (account.username !== connection.username) throw new Error('The production Pinterest account changed.');
      const remoteBoards = []; let bookmark;
      do { const page = await pinterestRequest(`/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`); remoteBoards.push(...page.items); bookmark = page.bookmark; } while (bookmark);
      const boardIds = new Map();
      for (const board of plan.boards) {
        const matches = remoteBoards.filter(remote => remote.name.trim().toLowerCase() === board.name.toLowerCase());
        if (matches.length > 1) throw new Error(`Duplicate Pinterest boards: ${board.name}`);
        const remote = matches[0] ?? await pinterestRequest('/boards', { method: 'POST', body: JSON.stringify({ name: board.name, description: board.description, privacy: 'PUBLIC' }) });
        if (remote.privacy !== 'PUBLIC') throw new Error('A launch board must be public.');
        const saved = await prisma.pinterestBoard.upsert({ where: { pinterestBoardId: remote.id }, create: { pinterestBoardId: remote.id, name: remote.name, description: remote.description || board.description, privacy: 'PUBLIC', pinCount: remote.pin_count ?? 0, lastSyncedAt: new Date() }, update: { name: remote.name, privacy: 'PUBLIC', lastSyncedAt: new Date() } });
        boardIds.set(board.key, saved.id);
      }
      if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) process.env.AWS_PROFILE = 'etsy-listings-app';
      s3 = new S3Client({ region: process.env.AWS_REGION || 'eu-west-2', maxAttempts: 3 });
      const bucket = process.env.ETSY_LISTINGS_S3_BUCKET || 'etsy-listings-216211142709-eu-west-2';
      let uploaded = 0;
      await parallel([...creatives.values()], 4, async creative => {
        const bytes = await fs.readFile(path.join(directory, creative.imageFile));
        try { await s3.send(new PutObjectCommand({ Bucket: bucket, Key: creative.creativeStorageKey, Body: bytes, ContentType: 'image/png', Metadata: { sha256: creative.sha256 }, IfNoneMatch: '*' })); }
        catch (error) { if (error.$metadata?.httpStatusCode !== 412) throw error; }
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: creative.creativeStorageKey }));
        if (head.Metadata?.sha256 !== creative.sha256 || head.ContentLength !== bytes.length) throw new Error('Stored Pinterest creative verification failed.');
        uploaded++; if (uploaded % 50 === 0) console.log(JSON.stringify({ stage: 'stored-creatives', uploaded, total: creatives.size }));
      });
      const applied = [];
      for (const pin of plan.pins) {
        const boardId = boardIds.get(pin.boardKey);
        let row;
        if (pin.existingPinId) {
          row = await prisma.pinterestPin.findUniqueOrThrow({ where: { id: pin.existingPinId } });
          if (row.boardId !== boardId) throw new Error('An existing Pin belongs to a different board.');
          if (row.description !== pin.description) {
            const changed = await prisma.pinterestPin.updateMany({ where: { id: row.id, description: pin.existingDescription, updatedAt: new Date(pin.existingUpdatedAt), status: { in: ['DRAFT', 'PAUSED', 'FAILED'] }, pinterestPinId: null, publishedAt: null }, data: { description: pin.description } });
            if (changed.count !== 1) throw new Error('An existing Pin changed while applying its launch description.');
          }
        } else {
          const key = `catalogue:2026-11-17:${pin.etsyListingId}:${boardId}`;
          row = await prisma.pinterestPin.findUnique({ where: { publicationKey: key } });
          if (!row) row = await prisma.$transaction(async tx => {
            const created = await tx.pinterestPin.create({ data: { listingId: pin.listingId, imageId: pin.imageId, boardId, creativeType: pin.creativeType, title: pin.title, description: pin.description, destinationUrl: pin.destinationUrl, status: 'DRAFT', publicationKey: key } });
            await attachPinCreativeStorageKey(tx, created.id, pin.listingId, creatives.get(pin.key).creativeStorageKey);
            return created;
          });
          if (row.listingId !== pin.listingId || row.boardId !== boardId || row.imageId !== pin.imageId || row.title !== pin.title || row.description !== pin.description || row.destinationUrl !== pin.destinationUrl || row.pinterestPinId) throw new Error('A previously created launch Pin changed.');
        }
        applied.push({ key: pin.key, id: row.id, boardId, listingId: pin.listingId });
        if (applied.length % 50 === 0) console.log(JSON.stringify({ stage: 'drafts', saved: applied.length, total: plan.pins.length }));
      }
      await save('applied-drafts.json', { appliedAt: new Date().toISOString(), pins: applied });
      console.log(JSON.stringify({ stage: 'drafts-complete', saved: applied.length, pinterestPinsPublished: 0 }));
    }

    if (flags.has('--schedule')) {
      const applied = await read('applied-drafts.json');
      if (applied.pins.length !== plan.pins.length) throw new Error('Every launch Pin must be prepared before scheduling.');
      const scheduled = [];
      for (const preview of previews) {
        const ordered = orderedPins(plan.pins.filter(pin => pin.boardKey === preview.key));
        const selected = ordered.map(pin => applied.pins.find(saved => saved.key === pin.key));
        if (selected.some(pin => !pin) || new Set(selected.map(pin => pin.boardId)).size !== 1) throw new Error('The reviewed board mapping changed.');
        const existing = await prisma.pinterestPin.findMany({ where: { id: { in: selected.map(pin => pin.id) } }, select: { id: true, status: true, description: true, destinationUrl: true, campaignId: true, scheduledAt: true } });
        for (const pin of ordered) { const row = existing.find(row => row.id === applied.pins.find(saved => saved.key === pin.key).id); if (!row || row.description !== pin.description || row.destinationUrl !== pin.destinationUrl) throw new Error('A launch Pin changed before scheduling.'); }
        let campaign;
        if (existing.every(pin => pin.status === 'SCHEDULED') && new Set(existing.map(pin => pin.campaignId)).size === 1) {
          campaign = await prisma.pinterestCampaign.findUniqueOrThrow({ where: { id: existing[0].campaignId } });
          if (campaign.name !== `Pinterest launch · ${preview.name} · 17 November 2026` || existing.some(pin => !pin.scheduledAt || pin.scheduledAt < new Date('2026-11-17T00:00:00Z'))) throw new Error('A different schedule is already active.');
        } else campaign = await schedulePinterestPins({ name: `Pinterest launch · ${preview.name} · 17 November 2026`, boardId: selected[0].boardId, pinIds: selected.map(pin => pin.id), startDate: plan.startDate, pinsPerDay: 2, timeZone: plan.timeZone });
        scheduled.push({ boardName: preview.name, campaignId: campaign.id, pins: selected.length, firstScheduledAt: preview.firstScheduledAt, lastScheduledAt: preview.lastScheduledAt });
        await save('scheduled.json', { scheduledAt: new Date().toISOString(), timeZone: plan.timeZone, pinsPerBoardPerDay: 2, boards: scheduled });
        console.log(JSON.stringify({ stage: 'scheduled-board', ...scheduled.at(-1) }));
      }
    }
  } finally { globalThis.fetch = nativeFetch; s3?.destroy(); await prisma.$disconnect(); await globalThis.prisma?.$disconnect(); await vite.close(); }
}

main().catch(error => { console.error(JSON.stringify({ message: error.message, cause: { name: error.cause?.name, code: error.cause?.code } })); process.exitCode = 1; });
