import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Store, desiredRoles, validSignature } from '../src/core.mjs';
import { Api } from '../src/api.mjs';
import { Service } from '../src/service.mjs';

const user = { _id: 'player', country: 'country' };
const countries = [{ _id: 'country', name: 'Germany' }];
test('Citizenship and multiple offices, including removal after leaving office', () => {
  assert.deepEqual(desiredRoles(user, countries, { president: 'player', vicePresident: 'player' }).map(r => r[0]), ['verified', 'country:country', 'office:president', 'office:vicePresident']);
  assert.equal(desiredRoles(user, countries, { president: 'other' }).length, 2);
  assert.throws(() => desiredRoles(user, countries, null));
  assert.throws(() => desiredRoles(user, [], { president: 'player' }));
});
test('Challenges expire, bind to Discord user, replace old tokens, and cannot be reused', () => {
  const s = new Store(':memory:');
  const token = s.start('g', 'd', 'p', 1000);
  const old = s.challenge('g', 'd', 1001);
  assert.throws(() => s.challenge('g', 'different', 1001));
  assert.throws(() => s.challenge('g', 'd', 901000));
  assert.notEqual(s.start('g', 'd', 'p', 2000), token);
  assert.throws(() => s.complete(old, 2001));
  s.complete(s.challenge('g', 'd', 2001), 2001);
  assert.throws(() => s.complete(old, 2002));
  assert.throws(() => s.start('g', 'other', 'p', 2002));
  s.db.close();
});
test('Concurrent account claims are rejected by unique database constraint', () => {
  const s = new Store(':memory:');
  s.start('g', 'a', 'p'); s.start('g', 'b', 'p');
  s.complete(s.challenge('g', 'a'));
  assert.throws(() => s.complete(s.challenge('g', 'b')));
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM links').get().n, 1);
  s.db.close();
});
test('Rate limits and duplicate interaction protection', () => {
  const s = new Store(':memory:');
  s.limit('key', 1, 0); assert.throws(() => s.limit('key', 1, 1)); s.limit('key', 1, 3600001);
  assert.equal(s.once('i'), true); assert.equal(s.once('i'), false); s.db.close();
});
test('Discord signature validation rejects tampering and stale requests', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const body = Buffer.from('{"type":1}'), timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString('hex');
  assert.equal(validSignature(key, signature, timestamp, body), true);
  assert.equal(validSignature(key, signature, timestamp, Buffer.from('{}')), false);
  assert.equal(validSignature(key, signature, timestamp, body, Date.now() + 600000), false);
});
test('Verification checks owner and paginates', async () => {
  const api = new Api(); const calls = [];
  api.game = async (proc, input) => {
    calls.push(input);
    if (proc === 'company.getCompanies') return input.cursor ? { items: ['b'] } : { items: ['a'], nextCursor: 'next' };
    return { _id: input.companyId, user: input.companyId === 'a' ? 'attacker' : 'player', name: 'WV-CODE' };
  };
  assert.equal(await api.proof('player', 'WV-CODE'), true);
  assert.ok(calls.some(c => c.cursor === 'next'));
  assert.equal(await api.proof('player', 'WV-OTHER'), false);
});
test('Sync only removes tracked roles and preserves unrelated roles', async () => {
  const s = new Store(':memory:'); s.start('g', 'd', 'player'); s.complete(s.challenge('g', 'd'));
  for (const [key, id] of [['verified', 'v'], ['country:country', 'c'], ['office:president', 'p']]) s.db.prepare('INSERT INTO roles VALUES(?,?,?)').run('g', key, id);
  const mutations = [];
  const api = { user: async () => user, game: async proc => proc === 'country.getAllCountries' ? countries : { president: 'other' },
    discord: async (path, method = 'GET') => {
      if (method !== 'GET') { mutations.push([path, method]); return; }
      return path.endsWith('/roles') ? ['v', 'c', 'p'].map(id => ({ id })) : { roles: ['v', 'c', 'p', 'unrelated'] };
    } };
  const svc = new Service(s, api); await svc.sync('g', 'd');
  assert.deepEqual(mutations, [['/guilds/g/members/d/roles/p', 'DELETE']]);
  mutations.length = 0; api.game = async () => { throw new Error('offline'); };
  await assert.rejects(svc.sync('g', 'd')); assert.deepEqual(mutations, []); s.db.close();
});
