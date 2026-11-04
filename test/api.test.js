const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { app } = require('../server');
const User = require('../models/user');
const Task = require('../models/task');
let db, server, base;
before(async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([User.init(), Task.init()]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (db) await db.stop();
});
async function request(path, method = 'GET', body, expected = 200) {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = res.status === 204 ? null : await res.json();
    assert.equal(res.status, expected, JSON.stringify(json));
    if (json) { assert.equal(typeof json.message, 'string'); assert.ok(Object.hasOwn(json, 'data')); }
    return json?.data;
}
const query = params => '?' + new URLSearchParams(Object.entries(params).map(([key, value]) => [key, JSON.stringify(value)]));
const taskBody = extra => ({ name: 'Task', deadline: '2026-12-01', ...extra });
test('CRUD, replacements, assignment moves, completion, renames, rollback and deletes', async () => {
    const a = await request('/users', 'POST', { name: 'A', email: 'a@example.com' }, 201);
    const b = await request('/users', 'POST', { name: 'B', email: 'b@example.com' }, 201);
    const t = await request('/tasks', 'POST', taskBody({ assignedUser: a._id }), 201);
    assert.equal(t.assignedUserName, 'A');
    assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, [t._id]);
    await request(`/users/${b._id}`, 'PUT', { name: 'Bee', email: b.email, pendingTasks: [t._id] });
    assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, []);
    assert.equal((await request(`/tasks/${t._id}`)).assignedUserName, 'Bee');
    await request(`/tasks/${t._id}`, 'PUT', taskBody({ completed: true, assignedUser: b._id }));
    assert.deepEqual((await request(`/users/${b._id}`)).pendingTasks, []);
    await request(`/users/${b._id}`, 'PUT', { name: 'New B', email: b.email });
    assert.equal((await request(`/tasks/${t._id}`)).assignedUserName, 'New B');
    await request(`/users/${a._id}`, 'PUT', { name: 'A', email: a.email, pendingTasks: [t._id] }, 400);
    await request(`/tasks/${t._id}`, 'PUT', taskBody({ completed: true, assignedUser: a._id }));
    assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, []);
    await request(`/tasks/${t._id}`, 'PUT', taskBody({ assignedUser: a._id }));
    assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, [t._id]);
    await request(`/tasks/${t._id}`, 'PUT', taskBody({ assignedUser: b._id, assignedUserName: 'wrong' }), 400);
    assert.equal((await request(`/tasks/${t._id}`)).assignedUser, a._id);
    await request(`/users/${a._id}`, 'PUT', { name: 'Changed', email: b.email }, 400);
    assert.equal((await request(`/users/${a._id}`)).name, 'A');
    await request(`/users/${a._id}`, 'PUT', { name: 'A', email: a.email });
    assert.equal((await request(`/tasks/${t._id}`)).assignedUser, '');
    const replacement = await request(`/tasks/${t._id}`, 'PUT', taskBody({ assignedUser: b._id, dateCreated: '2000-01-01' }));
    assert.equal(replacement.dateCreated, t.dateCreated);
    await request(`/users/${b._id}`, 'DELETE', undefined, 204);
    assert.equal((await request(`/tasks/${t._id}`)).assignedUserName, 'unassigned');
    await request(`/tasks/${t._id}`, 'PUT', taskBody({ assignedUser: a._id }));
    await request(`/tasks/${t._id}`, 'DELETE', undefined, 204);
    assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, []);
    await request(`/tasks/${t._id}`, 'GET', undefined, 404);
    await request(`/users/${a._id}`, 'DELETE', undefined, 204);
});
test('validation, missing resource precedence, query combinations and projections', async () => {
    await request('/users', 'POST', { name: 'Missing email' }, 400);
    await request('/tasks', 'POST', taskBody({ completed: 'false' }), 400);
    await request('/tasks', 'POST', taskBody({ assignedUser: 'bad' }), 400);
    await request('/tasks', 'POST', taskBody({ assignedUser: '000000000000000000000001' }), 404);
    await request('/tasks/bad', 'PUT', {}, 404);
    await request('/users/000000000000000000000001', 'PUT', {}, 404);
    for (const name of ['Alpha', 'Bravo', 'Charlie']) await request('/tasks', 'POST', taskBody({ name }), 201);
    const result = await request('/tasks' + query({ where: { completed: false }, sort: { name: -1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 1 }));
    assert.deepEqual(result, [{ name: 'Bravo' }]);
    assert.equal(await request('/tasks' + query({ where: { completed: false }, count: true, limit: 1, skip: 1 })), 3);
    assert.deepEqual(await request('/users' + query({ where: { name: 'absent' } })), []);
    const one = (await request('/tasks'))[0];
    assert.deepEqual(await request(`/tasks/${one._id}` + query({ select: { name: 1, _id: 0 } }) + '&where=broken'), { name: one.name });
    for (const params of [{ where: '[' }, { limit: -1 }, { count: 1 }, { sort: { name: 0 } }, { select: { name: 1, completed: 0 } }]) {
        const encoded = params.where === '[' ? '?where=%5B' : query(params);
        await request('/tasks' + encoded, 'GET', undefined, 400);
    }
    for (const t of await request('/tasks')) await request(`/tasks/${t._id}`, 'DELETE', undefined, 204);
});
test('collection defaults, POST reassignment, failed user replacement and completed-task deletion cleanup', async () => {
    await Task.insertMany(Array.from({ length: 101 }, (_, i) => taskBody({ name: `Bulk ${i}` })));
    assert.equal((await request('/tasks')).length, 100);
    assert.equal((await request('/tasks?limit=0')).length, 101);
    const first = (await request('/tasks?limit=1'))[0];
    const a = await request('/users', 'POST', { name: 'First owner', email: 'first@example.com', pendingTasks: [first._id] }, 201);
    const b = await request('/users', 'POST', { name: 'Next owner', email: 'next@example.com', pendingTasks: [first._id] }, 201);
    assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, []);
    assert.equal((await request(`/tasks/${first._id}`)).assignedUser, b._id);
    await request(`/users/${b._id}`, 'PUT', { name: 'Should roll back', email: b.email, pendingTasks: ['000000000000000000000001'] }, 404);
    assert.equal((await request(`/tasks/${first._id}`)).assignedUserName, b.name);
    assert.equal((await request(`/users/${b._id}`)).name, b.name);
    await request(`/tasks/${first._id}`, 'PUT', taskBody({ assignedUser: b._id, completed: true }));
    await request(`/users/${b._id}`, 'DELETE', undefined, 204);
    const completed = await request(`/tasks/${first._id}`);
    assert.equal(completed.completed, true);
    assert.equal(completed.assignedUser, '');
    assert.equal(completed.assignedUserName, 'unassigned');
    const malformed = await fetch(base + '/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.deepEqual((await malformed.json()).data, null);
});
