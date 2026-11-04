const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { HttpError, validId, userInput, taskInput, collectionQuery, projection } = require('../lib/input');
const ok = (res, data, status = 200) => res.status(status).json({ message: status === 201 ? 'Created' : 'OK', data });
async function find(Model, id, session) {
    if (!validId(id)) throw new HttpError(404, `${Model.modelName} not found.`);
    const doc = await Model.findById(id).session(session || null);
    if (!doc) throw new HttpError(404, `${Model.modelName} not found.`);
    return doc;
}
async function transaction(work) {
    // Atlas supports transactions; all related documents commit or roll back together.
    return mongoose.connection.transaction(work);
}
async function saveUser(body, id, session) {
    const existing = id === undefined ? null : await find(User, id, session);
    const input = userInput(body);
    const duplicate = await User.findOne({ email: input.email, ...(existing ? { _id: { $ne: existing._id } } : {}) }).session(session);
    if (duplicate) throw new HttpError(400, 'That email is already in use.');
    const tasks = await Task.find({ _id: { $in: input.pendingTasks } }).session(session);
    if (tasks.some(task => task.completed)) throw new HttpError(400, 'Completed tasks cannot be included in pendingTasks.');
    if (tasks.length !== input.pendingTasks.length) throw new HttpError(404, 'A referenced task was not found.');
    const user = existing || new User();
    const userId = String(user._id);
    // Remove assignments dropped by replacement; completed tasks stay assigned.
    if (existing) await Task.updateMany({ assignedUser: userId, completed: false, _id: { $nin: input.pendingTasks } }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
    await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: input.pendingTasks } }, { $pull: { pendingTasks: { $in: input.pendingTasks } } }, { session });
    await Task.updateMany({ _id: { $in: input.pendingTasks } }, { $set: { assignedUser: userId, assignedUserName: input.name } }, { session });
    await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: input.name } }, { session });
    Object.assign(user, input);
    await user.save({ session });
    return user.toObject();
}
async function saveTask(body, id, session) {
    const existing = id === undefined ? null : await find(Task, id, session);
    const input = taskInput(body);
    if (input.assignedUser) {
        const user = await User.findById(input.assignedUser).session(session);
        if (!user) throw new HttpError(404, 'Assigned user not found.');
        if (input.assignedUserName !== undefined && input.assignedUserName !== user.name) throw new HttpError(400, 'assignedUserName must match the assigned user.');
        input.assignedUserName = user.name;
    } else input.assignedUserName = 'unassigned';
    const task = existing || new Task();
    Object.assign(task, input);
    await task.save({ session });
    await User.updateMany({ pendingTasks: String(task._id) }, { $pull: { pendingTasks: String(task._id) } }, { session });
    if (input.assignedUser && !input.completed) await User.updateOne({ _id: input.assignedUser }, { $addToSet: { pendingTasks: String(task._id) } }, { session });
    return task.toObject();
}
module.exports = function (app) {
    const router = express.Router();
    router.get('/', (req, res) => {
        res.vary('Accept');
        if (req.query.format !== 'json' && (req.get('Accept') || '').includes('text/html')) {
            return res.sendFile(require('node:path').join(__dirname, '../web/index.html'));
        }
        ok(res, { service: 'Llama.io task API' });
    });
    for (const [path, Model, save, defaultLimit] of [['users', User, saveUser, 0], ['tasks', Task, saveTask, 100]]) {
        router.get(`/${path}`, async (req, res) => {
            const q = collectionQuery(req.query, defaultLimit);
            const result = q.count
                ? await Model.countDocuments(q.where)
                : await Model.find(q.where).sort(q.sort).select(q.select).skip(q.skip).limit(q.limit);
            ok(res, result);
        });
        router.get(`/${path}/:id`, async (req, res) => {
            if (!validId(req.params.id)) throw new HttpError(404, `${Model.modelName} not found.`);
            const select = projection(req.query);
            const doc = await Model.findById(req.params.id).select(select);
            if (!doc) throw new HttpError(404, `${Model.modelName} not found.`);
            ok(res, doc);
        });
        router.post(`/${path}`, async (req, res) => ok(res, await transaction(session => save(req.body, undefined, session)), 201));
        router.put(`/${path}/:id`, async (req, res) => ok(res, await transaction(session => save(req.body, req.params.id, session))));
        router.delete(`/${path}/:id`, async (req, res) => {
            await transaction(async session => {
                const doc = await find(Model, req.params.id, session);
                if (Model === User) await Task.updateMany({ assignedUser: String(doc._id) }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
                else await User.updateMany({ pendingTasks: String(doc._id) }, { $pull: { pendingTasks: String(doc._id) } }, { session });
                await doc.deleteOne({ session });
            });
            res.status(204).end();
        });
    }
    app.use('/api', router);
};
