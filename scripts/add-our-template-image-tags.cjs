const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const DEFAULT_TEMPLATE_IMAGE_TAGS = [
  'Living Room', 'Dining Room', 'Nursery', 'Kids Room', 'Studio', 'Landing Image',
  'Dinosaurs', 'Farm Animals', 'Sea Creatures', 'Woodland Animals', 'Bugs & Insects',
  'Jungle Animals', 'Safari Animals', 'Set of 3', 'Vintage Art',
  'Minimalist Room', 'Modern Room', 'Dark Room',
  'Kitchen', 'Bathroom', 'Toilet', 'Hallway', 'Plant(s)', 'Spot Light', 'Photo Border',
  'Candle(s)', 'Book(s)', 'Light Room', 'Coffee Table', 'Frame Black', 'Frame White', 'Frame Oak', 'Art',
  'Bedroom', 'Study', 'Traditional',
];

async function migrateTemplateImageTags(prisma) {
  // Match the existing scene ID's collation, including on databases created before this migration.
  const columns = await prisma.$queryRawUnsafe(
    'SELECT CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    'our_template_images', 'id');
  const source = columns[0];
  if (!source) throw new Error('Run npm run db:our-template-images before adding template image tags.');
  if (![source.characterSet, source.collationName].every((value) => typeof value === 'string' && /^[a-zA-Z0-9_]+$/.test(value))) {
    throw new Error('The template image ID column has an unsupported character set or collation.');
  }
  const idType = `VARCHAR(36) CHARACTER SET ${source.characterSet} COLLATE ${source.collationName}`;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS our_template_image_tags (
    id ${idType} NOT NULL PRIMARY KEY,
    name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    normalizedName VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY our_template_image_tags_normalizedName_key (normalizedName)
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS our_template_image_tag_links (
    templateImageId ${idType} NOT NULL,
    tagId ${idType} NOT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (templateImageId, tagId),
    INDEX our_template_image_tag_links_tagId_idx (tagId),
    CONSTRAINT our_template_image_tag_links_scene_fkey FOREIGN KEY (templateImageId) REFERENCES our_template_images(id) ON DELETE CASCADE,
    CONSTRAINT our_template_image_tag_links_tag_fkey FOREIGN KEY (tagId) REFERENCES our_template_image_tags(id) ON DELETE CASCADE
  )`);
  await prisma.$transaction(async (transaction) => {
    for (const name of DEFAULT_TEMPLATE_IMAGE_TAGS) {
      await transaction.$executeRawUnsafe(
        'INSERT INTO our_template_image_tags (id, name, normalizedName) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE normalizedName = normalizedName',
        randomUUID(), name, name.toLocaleLowerCase('en-GB'));
    }
  });
}

async function main() {
  const databaseLine = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((line) => line.startsWith('DATABASE_URL='));
  if (!databaseLine) throw new Error('DATABASE_URL is missing.');
  process.env.DATABASE_URL = databaseLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await migrateTemplateImageTags(prisma);
    console.log(`Our Template Image tags are ready; the ${DEFAULT_TEMPLATE_IMAGE_TAGS.length} default tags are present.`);
  } finally { await prisma.$disconnect(); }
}

module.exports = { DEFAULT_TEMPLATE_IMAGE_TAGS, migrateTemplateImageTags };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
