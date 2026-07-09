# ons-api

REST API for the Ons matching platform — built with [Bun](https://bun.sh), [Hono](https://hono.dev), and MongoDB.

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- MongoDB 7+ (local or Docker)

---

## Setup

```bash
# From the monorepo root
bun install

# Copy and fill in secrets
cp api/.env.example api/.env
```

### Required environment variables

| Variable | Description | How to generate |
|---|---|---|
| `MONGODB_URI` | MongoDB connection string | — |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM | `openssl rand -hex 32` |
| `JWT_SECRET` | Secret for admin JWT signing | `openssl rand -base64 48` |
| `ADMIN_USERNAME` | Admin login username | — |
| `ADMIN_PASSWORD` | Admin login password | — |
| `FORM_SECRET` | HMAC secret for submission keys | `openssl rand -hex 32` |
| `EMBEDDING_PROVIDER` | `openai` or `local` | — |
| `EMBEDDING_MODEL` | Model name (e.g. `text-embedding-3-small`) | — |
| `EMBEDDING_BASE_URL` | Base URL for local provider | — |

### Optional variables

| Variable | Default | Description |
|---|---|---|
| `MONGODB_DB_NAME` | `ons` | Database name |
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | Environment |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS origins |
| `TRUST_PROXY` | `false` | Set `true` only behind a trusted reverse proxy that overwrites `X-Forwarded-For` — enables proxy headers as the client IP for rate limiting and audit logs; otherwise headers are ignored (spoofable) |
| `ADMIN_JWT_EXPIRY` | `8h` | Admin session JWT lifetime |
| `APPLICANT_JWT_EXPIRY` | `30d` | Applicant portal session JWT lifetime |
| `PUBLIC_URL` | _(empty)_ | Base URL for startup logs |
| `OPENAI_API_KEY` | _(empty)_ | Required when `EMBEDDING_PROVIDER=openai` or `CHAT_PROVIDER=openai` |
| `CHAT_PROVIDER` | `EMBEDDING_PROVIDER` | `openai` or `local` for ice-breakers/match-summaries/match-rerank — independent of the embedding provider |
| `CHAT_BASE_URL` | `EMBEDDING_BASE_URL` | Base URL for a local chat provider, if different from the local embedding server |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Chat model name (e.g. `gpt-5.4-mini` for OpenAI) |

---

## Running

```bash
# Development (hot reload)
bun run dev

# Production
bun run start
```

Swagger UI (dev/test only): http://localhost:3001/api/v1/docs  
OpenAPI JSON: http://localhost:3001/api/v1/openapi.json

---

## Seeding

```bash
# Seed the questionnaire schema into MongoDB
bun run seed

# Seed fake applicants (dev only — exits if NODE_ENV=production)
bun run --cwd .. seed:applicants             # default count
bun run --cwd .. seed:applicants -- --count 50
bun run --cwd .. seed:applicants -- --count 50 --clear
```

---

## Evaluating the matching score

`bun run eval:rerank` (from the monorepo root) runs one full matching pass and prints embedding-vs-LLM score distributions side by side — no need to disable the rerank stage to compare, since every candidate already carries both numbers. Requires a seeded applicant pool and a configured `EMBEDDING_PROVIDER`/`OPENAI_CHAT_MODEL` (real embedding + LLM calls, not mocked):

```bash
bun run eval:rerank                  # api/.env.dev
bun run eval:rerank --env=test
bun run eval:rerank --csv=out.csv    # also write every candidate row to CSV
```

See ["7. Evaluation"](../docs/llm-listwise-rerank-matching-score.md#7-evaluation) in the design writeup for what this is meant to validate.

---

## API reference

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/form/questionnaire` | Fetch active questionnaire + submission key |
| `POST` | `/api/v1/form/submit` | Submit a completed form |

> `POST /submit` requires the `X-Submission-Key` header obtained from `GET /questionnaire`. This proves the client fetched the questionnaire legitimately rather than guessing version strings.

### Admin (session cookie or Bearer token)

```bash
# Login — sets an HttpOnly admin_token cookie and also returns a JWT
# for use as a Bearer token (API clients, tests)
curl -X POST http://localhost:3001/api/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}'
```

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/admin/login` | Authenticate, set session cookie, return JWT |
| `POST` | `/api/v1/admin/logout` | Clear the session cookie |
| `GET` | `/api/v1/admin/me` | Current admin session info |
| `GET` | `/api/v1/admin/applicants` | List applicants (paginated, filterable) |
| `GET` | `/api/v1/admin/applicants/:id` | Get applicant profile |
| `GET` | `/api/v1/admin/applicants/:id/identity` | Decrypt & return Instagram handle + full name ⚠ audit logged, `super_admin` only |
| `DELETE` | `/api/v1/admin/applicants/:id` | Deactivate applicant |
| `POST` | `/api/v1/admin/applicants/:id/regenerate-magic-link` | Issue a new portal magic link, `super_admin` only |
| `GET` | `/api/v1/admin/audit-logs` | View audit trail |
| `POST` | `/api/v1/admin/questionnaires` | Create new questionnaire version |
| `GET` | `/api/v1/admin/matches` | List matches (paginated, filterable) |
| `PATCH` | `/api/v1/admin/matches/:id` | Update match status / notes |
| `DELETE` | `/api/v1/admin/matches/:id` | Remove a match |

### Matching (Bearer token required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/matching/candidates/:id` | Top N candidates for one applicant |
| `GET` | `/api/v1/matching/last-run` | Summary of the most recent matching pass |
| `POST` | `/api/v1/matching/run` | Full pairwise pass over all active applicants |

Candidates are shortlisted with the `embedding-cosine` algorithm (semantic text embeddings + age filter), then the shortlist is rescored by an LLM listwise rerank call — that's the score actually returned and displayed. No `algorithm` parameter is accepted.  
See [`src/matching/README.md`](./src/matching/README.md) for pipeline details.

### Applicant portal (session cookie)

Applicants log in with a magic link (issued by an admin) and, on first login, set a password. The session is an HttpOnly cookie (`ons_applicant_session`); a Bearer header also works for API clients and tests.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/profile/login` | Log in with magic token (+ password after first login) |
| `POST` | `/api/v1/profile/set-password` | Set password on first login |
| `GET` | `/api/v1/profile/suggest-password` | Generate a readable password suggestion |
| `POST` | `/api/v1/profile/logout` | Clear the session cookie |
| `GET` | `/api/v1/profile/me` | Current applicant profile + status |
| `GET` | `/api/v1/profile/answers` | Get my questionnaire answers |
| `PUT` | `/api/v1/profile/answers` | Edit my questionnaire answers |
| `GET` | `/api/v1/profile/matches` | List my matches with score breakdown |
| `POST` | `/api/v1/profile/matches/:id/contact` | Initiate contact with a match — returns ice-breakers and date ideas; no identity revealed yet |
| `POST` | `/api/v1/profile/matches/:id/respond` | Accept or decline a contact request — accepting reveals the initiator's handle + name immediately in the response |
| `POST` | `/api/v1/profile/matches/:id/withdraw` | Withdraw a contact request |
| `POST` | `/api/v1/profile/matches/:id/outcome` | Report a match outcome (`success` / `failed`). Time-gated: `failed` unlocks 3 days after `dating`, `success` after 7. Optional `outcomeFeedback` (tags + note) and a `continuation` (`continue`/`break`) choice on `failed` |
| `POST` | `/api/v1/profile/matches/:id/nudge-ack` | Dismiss the distance-preference nudge surfaced after a `failed` outcome tagged `too_far`; optionally opens the applicant to long-distance matches |
| `POST` | `/api/v1/profile/change-password` | Change my password |
| `POST` | `/api/v1/profile/deactivate` | Deactivate my account |
| `POST` | `/api/v1/profile/cancel-deletion` | Cancel a pending account deletion |
| `POST` | `/api/v1/profile/delete-now` | Delete my account immediately |

---

## Project structure

```
api/
├── src/
│   ├── config/          ← env loader, CORS config
│   ├── controllers/     ← request handlers (thin — delegate to services)
│   ├── db/              ← MongoDB connection, collections, index setup
│   ├── matching/        ← Engine, algorithms, filters, embeddings
│   │   └── README.md    ← Matching system deep-dive
│   ├── middleware/       ← Auth (JWT), rate limiting, audit logging
│   ├── models/          ← TypeScript interfaces for MongoDB documents
│   ├── privacy/         ← Encryption, alias generator, submission keys
│   ├── routes/          ← Hono route definitions
│   ├── seeds/           ← Dev data seeders
│   ├── services/        ← Business logic (form, admin, profile, matching, questionnaire, embedding)
│   ├── utils/           ← Shared helpers (e.g. age-from-birth-date)
│   ├── validators/      ← Zod schemas for request validation
│   └── server.ts        ← App entry point, middleware wiring, bootstrap
└── docs/
    └── openapi.yaml     ← Full OpenAPI 3.1 spec
```

---

## Privacy & security

- **No PII in applicant profiles** — Instagram handles and first/last names are AES-256-GCM encrypted in a separate `identities` collection, each field with its own fresh IV (never reusing another field's IV, even within the same document).
- **Submission keys** — HMAC-SHA256(version, `FORM_SECRET`) prevents questionnaire version enumeration.
- **Audit logs** — every identity decryption of *someone else's* data (admin lookup or mutual match reveal) is written to `audit_logs` with actor, IP, user-agent, and timestamp before plaintext is returned. Viewing your own name on your own profile is not audit-logged — it isn't a privacy-sensitive reveal.
- **Mutual identity reveal** — Instagram handles and full names are only decrypted when the target explicitly accepts a contact request (`POST /profile/matches/:id/respond` with `accept: true`). At that point both parties' handles/names are decrypted simultaneously, each reveal is audit-logged independently, and both parties see them on their next `GET /profile/matches` call (the response to `/respond` itself already includes the initiator's handle/name for the responding applicant). A declined or withdrawn request leaves identities sealed.
- **Outcome gating** — once a match is `dating`, `POST /profile/matches/:id/outcome` enforces a minimum wait: 3 days before `failed` can be reported, 7 before `success` — encourages giving a match a real chance before either applicant can end it.
- **Rate limiting** — in-memory sliding-window limiter on all public, admin, and applicant-portal routes.
- **Orientation filter** — incompatible pairs are excluded *before* scoring, never just ranked low.
- **Account deletion** — applicants can deactivate immediately or schedule a deletion with a cancellable grace period.
