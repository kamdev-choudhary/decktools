import { createFonts } from '@deck/ui/lib/fonts';

export { MONO_FONTS, SANS_FONTS, type MonoFont, type SansFont } from '@deck/ui/lib/fonts';

/** Font preferences, stored under the redisdeck.font.* keys. */
export const { readFonts, applyFonts, useFonts } = createFonts('redisdeck');
