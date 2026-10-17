# Full-screen chat + scale-out: TODO

Any AI or dev can pick this up. Statuses: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`.
Update the status line and add a one-line note when you finish a step.

Context: chat already exists (Postgres tables from `db/migrations/008_chat.sql`, routes in
`app/routers/chat.py`, socket hub in `app/services/realtime.py`, sidebar UI in
`web/src/components/shell/ChatPanel.tsx`). The hub is in-process, so with more than one
API instance, users on different instances do not see each other's messages. That is the
main thing blocking 10k concurrent users.

| # | Task | Status | Note |
|---|------|--------|------|
| 1 | Research OSS options (UI kit + broker) and pick | DONE | See "Decision" below |
| 2 | Retention: keep chat 90 days, purge older (migration 023 + purge job) | DONE | `023_chat_retention.sql` (SECURITY DEFINER `purge_expired_chat`), `app/services/chat_retention.py` hourly loop in lifespan, `CHAT_RETENTION_DAYS` |
| 3 | Broker: publish chat/activity frames through Kafka (Redpanda locally) so every API instance fans out | DONE | `realtime.py` publishes envelopes via `broadcaster[kafka]` when `REALTIME_BROKER_URL` set; falls back to local on publish error. Test: `tests/integration/test_chat_retention_and_broker.py`. Follow-up: `online_users` is still per instance, so presence counts are partial with more than one instance (move to Redis set). |
| 4 | docker-compose for Redpanda + config flags (`REALTIME_BROKER_URL`, off by default = in-process) | DONE | `docker-compose.realtime.yml`, `make broker-local`, .env.example. Not live-tested: Docker was not running. Run `make broker-local` and two `make dev` on different ports to verify. |
| 5 | Full-screen Slack-style chat view inside the workspace (ScreenId `team_chat`) | DONE | `ChatPanel variant="page"`: full-bleed, 264px sidebar with Channels + Direct messages stacked, day dividers, larger header. Rendered in `App.tsx`. Not yet checked in a browser. |
| 6 | Side nav entry "Chat" + keep the sidebar panel as a quick peek | DONE | Nav "Team Chat" with unread badge under Workspace. Drawer has an expand button that opens the full screen, and is hidden while on the chat screen. |
| 7 | Activity feed works in the full-screen view (mentions jump to message) | DONE | Fixed a bug: activity sent clicks to a `chat_channel` screen that did not exist. It now calls `openChatChannel(id)` and opens `team_chat` on that channel. Jumps to the channel, not the exact message (follow-up). |
| 8 | Tests + lint + tsc build | DONE | 227 backend tests pass. 1 pre-existing failure: `test_invites` sends real mail because of the local `.env` RESEND key. ruff and import-linter clean, vite build OK. `tsc -b` shows 2 errors in `ProductIdeaLab.tsx`, which was already uncommitted before this work. |

## Decision

- **Fan-out across instances: `broadcaster` (encode, BSD-3) with its Kafka backend.** It is a
  small OSS library that already wraps aiokafka/Redis/Postgres behind one publish/subscribe
  API, so we wire it into `app/services/realtime.py` instead of writing a Kafka client.
  Every API instance publishes each frame to one topic and delivers it to the sockets it
  holds. With `REALTIME_BROKER_URL` unset, it stays in-process (dev and tests unchanged).
  Locally Kafka runs as Redpanda (Kafka API, single container, no ZooKeeper).
- **Storage stays Postgres.** Postgres is the source of truth; Kafka handles transport. Messages
  are kept 90 days (`CHAT_RETENTION_DAYS`) and a purge job deletes older rows. The Kafka
  topic also keeps 90 days, so it can be replayed.
- **UI: reuse our own `ChatPanel` data and socket layer and add a full-screen Slack layout.**
  The MIT kit `@chatscope/chat-ui-kit-react` only gives a message list and input, with no
  channels or threads, and its light theme would fight our dark styles. We already have
  channels, DMs, mentions, unread counts and the socket, so a new layout over the same
  code is less work and less risk than swapping in a kit.
- 10k concurrent users means several API instances behind the load balancer (Cloud Run
  `max-instances`, with roughly 1k sockets each) plus the broker above. One process
  cannot hold that many.

Sources: https://github.com/encode/broadcaster ,
https://github.com/permitio/fastapi_websocket_pubsub ,
https://www.npmjs.com/package/@chatscope/chat-ui-kit-react

## Next (pick up here)

- Presence across instances: `online_users` reads local sockets only. Move it to a Redis set or a heartbeat topic.
- Jump to the exact message from a mention (scroll and highlight `messageId`).
- Threads (reply-in-thread) and reactions: these need a `parent_id` column plus a reactions table.
- Live test: `make broker-local`, then run two API instances (`:8080` and `:8081`) with
  `REALTIME_BROKER_URL=kafka://localhost:19092`, open one tab on each, and confirm a message
  sent in one shows up in the other.
- Load: run a k6/locust websocket test at 10k sockets against 10 or more Cloud Run instances.
