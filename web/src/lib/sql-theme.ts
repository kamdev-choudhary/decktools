import { tags as t } from '@lezer/highlight';
import { createTheme } from '@uiw/codemirror-themes';

/** CodeMirror themes using the Geist syntax palette, with a transparent background. */
const shared = {
  background: 'transparent',
  gutterBackground: 'transparent',
  gutterBorder: 'transparent',
  fontFamily: 'var(--font-mono)',
};

export const sqlThemeDark = createTheme({
  theme: 'dark',
  settings: {
    ...shared,
    foreground: '#ededed',
    caret: '#ededed',
    selection: '#ffffff26',
    selectionMatch: '#ffffff14',
    lineHighlight: '#ffffff08',
    gutterForeground: '#525252',
    gutterActiveForeground: '#a1a1a1',
  },
  styles: [
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#ff4d8d' },
    { tag: [t.string, t.special(t.string)], color: '#62c073' },
    { tag: [t.number, t.bool, t.null], color: '#52a8ff' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: '#737373', fontStyle: 'italic' },
    { tag: [t.typeName, t.standard(t.name)], color: '#c472fb' },
    { tag: [t.function(t.variableName)], color: '#c472fb' },
    { tag: [t.operator, t.punctuation], color: '#a1a1a1' },
    { tag: [t.special(t.name), t.propertyName], color: '#ffb224' },
  ],
});

export const sqlThemeLight = createTheme({
  theme: 'light',
  settings: {
    ...shared,
    foreground: '#171717',
    caret: '#171717',
    selection: '#0070f326',
    selectionMatch: '#0070f314',
    lineHighlight: '#00000006',
    gutterForeground: '#a8a8a8',
    gutterActiveForeground: '#666666',
  },
  styles: [
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#c41562' },
    { tag: [t.string, t.special(t.string)], color: '#107d32' },
    { tag: [t.number, t.bool, t.null], color: '#005ff2' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: '#8f8f8f', fontStyle: 'italic' },
    { tag: [t.typeName, t.standard(t.name)], color: '#7d00cc' },
    { tag: [t.function(t.variableName)], color: '#7d00cc' },
    { tag: [t.operator, t.punctuation], color: '#666666' },
    { tag: [t.special(t.name), t.propertyName], color: '#ab570a' },
  ],
});
