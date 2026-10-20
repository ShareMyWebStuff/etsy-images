const path = require('node:path');
const sharp = require('sharp');

const root = path.join(process.cwd(), 'public', 'assets', 'printshrimp-frames');
const finishes = [
  {
    name: 'black',
    input: path.join(root, 'originals', 'black-framed.png'),
    extract: { left: 360, top: 130, width: 620, height: 70 },
  },
  {
    name: 'white',
    input: path.join(root, 'originals', 'white-framed.png'),
    extract: { left: 360, top: 145, width: 620, height: 65 },
  },
  {
    name: 'oak',
    input: path.join(root, 'originals', 'oak-framed.png'),
    extract: { left: 480, top: 155, width: 700, height: 90 },
  },
];

async function run() {
  for (const finish of finishes) {
    const horizontal = await sharp(finish.input)
      .extract(finish.extract)
      .resize(1024, 96, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await sharp(horizontal).toFile(path.join(root, 'derived', `${finish.name}-rail-horizontal.png`));
    await sharp(horizontal).rotate(90).toFile(path.join(root, 'derived', `${finish.name}-rail-vertical.png`));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

