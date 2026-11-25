import pc from 'picocolors';

/** Terminal colors (picocolors). They turn off automatically when output isn't a TTY or NO_COLOR is set. */
export const colors = pc;

/** Status glyphs used in startup and error output. */
export const symbols = {
  ok: pc.green('✓'),
  arrow: pc.cyan('➜'),
  fail: pc.red('✗'),
  warn: pc.red('⚠'),
};

/** A dimmed, fixed-width label so values line up in a column. */
export const label = (s: string, width = 12): string => pc.dim(s.padEnd(width));

/** Print an unrecoverable error in the CLI style ("✗ message", optional detail lines). */
export function printFatal(message: string, detail?: string): void {
  const body = detail ? `${message}\n    ${detail}` : message;
  console.error(`\n  ${symbols.fail} ${body}\n`);
}

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** Runtime logging prefixed with the tool name, e.g. "[pgdeck] idle client error: ...". */
export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
