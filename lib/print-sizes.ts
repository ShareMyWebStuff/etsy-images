export type PixelSize = { width: number; height: number };

const PRINT_SIZE_SEQUENCES: PixelSize[][] = [
  // ISO A-series at 300 DPI.
  [
    { width: 7016, height: 9933 },
    { width: 4961, height: 7016 },
    { width: 3508, height: 4961 },
    { width: 2480, height: 3508 },
    { width: 1748, height: 2480 },
    { width: 1240, height: 1748 },
  ],
  // 2:3 print ratio.
  [
    { width: 7200, height: 10800 },
    { width: 4800, height: 7200 },
    { width: 4200, height: 6300 },
    { width: 3600, height: 5400 },
    { width: 3000, height: 4500 },
    { width: 2400, height: 3600 },
    { width: 1800, height: 2700 },
    { width: 1200, height: 1800 },
  ],
  // 3:4 print ratio.
  [
    { width: 5400, height: 7200 },
    { width: 4500, height: 6000 },
    { width: 3600, height: 4800 },
    { width: 2700, height: 3600 },
    { width: 1800, height: 2400 },
  ],
  // 4:5 print ratio.
  [
    { width: 4800, height: 6000 },
    { width: 2400, height: 3000 },
    { width: 1200, height: 1500 },
  ],
  // 11:14 print ratio.
  [
    { width: 6600, height: 8400 },
    { width: 3300, height: 4200 },
  ],
];

export function getNextPrintSize(width: number | null | undefined, height: number | null | undefined): PixelSize | null {
  if (!width || !height) return null;

  const landscape = width > height;
  const portraitWidth = Math.min(width, height);
  const portraitHeight = Math.max(width, height);

  for (const sequence of PRINT_SIZE_SEQUENCES) {
    const index = sequence.findIndex(
      (size) => Math.abs(size.width - portraitWidth) <= 10 && Math.abs(size.height - portraitHeight) <= 10
    );

    if (index >= 0 && index < sequence.length - 1) {
      const target = sequence[index + 1];
      return landscape ? { width: target.height, height: target.width } : target;
    }
  }

  return null;
}
