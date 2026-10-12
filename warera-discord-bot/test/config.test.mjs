import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core.mjs';
import { Service } from '../src/service.mjs';

test('Config permissions, server nickname and persistent server-specific setting', async () => {
  const s = new Store(':memory:'); const calls = [];
  const service = new Service(s, { discord: async (...args) => calls.push(args) });
  const i = { guild_id: 'g', member: { user: { id: 'd' }, permissions: '0' }, data: { name: 'config', options: [{ name: 'botname', options: [{ name: 'name', value: 'WarEra Helfer' }] }] } };
  await assert.rejects(service.handle(i), /Server verwalten/); assert.equal(calls.length, 0);
  i.member.permissions = '32'; await service.handle(i);
  assert.deepEqual(calls, [['/guilds/g/members/@me', 'PATCH', { nick: 'WarEra Helfer' }]]);
  i.data.options = [{ name: 'militaer', options: [{ name: 'aktiv', value: false }] }];
  await service.handle(i);
  assert.equal(s.db.prepare('SELECT military FROM settings WHERE guild=?').get('g').military, 0);
  assert.equal(s.db.prepare('SELECT military FROM settings WHERE guild=?').get('other'), undefined);
  s.db.close();
});

test('Military switch, rename, departure, disabled sync and API failure', async () => {
  const s = new Store(':memory:'); s.start('g', 'd', 'player'); s.complete(s.challenge('g', 'd'));
  const rows = [['verified', 'v'], ['country:country', 'c'], ['mu:old', 'old-role'], ['mu:new', 'new-role']];
  for (const [key, id] of rows) s.db.prepare('INSERT INTO roles VALUES(?,?,?)').run('g', key, id);
  const mutations = []; let currentUser = { _id: 'player', country: 'country', mu: 'new' }; let fail = false;
  const api = {
    user: async () => currentUser,
    game: async proc => {
      if (proc === 'country.getAllCountries') return [{ _id: 'country', name: 'Germany' }];
      if (proc === 'government.getByCountryId') return { president: 'other' };
      if (fail) throw new Error('offline');
      return { _id: 'new', name: 'New Name' };
    },
    discord: async (path, method = 'GET', body) => {
      if (method !== 'GET') { mutations.push([path, method, body]); return; }
      return path.endsWith('/roles') ? rows.map(([, id]) => ({ id, name: 'Old Name' })) : { roles: ['v', 'c', 'old-role', 'unrelated'] };
    },
  };
  const service = new Service(s, api);
  await service.sync('g', 'd');
  assert.deepEqual(mutations.map(m => m.slice(0, 2)), [
    ['/guilds/g/roles/new-role', 'PATCH'], ['/guilds/g/members/d/roles/old-role', 'DELETE'], ['/guilds/g/members/d/roles/new-role', 'PUT'],
  ]);
  assert.equal(mutations[0][2].name, 'Einheit: New Name');
  mutations.length = 0; fail = true;
  await assert.rejects(service.sync('g', 'd')); assert.equal(mutations.length, 0);
  currentUser = { _id: 'player', country: 'country' };
  await service.sync('g', 'd');
  assert.deepEqual(mutations.map(m => m.slice(0, 2)), [['/guilds/g/members/d/roles/old-role', 'DELETE']]);
  mutations.length = 0; currentUser.mu = 'new';
  s.db.prepare('INSERT INTO settings VALUES(?,?)').run('g', 0);
  await service.sync('g', 'd');
  assert.deepEqual(mutations.map(m => m.slice(0, 2)), [['/guilds/g/members/d/roles/old-role', 'DELETE']]);
  s.db.close();
});
