const { PrismaClient } = require('@prisma/client');

if (process.loadEnvFile) process.loadEnvFile('.env.local');
const prisma = new PrismaClient();

const profiles = new Map([
  ['Alpaca', 'fluffy, quirky, charming'],
  ['Barn Cat', 'cosy, curious, sweet'],
  ['Barn Owl', 'calm, wise, countryside feel'],
  ['Bee', 'cheerful, tiny, farm nature theme'],
  ['Bull', 'strong but friendly'],
  ['Bunny', 'cute, innocent, nursery-friendly'],
  ['Butterfly', 'pretty, soft, decorative'],
  ['Calf', 'sweet, soft, innocent'],
  ['Chick', 'tiny, fluffy, bright'],
  ['Cow', 'gentle, friendly, classic farm animal'],
  ['Donkey', 'gentle, funny, lovable'],
  ['Duck', 'sweet, simple, playful'],
  ['Duckling', 'soft, yellow, adorable'],
  ['Farm Dog', 'loyal, playful, happy'],
  ['Foal', 'playful, young, cute'],
  ['Goat', 'cheeky, playful, fun'],
  ['Goose', 'funny, bold, farmyard character'],
  ['Gosling', 'gentle, fluffy, cute'],
  ['Guinea Fowl', 'spotty, quirky, fun'],
  ['Guinea Pig', 'small, cute, cuddly'],
  ['Hen', 'cosy, classic farmyard feel'],
  ['Highland Cow', 'fluffy, charming, cosy'],
  ['Horse', 'graceful, calm, beautiful'],
  ['Kid', 'tiny, bouncy, cute'],
  ['Ladybird', 'bright, simple, cute'],
  ['Lamb', 'adorable, innocent, fluffy'],
  ['Llama', 'friendly, funny, expressive'],
  ['Mouse', 'tiny, sweet, storybook farmyard feel'],
  ['Mule', 'calm, hardworking, friendly'],
  ['Peacock', 'colourful, elegant, decorative'],
  ['Pig', 'cheerful, round, lovable'],
  ['Pigeon', 'gentle, peaceful, soft'],
  ['Piglet', 'tiny, sweet, playful'],
  ['Pony', 'sweet, small, child-friendly'],
  ['Quail', 'tiny, delicate, pretty'],
  ['Rabbit', 'soft, sweet, gentle'],
  ['Rooster', 'colourful, proud, cheerful'],
  ['Sheep', 'soft, cosy, peaceful'],
  ['Sheep Dog', 'clever, friendly, helpful'],
  ['Turkey', 'colourful, characterful, fun'],
]);

async function main() {
  const section = await prisma.etsyShopSection.findFirst({
    where: { title: 'Farm Animal Wall Art' },
    select: { id: true },
  });
  if (!section) throw new Error('Farm Animal Wall Art section not found.');

  const listings = await prisma.etsyListing.findMany({
    where: { subSection: { shopSectionId: section.id } },
    select: { id: true, localDirectoryName: true, title: true },
  });
  const listingByName = new Map(listings.map((listing) => [listing.localDirectoryName, listing]));
  const missing = [...profiles.keys()].filter((name) => !listingByName.has(name));
  const unexpected = listings.flatMap((listing) => listing.localDirectoryName && !profiles.has(listing.localDirectoryName) ? [listing.localDirectoryName] : []);
  if (missing.length || unexpected.length || listings.length !== profiles.size) {
    throw new Error(`Profile/listing mismatch. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
  }

  await prisma.$transaction([
    ...[...profiles].map(([name, description]) => {
      const listing = listingByName.get(name);
      return prisma.etsyListingLocalProfile.upsert({
        where: { listingId: listing.id },
        update: { name, description },
        create: { listingId: listing.id, name, description },
      });
    }),
    prisma.etsyListing.update({
      where: { id: listingByName.get('Rooster').id },
      data: { title: 'Rooster Nursery Wall Art | Woodland Printable | Colourful Kids Room Print' },
    }),
  ]);

  console.log(`Updated ${profiles.size} farm-animal local profiles and corrected the Rooster title.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
