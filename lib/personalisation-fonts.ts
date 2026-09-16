export type PersonalisationFont = {
  id: string;
  displayName: string;
  family: string;
  weight: 400 | 700;
  assetPath: string;
  downloadFileName: string;
  variable: boolean;
};

export const PERSONALISATION_FONTS: readonly PersonalisationFont[] = [
  { id: 'fredoka', displayName: 'Fredoka', family: 'Fredoka', weight: 400, assetPath: '/fonts/fredoka/Fredoka-Regular.ttf', downloadFileName: 'Fredoka-Regular.ttf', variable: true },
  { id: 'fredoka-bold', displayName: 'Fredoka Bold', family: 'Fredoka', weight: 700, assetPath: '/fonts/fredoka/Fredoka-Bold.ttf', downloadFileName: 'Fredoka-Bold.ttf', variable: false },
  { id: 'baloo-2', displayName: 'Baloo 2', family: 'Baloo 2', weight: 400, assetPath: '/fonts/baloo2/Baloo2-Regular.ttf', downloadFileName: 'Baloo2-Regular.ttf', variable: true },
  { id: 'nunito', displayName: 'Nunito', family: 'Nunito', weight: 400, assetPath: '/fonts/nunito/Nunito-Regular.ttf', downloadFileName: 'Nunito-Regular.ttf', variable: true },
  { id: 'quicksand', displayName: 'Quicksand', family: 'Quicksand', weight: 400, assetPath: '/fonts/quicksand/Quicksand-Regular.ttf', downloadFileName: 'Quicksand-Regular.ttf', variable: true },
  { id: 'poppins', displayName: 'Poppins', family: 'Poppins', weight: 400, assetPath: '/fonts/poppins/Poppins-Regular.ttf', downloadFileName: 'Poppins-Regular.ttf', variable: false },
  { id: 'montserrat', displayName: 'Montserrat', family: 'Montserrat', weight: 400, assetPath: '/fonts/montserrat/Montserrat-Regular.ttf', downloadFileName: 'Montserrat-Regular.ttf', variable: true },
  { id: 'playfair-display', displayName: 'Playfair Display', family: 'Playfair Display', weight: 400, assetPath: '/fonts/playfairdisplay/PlayfairDisplay-Regular.ttf', downloadFileName: 'PlayfairDisplay-Regular.ttf', variable: true },
  { id: 'libre-baskerville', displayName: 'Libre Baskerville', family: 'Libre Baskerville', weight: 400, assetPath: '/fonts/librebaskerville/LibreBaskerville-Regular.ttf', downloadFileName: 'LibreBaskerville-Regular.ttf', variable: true },
  { id: 'pacifico', displayName: 'Pacifico', family: 'Pacifico', weight: 400, assetPath: '/fonts/pacifico/Pacifico-Regular.ttf', downloadFileName: 'Pacifico-Regular.ttf', variable: false },
  { id: 'caveat', displayName: 'Caveat', family: 'Caveat', weight: 400, assetPath: '/fonts/caveat/Caveat-Regular.ttf', downloadFileName: 'Caveat-Regular.ttf', variable: true },
] as const;

export const DEFAULT_PERSONALISATION_FONT_ID = 'nunito';

export function getPersonalisationFont(fontId: string) {
  return PERSONALISATION_FONTS.find((font) => font.id === fontId) ?? null;
}
