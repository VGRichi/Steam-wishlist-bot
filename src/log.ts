// One JSON object per line, so Vercel's log search can filter by field.
type Fields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', msg: string, fields: Fields = {}) {
  const entry: Fields = { level, msg, ...fields };
  if (fields.err instanceof Error) {
    entry.err = { message: fields.err.message, stack: fields.err.stack };
  }
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
