require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { HttpError } = require('./lib/input');
const app = express();
app.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept', 'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require('./routes')(app);
app.use((req, res) => res.status(404).json({ message: 'Endpoint not found.', data: null }));
app.use((err, req, res, next) => {
    let status = 500;
    let message = 'The server could not complete the request.';
    if (err instanceof HttpError) { status = err.status; message = err.message; }
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'Request body must contain valid JSON.'; }
    else if (err.code === 11000) { status = 400; message = 'That email is already in use.'; }
    else if (['ValidationError', 'CastError', 'StrictModeError', 'StrictPopulateError'].includes(err.name) || (err.name === 'MongoServerError' && [2, 9, 14, 72, 168, 31253, 31254].includes(err.code))) { status = 400; message = 'Invalid field value or query.'; }
    if (status === 500) console.error('Request failed:', err.name);
    res.status(status).json({ message, data: null });
});
async function start() {
    if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in .env before starting the server.');
    await mongoose.connect(process.env.MONGODB_URI);
    await Promise.all([require('./models/user').init(), require('./models/task').init()]);
    return app.listen(process.env.PORT || 3000, () => console.log(`Server running on port ${process.env.PORT || 3000}`));
}
if (require.main === module) start().catch(err => { console.error('Server startup failed:', err.name, 'Check your database configuration.'); process.exitCode = 1; });
module.exports = { app, start };
