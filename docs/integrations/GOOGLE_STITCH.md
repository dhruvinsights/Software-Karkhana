# Google Stitch (designer dashboard)

Designers generate, edit and vary UI screens with Google Stitch from the Design dashboard. Pinned screens are listed in the design handoff developers receive on approval.

## Access
- Only project members holding the **design** station can use any Stitch endpoint, even on open projects. Leads/managers must give themselves the design station (audited).
- The studio renders only on the designer dashboard routes and only when the server returns `isDesigner: true`.

## Enable in production
1. Create a Stitch API key (Stitch → Settings → API keys) on the Google account that should own the designs.
2. `gcloud secrets create stitch-api-key --data-file=-` and grant the run service account `secretAccessor`.
3. Deploy with `STITCH_ENABLED=true` and `--set-secrets STITCH_API_KEY=stitch-api-key:latest`.
4. Run migration `032_stitch.sql`.

## Safeguards
- Key is server-side only and sent only to `STITCH_MCP_URL` (https enforced).
- Asset downloads: HTTPS, allowlisted Google hosts, size caps, re-validated redirects, no key sent.
- One running job per project (DB unique index); rolling 24h quota per workspace; stale jobs auto-fail; dropped generations are recovered via `list_screens`.
- Previews run in `sandbox="allow-scripts"` (no same-origin) with an injected CSP blocking network calls, forms and frames.
- Every request, result, pin and archive is written to the evidence ledger.
