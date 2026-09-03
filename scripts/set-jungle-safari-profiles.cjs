const { PrismaClient } = require('@prisma/client');

if (process.loadEnvFile) process.loadEnvFile('.env.local');
const prisma = new PrismaClient();

const profiles = new Map([
  ['Alligator', 'sturdy, smiley, bold, and cool'],
  ['Anaconda', 'huge, wild, powerful, and exciting'],
  ['Anteater', 'curious, long-nosed, gentle, and quirky'],
  ['Antelope', 'graceful, quick, gentle, and elegant'],
  ['Armadillo', 'round, armoured, shy, and cute'],
  ['Baby Elephant', 'sweet, playful, clumsy, and adorable'],
  ['Baby Gorilla', 'gentle, curious, soft, and lovable'],
  ['Baby Sloth', 'sleepy, tiny, cosy, and adorable'],
  ['Beetle', 'glossy, tiny, colourful, and strong'],
  ['Boa Constrictor', 'strong, smooth, patterned, and bold'],
  ['Butterfly', 'colourful, gentle, pretty, and delicate'],
  ['Chameleon', 'colourful, clever, magical, and shy'],
  ['Cheetah', 'speedy, sleek, gentle, and energetic'],
  ['Chimpanzee', 'clever, friendly, expressive, and lively'],
  ['Crocodile', 'snappy, strong, ancient, and adventurous'],
  ['Dragonfly', 'shiny, magical, graceful, and light'],
  ['Elephant', 'gentle, wise, huge, and kind'],
  ['Flamingo', 'pink, graceful, elegant, and fancy'],
  ['Frog', 'jumpy, green, cheerful, and cute'],
  ['Gecko', 'tiny, sticky-toed, cute, and quick'],
  ['Giraffe', 'tall, graceful, spotty, and friendly'],
  ['Gorilla', 'strong, gentle, calm, and protective'],
  ['Hippo', 'round, smiley, big, and lovable'],
  ['Hummingbird', 'tiny, speedy, sparkling, and sweet'],
  ['Iguana', 'calm, green, scaly, and sunny'],
  ['Jaguar', 'powerful, mysterious, spotty, and wild'],
  ['Jaguar Cub', 'playful, spotty, curious, and cute'],
  ['Leaf Insect', 'clever, leafy, magical, and hidden'],
  ['Lemur', 'bouncy, bright-eyed, striped, and fun'],
  ['Leopard', 'graceful, spotty, clever, and calm'],
  ['Lion', 'strong, proud, golden, and royal'],
  ['Macaw', 'bright, beautiful, loud, and joyful'],
  ['Monkey', 'cheeky, playful, curious, and funny'],
  ['Monkey Baby', 'cheeky, cuddly, tiny, and playful'],
  ['Okapi', 'shy, stripy, rare, and magical'],
  ['Orangutan', 'wise, warm, orange, and lovable'],
  ['Pangolin', 'scaly, gentle, rare, and special'],
  ['Panther', 'smooth, shadowy, elegant, and cool'],
  ['Parrot', 'colourful, chatty, bright, and cheerful'],
  ['Peacock', 'colourful, proud, pretty, and magical'],
  ['Poison Dart Frog', 'colourful, tiny, bold, and eye-catching'],
  ['Python', 'big, patterned, calm, and impressive'],
  ['Rhino', 'strong, sturdy, calm, and impressive'],
  ['Sloth', 'sleepy, gentle, slow, and cosy'],
  ['Snake', 'slinky, smooth, mysterious, and graceful'],
  ['Tapir', 'unusual, gentle, stripy, and sweet'],
  ['Tiger', 'bold, striped, brave, and beautiful'],
  ['Tiger Cub', 'fluffy, brave, striped, and sweet'],
  ['Tortoise', 'calm, steady, peaceful, and old-souled'],
  ['Toucan', 'bold, tropical, colourful, and fun'],
  ['Tree Frog', 'tiny, bright, sticky-toed, and playful'],
  ['Turtle', 'gentle, slow, wise, and sweet'],
  ['Zebra', 'stripy, lively, bold, and beautiful'],
]);

const storageNames = new Map([
  ['Poison Dart Frog', 'Poisin Dart Frog'],
  ['Zebra', 'Zeebra'],
]);

async function main() {
  const section = await prisma.etsyShopSection.findFirst({
    where: { title: 'Jungle & Safari Wall Art' },
    select: { id: true },
  });
  if (!section) throw new Error('Jungle & Safari Wall Art section not found.');

  const listings = await prisma.etsyListing.findMany({
    where: { subSection: { shopSectionId: section.id } },
    select: { id: true, localDirectoryName: true },
  });
  const listingByName = new Map(listings.map((listing) => [listing.localDirectoryName, listing]));
  const acceptedStorageNames = new Set([...profiles.keys()].map((name) => storageNames.get(name) ?? name));
  const missing = [...profiles.keys()].filter((name) => !listingByName.has(storageNames.get(name) ?? name));
  const unexpected = listings.flatMap((listing) =>
    listing.localDirectoryName && !acceptedStorageNames.has(listing.localDirectoryName) ? [listing.localDirectoryName] : []
  );
  if (missing.length || unexpected.length || listings.length !== profiles.size) {
    throw new Error(`Profile/listing mismatch. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
  }

  await prisma.$transaction([...profiles].map(([name, description]) => {
    const listing = listingByName.get(storageNames.get(name) ?? name);
    return prisma.etsyListingLocalProfile.upsert({
      where: { listingId: listing.id },
      update: { name, description },
      create: { listingId: listing.id, name, description },
    });
  }));
  console.log(`Updated ${profiles.size} Jungle & Safari local profiles.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
