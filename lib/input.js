class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const bad = message => { throw new HttpError(400, message); };
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function bodyObject(body) {
    if (!object(body)) bad('Send an object containing the resource fields.');
}
function text(body, key, required = false, fallback = '') {
    if (body[key] === undefined && !required) return fallback;
    if (typeof body[key] !== 'string' || (required && !body[key].trim())) bad(`${key} must be a${required ? ' nonempty' : ''} string.`);
    return body[key];
}
function userInput(body) {
    bodyObject(body);
    const name = text(body, 'name', true);
    const email = text(body, 'email', true);
    const ids = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(ids) || ids.some(id => !validId(id))) bad('pendingTasks must be a list of valid task IDs.');
    return { name, email, pendingTasks: [...new Set(ids.map(id => id.toLowerCase()))] };
}
function taskInput(body) {
    bodyObject(body);
    const name = text(body, 'name', true);
    const description = text(body, 'description');
    if ((typeof body.deadline !== 'string' && typeof body.deadline !== 'number') || body.deadline === '' || !Number.isFinite(new Date(body.deadline).getTime())) bad('deadline must be a valid date.');
    const completed = body.completed === undefined ? false : body.completed;
    if (typeof completed !== 'boolean') bad('completed must be a boolean.');
    let assignedUser = text(body, 'assignedUser');
    if (assignedUser && !validId(assignedUser)) bad('assignedUser must be a valid user ID or an empty string.');
    assignedUser = assignedUser.toLowerCase();
    const assignedUserName = body.assignedUserName === undefined ? undefined : text(body, 'assignedUserName');
    if (!assignedUser && assignedUserName !== undefined && assignedUserName !== 'unassigned') bad('An unassigned task must have assignedUserName set to unassigned.');
    return { name, description, deadline: new Date(body.deadline), completed, assignedUser, assignedUserName };
}
function json(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string') bad(`${key} must be JSON encoded.`);
    try { return JSON.parse(query[key]); } catch { bad(`${key} must contain valid JSON.`); }
}
function projection(query) {
    const select = json(query, 'select', {});
    if (!object(select) || Object.values(select).some(v => v !== 0 && v !== 1)) bad('select must be an object of 0 and 1 values.');
    const modes = new Set(Object.entries(select).filter(([k]) => k !== '_id').map(([, v]) => v));
    if (modes.size > 1) bad('select cannot mix included and excluded fields except _id.');
    return select;
}
function collectionQuery(query, defaultLimit) {
    const where = json(query, 'where', {});
    const sort = json(query, 'sort', {});
    if (!object(where)) bad('where must be a JSON object.');
    if (!object(sort) || Object.values(sort).some(v => v !== 1 && v !== -1)) bad('sort must be an object of 1 and -1 values.');
    // Server-side JavaScript is not needed for the assignment query operators.
    const unsafe = value => object(value) || Array.isArray(value) ? Object.entries(value).some(([k, v]) => ['$where', '$function', '$accumulator', '__proto__', 'constructor', 'prototype'].includes(k) || unsafe(v)) : false;
    if (unsafe(where)) bad('Unsupported query operator.');
    const skip = json(query, 'skip', 0);
    const limit = json(query, 'limit', defaultLimit);
    const count = json(query, 'count', false);
    if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isSafeInteger(limit) || limit < 0) bad('skip and limit must be nonnegative integers.');
    if (typeof count !== 'boolean') bad('count must be true or false.');
    return { where, sort, skip, limit, count, select: projection(query) };
}
module.exports = { HttpError, validId, userInput, taskInput, collectionQuery, projection };
