# Run and submit MP3

Repository: https://github.com/dqnnyperez/mp3

Deployed API: https://mp3-j82m.onrender.com/api

Render service: https://dashboard.render.com/web/srv-dbl9rou417fc73ftnd1g

Verified November 3, 2026: Render deployment is live; the course autograder returned **100/100 (20/20 points)**, with all 19 checks passing. This self-check does not submit the assignment.

1. Use Node 24 (`nvm install 24 && nvm use 24`), then `npm ci`.
2. Fill in `MONGODB_URI` in your local `.env` with your Atlas database connection string. The server uses multi-document transactions, so use Atlas or a MongoDB replica set. Keep `.env` out of Git.
3. In Atlas, allow access from anywhere as required by the assignment. Use a database user with read/write access to the database in your URI.
4. Run `npm start`. Visit `http://localhost:3000/api`; the server starts only after connecting to MongoDB and creating model indexes.
5. Run `npm test` for integration tests. They use an isolated local MongoDB replica set and never use your Atlas URI. The first run downloads a MongoDB test binary.
6. Create your own public GitHub repository and push this project there. Change `origin` from the course template to your repository before pushing.
7. On Render, create a Node web service from your repository (or use the included Blueprint). Build: `npm ci --omit=dev`; start: `npm start`; Node: 24. Add `MONGODB_URI` as a secret environment variable. Render provides `PORT`.
8. Open `https://YOUR-SERVICE.onrender.com/api` and check `/api/users` and `/api/tasks`.
9. Set `API_URL` in `submit.js` to the deployed base URL, without `/api`. Run `npm run submit`, review feedback, and fix any failures.
10. Submit the form linked in README.md. Include your repository and deployment URLs, all sources used, and LLM chatlogs and survey answers required by the course. Running the autograder is only a self-check. No video is required.

DELETE returns HTTP 204 with no body. Other successful and failed API responses contain `message` and `data`. Task collections default to 100 results; `limit=0` removes the limit. Counts return the total number matching `where`, independently of pagination.

## Assistance record

Codex generated the API implementation, validation, transaction-based user/task synchronization, integration tests, and setup/deployment configuration in this session. Preserve/export the actual conversation for the required LLM chatlog submission; this paragraph does not replace that chatlog.

## Browser landing page

The root URL and browser visits to `/api` show the Llama.io landing page. API clients continue receiving JSON from `/api`; use `/api?format=json` to explicitly view its JSON in a browser. `/api/users` and `/api/tasks` always return JSON. The landing page uses system fonts and original SVG icons, with no external image or font services. Codex also generated this visual page.
