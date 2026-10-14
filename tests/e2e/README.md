# End-to-end browser test

Runs the full demo through the real React UI as PM, Developer, Director and Lead,
with screenshots in `shots/` and a `report.json` of steps and issues.

```bash
make dev                      # in another terminal (AUTH_MODE=dev)
cd tests/e2e && npm install && npx playwright install chromium
npm test                      # or KARKHANA_URL=https://<cloud-run-url> npm test (dev auth only)
```

Needs the agent worker to reach a demo repo: start the API with
`DEMO_REPO_URL=file:///path/to/bare/invoicekit.git`.
