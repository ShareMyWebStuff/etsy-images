// Imports the reviewed nursery batch as local drafts attached to sandbox boards.
// This script never calls Pinterest's /pins endpoint or schedules a Pin.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, createDecipheriv } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const sharp = require('sharp');

const directory = path.resolve(process.argv.slice(2).find(value => !value.startsWith('--')) || 'output/pinterest/2026-11-nursery');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) process.env.AWS_PROFILE = 'etsy-listings-app';
const bucket = process.env.ETSY_LISTINGS_S3_BUCKET || 'etsy-listings-216211142709-eu-west-2';
const s3 = new S3Client({ region: process.env.AWS_REGION || 'eu-west-2', maxAttempts: 2,
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 30000, socketTimeout: 30000, throwOnRequestTimeout: true }) });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function accessToken(connection) {
  if (!process.env.PINTEREST_ENCRYPTION_KEY) throw new Error('Pinterest encryption is not configured.');
  const [version, iv, tag, ciphertext] = connection.accessTokenEncrypted.split('.');
  if (version !== 'v1') throw new Error('Unsupported stored Pinterest credential.');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(process.env.PINTEREST_ENCRYPTION_KEY).digest(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'creative-manifest.json'), 'utf8'));
  if (manifest.pins.length !== 45 || manifest.boards.length !== 3) throw new Error('Expected the reviewed three-board, 45-Pin batch.');
  const listingIds = [...new Set(manifest.pins.map(pin => pin.listingId))];
  if (listingIds.length !== 15) throw new Error('Expected exactly 15 products.');
  const listings = await prisma.etsyListing.findMany({where:{id:{in:listingIds}},select:{id:true,state:true,url:true,etsyDownloadState:true,etsyDownloadUrl:true,images:{select:{id:true,rank:true}}}});
  const checksums = new Set();
  for (const pin of manifest.pins) {
    const listing = listings.find(item => item.id === pin.listingId);
    const digital = pin.destinationVariant === 'digital';
    if (!listing || (digital ? listing.etsyDownloadState : listing.state) !== 'active'
      || pin.destinationUrl !== (digital ? listing.etsyDownloadUrl : listing.url)) throw new Error(`The active Etsy destination changed for ${pin.id}.`);
    if (!/^https:\/\/www\.etsy\.com\/listing\/\d+\//.test(pin.destinationUrl)) throw new Error('A real Etsy listing URL is required.');
    if (pin.status !== 'DRAFT' || pin.title.length > 100 || pin.description.length > 500) throw new Error(`Invalid draft copy: ${pin.id}.`);
    if (!manifest.boards.some(board => board.key === pin.boardKey && board.name === pin.boardName)) throw new Error('Pin board is inconsistent.');
    const expectedRank = pin.creativeType === 'room_inspiration' ? 2 : pin.creativeType === 'product_detail' ? 1 : pin.creativeType === 'digital_download' ? 14 : 0;
    if (!listing.images.some(image => image.id === pin.imageId && image.rank === expectedRank)) throw new Error('Creative source does not match this product.');
    const file = fs.realpathSync(path.resolve(directory, pin.imageFile));
    const imagesDirectory = fs.realpathSync(path.join(directory, 'images')) + path.sep;
    if (!file.startsWith(imagesDirectory)) throw new Error('Creative must stay in the batch images directory.');
    const bytes = fs.readFileSync(file);
    const checksum = hash(bytes);
    const metadata = await sharp(bytes).metadata();
    if (checksum !== pin.sha256 || checksums.has(checksum) || metadata.width !== 1000 || metadata.height !== 1500
      || pin.creativeStorageKey !== `.pinterest-creatives/${pin.listingId}/${checksum}.png`) throw new Error('Creative integrity or dimensions are invalid.');
    checksums.add(checksum);
  }
  console.log(JSON.stringify({validated:true,boards:3,pins:45,products:15,dimensions:'1000x1500',apply}));
  if (!apply) return;

  const connection = await prisma.pinterestConnection.findUnique({where:{id:1}});
  if (!connection || connection.environment !== 'sandbox' || process.env.PINTEREST_ENVIRONMENT !== 'sandbox') {
    throw new Error('This batch importer only creates sandbox boards and local draft Pins.');
  }
  if (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt <= new Date()) throw new Error('Reconnect Pinterest before importing this batch.');
  const token = accessToken(connection);
  const api = async (endpoint, method = 'GET', body) => {
    if (!(method === 'GET' && (endpoint === '/user_account' || endpoint.startsWith('/boards?')))
      && !(method === 'POST' && endpoint === '/boards')) throw new Error('Only board creation and read operations are allowed.');
    const response = await fetch(`https://api-sandbox.pinterest.com/v5${endpoint}`, {
      method, headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
      body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error = await response.json().catch(()=>({}));
      throw new Error(`Pinterest board request failed (${response.status}): ${error.message || 'Please retry after checking the account.'}`);
    }
    return response.json();
  };
  const account = await api('/user_account');
  if (account.username !== connection.username) throw new Error('The connected Pinterest account changed.');
  const remoteBoards = [];
  let bookmark;
  do {
    const page = await api(`/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`);
    remoteBoards.push(...page.items);
    bookmark = page.bookmark;
  } while (bookmark);

  // Immutable, dedicated files keep Pinterest layouts separate from Etsy images.
  for (const [index, pin] of manifest.pins.entries()) {
    const bytes = fs.readFileSync(path.resolve(directory, pin.imageFile));
    if (hash(bytes) !== pin.sha256) throw new Error('A creative changed after validation; rerun the batch validation.');
    let head;
    try { head = await s3.send(new HeadObjectCommand({Bucket:bucket,Key:pin.creativeStorageKey})); }
    catch(error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
    if (head) {
      if (head.Metadata?.sha256 !== pin.sha256 || head.ContentLength !== bytes.length) throw new Error('A stored creative failed its immutable metadata check.');
    } else {
      await s3.send(new PutObjectCommand({Bucket:bucket,Key:pin.creativeStorageKey,Body:bytes,ContentType:'image/png',Metadata:{sha256:pin.sha256},IfNoneMatch:'*'}));
    }
    if ((index+1)%15===0) console.log(JSON.stringify({storedCreatives:index+1}));
  }

  const boards = [];
  for (const proposed of manifest.boards) {
    const matches = remoteBoards.filter(board => board.name.trim().toLowerCase() === proposed.name.trim().toLowerCase());
    if (matches.length > 1) throw new Error(`Duplicate Pinterest board name: ${proposed.name}.`);
    let remote = matches[0];
    if (!remote) {
      remote = await api('/boards', 'POST', {name:proposed.name,description:proposed.description,privacy:'PUBLIC'});
      remoteBoards.push(remote);
    }
    if (!/^\d+$/.test(remote.id)) throw new Error('Pinterest returned an invalid board ID.');
    const board = await prisma.pinterestBoard.upsert({where:{pinterestBoardId:remote.id},create:{pinterestBoardId:remote.id,name:remote.name,description:remote.description || proposed.description,privacy:remote.privacy || 'PUBLIC',pinCount:remote.pin_count || 0,lastSyncedAt:new Date()},update:{name:remote.name,description:remote.description || proposed.description,privacy:remote.privacy || 'PUBLIC',pinCount:remote.pin_count || 0,lastSyncedAt:new Date()}});
    boards.push({key:proposed.key,id:board.id,pinterestBoardId:board.pinterestBoardId,name:board.name});
    console.log(JSON.stringify({boardReady:board.name,environment:'sandbox'}));
  }

  const imported = await prisma.$transaction(async tx => {
    const rows = [];
    for (const pin of manifest.pins) {
      const board = boards.find(item => item.key === pin.boardKey);
      const publicationKey = [pin.listingId,pin.imageId,board.id,'draft'].join(':');
      const existing = await tx.pinterestPin.findUnique({where:{publicationKey}});
      if (existing && (existing.status !== 'DRAFT' || existing.pinterestPinId || existing.title !== pin.title
        || existing.description !== pin.description || existing.destinationUrl !== pin.destinationUrl
        || existing.listingId !== pin.listingId || existing.imageId !== pin.imageId || existing.boardId !== board.id
        || existing.creativeType !== pin.creativeType || existing.scheduledAt !== null || existing.campaignId !== null)) {
        throw new Error('An existing batch Pin was changed; it has been preserved.');
      }
      if (existing) {
        const saved = await tx.$queryRaw`SELECT creativeStorageKey FROM pinterest_pins WHERE id = ${existing.id}`;
        if (saved[0]?.creativeStorageKey && saved[0].creativeStorageKey !== pin.creativeStorageKey) {
          throw new Error('An existing draft already has a different reviewed creative; it has been preserved.');
        }
      }
      const row = existing || await tx.pinterestPin.create({data:{listingId:pin.listingId,imageId:pin.imageId,boardId:board.id,creativeType:pin.creativeType,title:pin.title,description:pin.description,destinationUrl:pin.destinationUrl,status:'DRAFT',scheduledAt:null,campaignId:null,publicationKey}});
      const changed = await tx.$executeRaw`UPDATE pinterest_pins SET creativeStorageKey = ${pin.creativeStorageKey} WHERE id = ${row.id} AND listingId = ${pin.listingId} AND status = 'DRAFT' AND pinterestPinId IS NULL`;
      if (changed === 0) {
        const saved = await tx.$queryRaw`SELECT id FROM pinterest_pins WHERE id = ${row.id} AND creativeStorageKey = ${pin.creativeStorageKey} AND status = 'DRAFT' AND pinterestPinId IS NULL`;
        if (saved.length !== 1) throw new Error('Creative attachment failed.');
      }
      rows.push({id:row.id,batchPinId:pin.id,boardId:board.id,listingId:pin.listingId,status:row.status,creativeStorageKey:pin.creativeStorageKey});
    }
    return rows;
  },{timeout:30000});
  const result = {createdAt:new Date().toISOString(),environment:'sandbox',boards,pins:imported,published:0,scheduled:0};
  fs.writeFileSync(path.join(directory,'import-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({importedDrafts:imported.length,boards:boards.length,environment:'sandbox',published:0,scheduled:0}));
}

main().catch(error=>{console.error(JSON.stringify({name:error.name,code:error.code,message:error.message}));process.exitCode=1}).finally(async()=>{s3.destroy();await prisma.$disconnect()});
