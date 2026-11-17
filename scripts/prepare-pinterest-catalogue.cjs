// Resumable catalogue preparation. No stage in this script calls Pinterest's /pins endpoint.
// Defaults to a read-only local plan; network reads, copy generation and writes require explicit flags.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const directory = path.resolve('output/pinterest/2026-11-launch');
const flags = new Set(process.argv.slice(2));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const save = (name, value) => fs.writeFile(path.join(directory, name), json(value));
const read = async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
const definitions = [
  { section: 'Bugs Wall Art', key: 'bugs', name: 'Bugs Nursery Prints & Wall Art', description: 'Bugs and insect wall art for children’s rooms, featuring physical prints and clearly labelled digital downloads.' },
  { section: 'Dinosaur Wall Art', key: 'dinosaurs', name: 'Dinosaurs Nursery Prints & Wall Art', description: 'Dinosaur nursery wall art and children’s room inspiration, with physical prints and clearly labelled digital downloads.' },
  { section: 'Jungle & Safari Wall Art', key: 'safari', name: 'Safari Animal Nursery Wall Art', description: 'Jungle and safari animal nursery wall art, with physical prints and clearly labelled digital downloads.' },
  { section: 'Woodland Wall Art', key: 'woodland', name: 'Woodland Nursery Prints & Decor', description: 'Woodland animals and nursery decor inspiration, with physical prints and clearly labelled digital downloads.' },
  { section: 'Farm Animal Wall Art', key: 'farm', name: 'Farm Animal Nursery Prints', description: 'Farm animal nursery artwork and countryside decor ideas, with physical prints and clearly labelled digital downloads.' },
  { section: 'Sea Creatures Wall Art', key: 'sea', name: 'Sea Creature Nursery Wall Art', description: 'Sea creature wall art and ocean-inspired children’s rooms, with physical prints and clearly labelled digital downloads.' },
  { section: 'Scarecrows', key: 'scarecrows', name: 'Scarecrow & Autumn Wall Art', description: 'Characterful scarecrow artwork and autumn wall decor, with physical prints and clearly labelled digital downloads.' },
];

function destinationId(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && ['etsy.com', 'www.etsy.com'].includes(parsed.hostname.toLowerCase()) ? parsed.pathname.match(/\/(?:listing)\/(\d+)(?:\/|$)/)?.[1] : undefined; }
  catch { return undefined; }
}

async function concurrent(items, concurrency, action) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) { const index = cursor++; if (index >= items.length) return; await action(items[index], index); }
  }));
}

async function main() {
  await fs.mkdir(directory, { recursive: true });
  const prisma = new PrismaClient();
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null }, resolve: { alias: { '@': process.cwd() } } });
  try {
    const { buildPinterestDescriptionSource } = await vite.ssrLoadModule('/lib/pinterest/description-service.ts');
    const { validatePinDescription } = await vite.ssrLoadModule('/lib/pinterest/description.ts');
    const { generatePinterestDescription } = await vite.ssrLoadModule('/lib/pinterest/bedrock-copy.ts');
    const rows = await prisma.etsyListing.findMany({ where: { isLocal: true }, include: {
      images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
      products: { select: { productType: true, frameKey: true } }, productConfig: true,
      priceMappings: true, subSection: { include: { shopSection: { include: { shop: true } } } }, sourceSection: true,
    } });
    const pins = await prisma.pinterestPin.findMany({ orderBy: { id: 'asc' } });
    const boards = await prisma.pinterestBoard.findMany();
    const connection = await prisma.pinterestConnection.findUnique({ where: { id: 1 }, select: { username: true, environment: true } });
    if (connection?.environment !== 'production' || process.env.PINTEREST_ENVIRONMENT !== 'production' || connection.username !== 'davef0498') throw new Error('Expected the authorized production Pinterest account davef0498.');

    if (flags.has('--audit')) {
      const { getValidEtsyAccessToken, getEtsyKeystring } = await vite.ssrLoadModule('/lib/etsy-oauth.ts');
      const token = await getValidEtsyAccessToken();
      if (!process.env.ETSY_SHARED_SECRET) throw new Error('Etsy API configuration is missing.');
      const products = [];
      for (const shopId of [...new Set(rows.map(row => row.shopId))]) {
        for (let offset = 0; ; offset += 100) {
          const response = await fetch(`https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/listings?state=active&limit=100&offset=${offset}&includes=Images`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'x-api-key': `${getEtsyKeystring()}:${process.env.ETSY_SHARED_SECRET}` }, signal: AbortSignal.timeout(30000),
          });
          if (!response.ok) throw new Error(`Etsy active catalogue read failed (${response.status}).`);
          const page = await response.json();
          if (!Array.isArray(page.results)) throw new Error('Etsy returned an incomplete active catalogue.');
          products.push(...page.results);
          console.log(JSON.stringify({ stage: 'etsy-audit', read: products.length, total: page.count }));
          if (page.results.length < 100) break;
        }
      }
      const { pinterestRequest } = await vite.ssrLoadModule('/lib/pinterest/client.ts');
      const account = await pinterestRequest('/user_account');
      if (account.username !== connection.username) throw new Error('The active Pinterest account changed.');
      const remoteBoards = [];
      let bookmark;
      do {
        const page = await pinterestRequest(`/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`);
        remoteBoards.push(...page.items); bookmark = page.bookmark;
      } while (bookmark);
      for (const board of boards) if (!remoteBoards.some(remote => remote.id === board.pinterestBoardId && remote.privacy === 'PUBLIC')) throw new Error(`Public Pinterest board is unavailable: ${board.name}`);
      await save('remote-audit.json', { checkedAt: new Date().toISOString(), account: { username: account.username, environment: 'production' }, products, boards: remoteBoards });
    }

    const audit = await read('remote-audit.json');
    if (Date.now() - new Date(audit.checkedAt).getTime() > 24 * 3600000) throw new Error('Refresh the remote catalogue audit before preparing this launch.');
    const remoteProducts = new Map(audit.products.map(product => [String(product.listing_id), product]));
    const proposals = [];
    const skipped = [];
    const byId = new Map(rows.map(row => [row.id, row]));
    const represented = new Set(pins.map(pin => destinationId(pin.destinationUrl)).filter(Boolean));
    for (const listing of rows) {
      const section = listing.subSection?.shopSection.title ?? listing.sourceSection?.title ?? 'Uncategorised';
      const board = definitions.find(item => item.section === section);
      const variants = [
        { variant: 'print', id: listing.etsyId, state: listing.state, url: listing.url },
        { variant: 'download', id: listing.etsyDownloadId, state: listing.etsyDownloadState, url: listing.etsyDownloadUrl },
        { variant: 'customised', id: listing.etsyCustomisedId, state: listing.etsyCustomisedState, url: listing.etsyCustomisedUrl },
      ];
      let included = 0;
      for (const variant of variants) {
        const remote = remoteProducts.get(variant.id);
        if (!variant.id || variant.state !== 'active' || !variant.url || !remote || remote.state !== 'active') continue;
        if (!board) throw new Error(`An active product has no board mapping: ${section}`);
        if (destinationId(variant.url) !== variant.id) throw new Error(`Invalid saved Etsy link: artwork ${listing.id}/${variant.variant}`);
        if (!listing.images.length || !listing.thumbnailFileName) throw new Error(`Artwork ${listing.id} has incomplete images.`);
        const existing = pins.filter(pin => destinationId(pin.destinationUrl) === variant.id);
        if (existing.some(pin => pin.listingId !== listing.id)) throw new Error('An Etsy destination belongs to more than one artwork.');
        const digital = variant.variant === 'download' || remote.listing_type === 'download' || remote.type === 'download';
        const image = digital ? listing.images.find(image => image.rank === 14) ?? listing.images[0] : listing.images.find(image => image.rank === 1) ?? listing.images[0];
        const add = pin => {
          const source = buildPinterestDescriptionSource(listing, board.name, variant.url, pin?.creativeType ?? (digital ? 'digital_download' : 'product_detail'));
          if ((source.context.destinationType === 'digital') !== digital) throw new Error('Etsy destination product type changed.');
          source.context.listingTitle = remote.title;
          proposals.push({ key: pin ? `pin-${pin.id}` : `listing-${listing.id}-${variant.variant}`, listingId: listing.id, etsyListingId: variant.id, destinationVariant: digital ? 'digital' : 'physical', variant: variant.variant,
            destinationUrl: variant.url, boardKey: board.key, boardName: board.name, boardId: boards.find(saved => saved.name === board.name)?.id ?? null,
            existingPinId: pin?.id ?? null, existingUpdatedAt: pin?.updatedAt ?? null, existingDescription: pin?.description ?? null,
            creativeType: pin?.creativeType ?? (digital ? 'digital_download' : 'product_detail'), imageId: pin?.imageId ?? image.id,
            title: pin?.title ?? Array.from(remote.title.replace(/\s+/g, ' ').trim()).slice(0, 100).join(''), context: source.context,
            needsCopy: !pin || pin.description.includes('Printable wall art for a warm, characterful home.'), needsCreative: !pin,
          });
        };
        if (existing.length) existing.forEach(add); else if (!represented.has(variant.id)) add(null);
        included++;
      }
      if (!included) skipped.push({ listingId: listing.id, title: listing.title, section, reason: 'No locally linked product confirmed active on Etsy.' });
    }
    const missingRemote = audit.products.filter(product => !rows.some(row => [row.etsyId, row.etsyDownloadId, row.etsyCustomisedId].includes(String(product.listing_id))));
    const manifest = { schemaVersion: 1, preparedAt: new Date().toISOString(), account: connection, startDate: '2026-11-17', timeZone: 'Europe/London', pinsPerBoardPerDay: 2, boards: definitions.filter(board => proposals.some(pin => pin.boardKey === board.key)), pins: proposals, skipped, unmappedRemoteProducts: missingRemote.map(product => ({ id: product.listing_id, title: product.title })) };
    await save('plan.json', manifest);
    console.log(JSON.stringify({ stage: 'plan', pins: proposals.length, newPins: proposals.filter(pin => !pin.existingPinId).length, newDescriptions: proposals.filter(pin => pin.needsCopy).length, activeProductDestinations: new Set(proposals.map(pin => pin.etsyListingId)).size, boards: manifest.boards.length, skippedArtworks: skipped.length, unmappedRemoteProducts: missingRemote.length }));

    if (flags.has('--copy')) {
      await fs.mkdir(path.join(directory, 'copy'), { recursive: true });
      let completed = 0;
      const failures = [];
      await concurrent(proposals, 4, async pin => {
        try {
          const inputHash = sha(json(pin.context));
          const file = path.join(directory, 'copy', `${pin.key}.json`);
          let saved;
          try { saved = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
          if (!pin.needsCopy) {
            // Previously reviewed copy is authoritative, even if an older cache exists.
            await fs.writeFile(file, json({ inputHash, description: validatePinDescription(pin.existingDescription), source: 'Previously reviewed copy', generatedAt: new Date().toISOString() }));
          } else if (saved?.inputHash === inputHash && typeof saved.description === 'string') validatePinDescription(saved.description);
          else {
            let description = pin.existingDescription;
            if (pin.needsCopy) {
              for (let attempt = 0; ; attempt++) {
                try { description = await generatePinterestDescription(pin.context); break; }
                catch (error) {
                  if (attempt >= 2 || !/Throttl|ServiceUnavailable|Timeout|could not generate|empty Pinterest|after two attempts/i.test(`${error.message} ${error.cause?.name ?? ''}`)) throw error;
                  await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2500));
                }
              }
            }
            await fs.writeFile(file, json({ inputHash, description: validatePinDescription(description), source: pin.needsCopy ? 'AWS Bedrock' : 'Previously reviewed copy', generatedAt: new Date().toISOString() }));
          }
          completed++;
          if (completed % 10 === 0 || completed === proposals.length) console.log(JSON.stringify({ stage: 'copy', completed, total: proposals.length }));
        } catch (error) { failures.push({ key: pin.key, message: error.message }); console.log(JSON.stringify({ stage: 'copy-failed', key: pin.key, message: error.message })); }
      });
      await save('copy-status.json', { completed, failures });
      if (failures.length) throw new Error(`${failures.length} descriptions need attention; saved valid descriptions are retained for resuming.`);
    }
  } finally { await prisma.$disconnect(); await globalThis.prisma?.$disconnect(); await vite.close(); }
}

main().catch(error => { console.error(JSON.stringify({ message: error.message, cause: { name: error.cause?.name, code: error.cause?.code } })); process.exitCode = 1; });
