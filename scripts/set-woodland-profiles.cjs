const { PrismaClient } = require('@prisma/client');

if (process.loadEnvFile) process.loadEnvFile('.env.local');
const prisma = new PrismaClient();

const profiles = new Map([
  ['Fox', { name: 'Fox', description: 'curious, clever, playful' }],
  ['Fawn', { name: 'Fawn', description: 'gentle, sweet, peaceful' }],
  ['Deer', { name: 'Deer', description: 'graceful, calm, elegant' }],
  ['Bunny', { name: 'Bunny', description: 'soft, cute, innocent' }],
  ['Hare', { name: 'Hare', description: 'playful, lively, magical' }],
  ['Squirrel', { name: 'Squirrel', description: 'cheeky, energetic, fun' }],
  ['Hedgehog', { name: 'Hedgehog', description: 'cosy, tiny, charming' }],
  ['Owl', { name: 'Owl', description: 'wise, calm, magical' }],
  ['Bear Cub', { name: 'Bear Cub', description: 'cuddly, gentle, comforting' }],
  ['Badger', { name: 'Badger', description: 'friendly, earthy, cosy' }],
  ['Racoon', { name: 'Raccoon', description: 'mischievous, playful, cute' }],
  ['Mouse', { name: 'Mouse', description: 'tiny, delicate, sweet' }],
  ['Dormouse', { name: 'Dormouse', description: 'sleepy, soft, adorable' }],
  ['Chipmunk', { name: 'Chipmunk', description: 'cheerful, bright, lively' }],
  ['Beaver', { name: 'Beaver', description: 'hardworking, friendly, rounded' }],
  ['Otter', { name: 'Otter', description: 'playful, joyful, charming' }],
  ['Red Squirrel', { name: 'Red Squirrel', description: 'classic woodland feel' }],
  ['Wolf Pup', { name: 'Wolf Pup', description: 'fluffy, adventurous, friendly' }],
  ['Lynx Kitten', { name: 'Lynx Kitten', description: 'soft, wild, elegant' }],
  ['Wildcat Kitten', { name: 'Wildcat Kitten', description: 'curious, cute, woodland explorer' }],
  ['Skunk', { name: 'Skunk', description: 'funny, sweet, not scary' }],
  ['Mole', { name: 'Mole', description: 'cosy, shy, gentle' }],
  ['Vole', { name: 'Vole', description: 'tiny, sweet, soft' }],
  ['Shrew', { name: 'Shrew', description: 'small, delicate, curious' }],
  ['Robin', { name: 'Robin', description: 'cheerful, colourful, classic' }],
  ['Blue tit', { name: 'Blue Tit', description: 'bright, pretty, delicate' }],
  ['Woodpecker', { name: 'Woodpecker', description: 'fun, bold, nature-inspired' }],
  ['Wren', { name: 'Wren', description: 'tiny, sweet, simple' }],
  ['Blackbird', { name: 'Blackbird', description: 'gentle, musical, calm' }],
  ['Pheasant', { name: 'Pheasant', description: 'colourful, elegant, woodland edge' }],
  ['Frog', { name: 'Frog', description: 'funny, cheerful, playful' }],
  ['Toad', { name: 'Toad', description: 'cosy, storybook, charming' }],
  ['Newt', { name: 'Newt', description: 'unusual, cute, nature-themed' }],
  ['Snail', { name: 'Snail', description: 'slow, whimsical, sweet' }],
  ['Butterfly', { name: 'Butterfly', description: 'soft, pretty, decorative' }],
  ['Moth', { name: 'Moth', description: 'gentle, magical, nighttime woodland' }],
  ['Ladybird', { name: 'Ladybird', description: 'bright, simple, cheerful' }],
  ['Dragonfly', { name: 'Dragonfly', description: 'delicate, elegant, magical' }],
  ['Bee', { name: 'Bee', description: 'happy, friendly, nature-inspired' }],
  ['Caterpillar', { name: 'Caterpillar', description: 'cute, playful, simple' }],
]);

async function main() {
  const listings = await prisma.etsyListing.findMany({
    where: { subSection: { shopSection: { title: 'Woodland Wall Art' } } },
    select: { id: true, localDirectoryName: true },
  });
  const listingByStorageName = new Map(listings.map((listing) => [listing.localDirectoryName, listing]));
  const missing = [...profiles.keys()].filter((name) => !listingByStorageName.has(name));
  const unexpected = listings.flatMap((listing) => listing.localDirectoryName && !profiles.has(listing.localDirectoryName) ? [listing.localDirectoryName] : []);
  if (missing.length || unexpected.length || listings.length !== profiles.size) {
    throw new Error(`Profile/listing mismatch. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
  }

  await prisma.$transaction([...profiles].map(([storageName, profile]) => {
    const listing = listingByStorageName.get(storageName);
    return prisma.etsyListingLocalProfile.upsert({
      where: { listingId: listing.id },
      update: profile,
      create: { listingId: listing.id, ...profile },
    });
  }));
  console.log(`Updated ${profiles.size} woodland local profiles.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
