import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommandDoc, Reply } from '../src/shared/types.js';
import {
  caretLine,
  commandsIn,
  complete,
  danger,
  docForLine,
  prettyJson,
  replyToText,
} from '../web/src/lib/console.js';
import { refusal } from '../src/redis/console.js';

const doc = (name: string, extra: Partial<CommandDoc> = {}): CommandDoc => ({
  name,
  summary: '',
  syntax: '',
  group: '',
  since: '',
  flags: [],
  refused: null,
  container: false,
  ...extra,
});
const docs = [
  doc('get'),
  doc('getdel'),
  doc('getex'),
  doc('set'),
  doc('config', { container: true }),
  doc('config get'),
  doc('config set'),
];
const byName = new Map(docs.map((d) => [d.name, d]));

describe('console completion', () => {
  it('suggests command names for the first word', () => {
    assert.deepEqual(
      complete('ge', docs, byName)?.items.map((d) => d.name),
      ['get', 'getdel', 'getex'],
    );
    assert.equal(complete('  GE', docs, byName)?.from, 2);
    assert.equal(complete('', docs, byName), null);
    assert.equal(complete('set', docs, byName), null, 'a complete, unique name needs no suggestion');
  });

  it('suggests subcommands after a container command', () => {
    assert.deepEqual(
      complete('CONFIG ', docs, byName)?.items.map((d) => d.name),
      ['config get', 'config set'],
    );
    assert.deepEqual(
      complete('config s', docs, byName)?.items.map((d) => d.name),
      ['config set'],
    );
    assert.equal(complete('GET mykey', docs, byName), null);
  });

  it('finds the command a line calls', () => {
    assert.equal(docForLine('CONFIG GET maxmemory', byName)?.name, 'config get');
    assert.equal(docForLine('get foo', byName)?.name, 'get');
    assert.equal(docForLine('nosuch', byName), null);
  });

  it('works on the line the caret is on', () => {
    assert.deepEqual(caretLine('GET a\nSE', 8), { start: 6, before: 'SE' });
  });
});

describe('console safety', () => {
  it('flags destructive and blocking commands', () => {
    assert.match(danger('FLUSHDB', 3)!, /db3/);
    assert.match(danger('flushall async', 0)!, /every database/);
    assert.match(danger('CONFIG SET maxmemory 1', 0)!, /configuration/);
    assert.match(danger('KEYS *', 0)!, /SCAN/);
    assert.equal(danger('CONFIG GET maxmemory', 0), null);
    assert.equal(danger('GET k', 0), null);
  });

  it('splits pasted input into commands', () => {
    assert.deepEqual(commandsIn('GET a\n\n  SET b 1  \n'), ['GET a', 'SET b 1']);
  });
});

describe('console output', () => {
  const nested: Reply = {
    kind: 'array',
    items: [
      { kind: 'string', value: { text: 'a' } },
      { kind: 'array', items: [{ kind: 'integer', value: '1' }, { kind: 'nil' }] },
    ],
  };

  it('formats replies like redis-cli', () => {
    assert.equal(replyToText(nested), '1) "a"\n2) 1) (integer) 1\n   2) (nil)');
    assert.equal(replyToText({ kind: 'array', items: [] }), '(empty array)');
    assert.equal(replyToText({ kind: 'error', value: 'ERR x' }), '(error) ERR x');
  });

  it('formats replies like redis-cli --raw', () => {
    assert.equal(replyToText(nested, true), 'a\n1\n');
  });

  it('pretty-prints JSON strings only', () => {
    assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
    assert.equal(prettyJson('hello'), null);
    assert.equal(prettyJson('{broken'), null);
  });
});

describe('read-only guard', () => {
  it('refuses scripts whatever flags the server reports', () => {
    // EVAL's flags on Redis 8.0, which has no script_runner flag yet.
    const eval80 = ['noscript', 'stale', 'skip_monitor', 'no_mandatory_keys', 'movablekeys'];
    assert.match(refusal('eval', null, eval80, true) ?? '', /EVAL_RO/);
    assert.match(refusal('fcall', null, eval80, true) ?? '', /FCALL_RO/);
    assert.equal(refusal('eval_ro', null, [...eval80, 'readonly'], true), null);
    assert.equal(refusal('eval', null, eval80, false), null);
  });
});
