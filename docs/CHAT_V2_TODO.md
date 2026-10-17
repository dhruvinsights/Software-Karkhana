# Chat v2: Slack-level UI + realtime fixes

Statuses: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`. Update the row when you finish it.
Previous round: `docs/CHAT_FULLSCREEN_TODO.md`.

Plan to keep tokens low: fix the realtime bugs first, since nothing else matters if
messages do not arrive. Then rebuild only the full-screen view (`ChatPage.tsx`) and
reuse `chatSocket.ts` and the existing API. Use OSS for the editor and code
highlighting; do not write our own.

| # | Task | Status | Note |
|---|------|--------|------|
| 1 | Bug: messages in a newly created channel do not arrive live for other members | DONE | Server verified live with 2 users on 1 process (scratchpad repro): frames arrive both ways. Real causes: (a) Cloud Run runs up to 3 instances with no broker, so users on different instances miss each other; (b) Cloud Run `--timeout=300` cuts every socket after 5 min, and the client never re-fetches messages missed during reconnect; (c) a message for a channel not yet in the list is ignored.  Fixed: `useChannelMessages` re-fetches on reconnect; ChatPanel reloads lists for an unknown channel; cloudbuild `--timeout=3600 --session-affinity --concurrency=250` (40 capped each instance at 40 sockets). Multi-instance still needs `REALTIME_BROKER_URL` pointing at a hosted Kafka/Redis. |
| 2 | Bug: read/"seen" state and unread counts do not update | DONE | Opening a channel never calls `markRead`, so the server unread count stays and the header badge brings it back.  Fixed: hook marks read up to the newest message while the tab is visible. |
| 3 | Backend: attachments (upload images, code files, audio), stored per workspace, 90-day retention like messages | DONE | `024_chat_attachments.sql` (bytea, RLS, cascades with message, orphans purged after 1 day), `POST /api/chat/channels/{id}/attachments`, `GET /api/chat/attachments/{id}` (SVG/HTML forced to download, nosniff). Messages carry `attachments[]`. Tested. |
| 4 | Composer: Slack toolbar (bold, italic, strike, link, lists, quote, code, code block), `+` menu (upload, text snippet, list), emoji, @mention, voice message | DONE | `web/src/components/chat/ChatPage.tsx` `Composer`: Markdown toolbar plus ⌘B/⌘I/⌘⇧X, `+` menu (List, Text snippet modal with 22 languages, Upload), drag-drop/paste files, emoji-picker-react (lazy), @mention picker, MediaRecorder voice notes. No underline: Markdown has none. |
| 5 | Messages: markdown rendering + syntax-highlighted snippets, image preview, audio player, file chips | DONE | react-markdown + remark-gfm + rehype-highlight (auto-detect); images open in a lightbox; audio player; code files get a Preview with highlighting. Files tab per channel. |
| 6 | Look: Slack layout (rail + sidebar + channel tabs header), larger type, react-bits background, hover actions | DONE | Purple-gradient sidebar with collapsible Channels/DMs, search, unread badges; header tabs Messages/Files, online avatars; sticky day pills; 15px text; SoftAurora background; hover copy action. Screenshots verified with Playwright. No extra left rail: the app shell already has one. |
| 7 | Build + tests | DONE | 228 backend tests pass (1 pre-existing: `test_invites`, local RESEND key). Vite build OK. Playwright, 2 fresh users: message delivered live in about 0.5 s both ways; new private channel shows up live; unread badge appears and clears; server unread is 0 after reading. |

## Next (pick up here)

- Production: set `REALTIME_BROKER_URL` to a hosted Kafka or Redis (for example Memorystore Redis or Confluent), or set `_MAX_INSTANCES=1`. Until then, users on different Cloud Run instances miss each other's live messages.
- Reactions, threads, edit/delete: need a `parent_id` column, a reactions table, and PATCH/DELETE routes.
- Attachments are stored as bytea in Postgres (10 MB cap). At scale, move them to GCS (`ARTIFACTS_BUCKET`) and serve signed URLs.
- Emoji shortcodes (`:rocket:`) are not converted yet.

## Round 3 (user feedback)

| # | Task | Status | Note |
|---|------|--------|------|
| 8 | Clicking Team Chat smoothly collapses the workspace side nav; chat goes full width | DONE | `AppShell.tsx`: folds the nav on entering `team_chat` and restores the previous state on leaving; 300ms width transition. |
| 9 | Bigger text in the workspace side nav | DONE | Nav items 13→15px, section titles 10→11.5px, search/footer bumped; width 256→288px. |
| 10 | Chat page uses our theme (no purple Slack gradient; keep the message pane as is) | DONE | Sidebar is now `#0A0A0F` glass like the app nav; Slack green/pink swapped for our blue `#075BFF`; online dot `#00d9a6`. Message pane unchanged. |
| 11 | Bug: notifications update but the chat list/messages do not | DONE | Root cause: the dev DB `karkhana` was at migration 022, so message history (which now loads attachments) returned 500. Applied 023+024 as `karkhana_app`. After pulling, always run the migrate command from HANDOFF_PLAN step 2. |
| 12 | Bug: file upload errors | DONE | Same root cause (`chat_attachments` table missing). Verified on the user's running :8080 server: history 200, upload 201. |
