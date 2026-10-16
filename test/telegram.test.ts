import { describe, expect, it } from 'vitest';
import { decode, encode, type Callback } from '../src/bot/callbacks';
import { parseCommand } from '../src/bot/handlers';
import { secretsMatch } from '../src/security';
import { escapeHtml, flagEmoji, truncate } from '../src/telegram/format';

describe('callback data', () => {
  const samples: Callback[] = [
    { type: 'add', appId: 1091500 },
    { type: 'game', appId: 570 },
    { type: 'alert', appId: 2_147_483_647 },
    { type: 'set', mode: 'both', appId: 292030 },
    { type: 'remove', appId: 1 },
    { type: 'list' },
    { type: 'clear' },
    { type: 'clearYes' },
    { type: 'clearNo' },
  ];

  it.each(samples)('round-trips %j within 64 bytes', (cb) => {
    const data = encode(cb);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(decode(data)).toEqual(cb);
  });

  it.each(['', 'add', 'add:', 'add:abc', 'add:-1', 'add:0', 'add:1:2', 'add:99999999999', 'set:pct', 'set:huge:5', 'clear:maybe', 'nope:1', 'list:1'])(
    'rejects %j',
    (data) => expect(decode(data)).toBeNull(),
  );

  it('still understands v1 payload shapes as invalid rather than crashing', () => {
    expect(decode('filter:any')).toBeNull();
    expect(decode('removegame:570')).toBeNull();
    expect(decode('clearlist:confirm')).toBeNull();
  });
});

describe('parseCommand', () => {
  it('parses commands, bot mentions and arguments', () => {
    expect(parseCommand('/add cyberpunk 2077')).toEqual({ command: 'add', arg: 'cyberpunk 2077' });
    expect(parseCommand('/list@SteamWishlistBot')).toEqual({ command: 'list', arg: '' });
    expect(parseCommand('/ADD   hades ')).toEqual({ command: 'add', arg: 'hades' });
  });

  it('maps v1 command names', () => {
    expect(parseCommand('/addgame portal')?.command).toBe('add');
    expect(parseCommand('/checknow')?.command).toBe('check');
    expect(parseCommand('/clearlist')?.command).toBe('clear');
  });

  it('ignores unknown commands and plain text', () => {
    expect(parseCommand('/nope')).toBeNull();
    expect(parseCommand('hello')).toBeNull();
  });
});

describe('format helpers', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('Command & Conquer <Remastered>')).toBe('Command &amp; Conquer &lt;Remastered&gt;');
  });

  it('builds flag emoji', () => {
    expect(flagEmoji('az')).toBe('🇦🇿');
    expect(flagEmoji(null)).toBe('🏳️');
    expect(flagEmoji('USA')).toBe('🏳️');
  });

  it('truncates long labels', () => {
    expect(truncate('short')).toBe('short');
    expect(truncate('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('secretsMatch', () => {
  it('requires an exact, non-empty match', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abd', 'abc')).toBe(false);
    expect(secretsMatch('ab', 'abc')).toBe(false);
    expect(secretsMatch(null, 'abc')).toBe(false);
    expect(secretsMatch('', '')).toBe(false);
  });
});
