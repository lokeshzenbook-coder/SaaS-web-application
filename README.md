# SaaS Web Application

[![CI](https://github.com/lokeshzenbook-coder/SaaS-web-application/actions/workflows/ci.yml/badge.svg)](https://github.com/lokeshzenbook-coder/SaaS-web-application/actions/workflows/ci.yml)
[![CodeQL](https://github.com/lokeshzenbook-coder/SaaS-web-application/actions/workflows/codeql.yml/badge.svg)](https://github.com/lokeshzenbook-coder/SaaS-web-application/actions/workflows/codeql.yml)

A full-stack SaaS starter: authentication, plan-based subscriptions, usage quotas, a rate-limited product API, and a dashboard — all in one small, dependency-light codebase.

Built with **Node.js + Express + SQLite** (`node:sqlite`, no native modules). The frontend is plain HTML/CSS/JS served by Express, so there is no build step.

## Features

- **Authentication** — register, login, logout with bcrypt-hashed passwords and httpOnly JWT cookies
- **Subscriptions** — Free / Pro / Enterprise plans with monthly pricing and simulated checkout (swap `mockCharge` for Stripe)
- **Usage quotas** — per-month call counters enforce plan limits and return friendly `429` responses when exhausted
- **API keys** — every account gets a scoped `sk_live_…` key to call the product API with per-plan rate limits
- **Rate limiting** — global limiter on auth endpoints + per-user limiter on the product API
- **Security** — security headers, input validation, no plaintext passwords, JWT secrets from env
- **Dashboard** — usage stats, API key, plan switching, and a live API playground
- **Tests** — end-to-end API suite using Node's built-in test runner (17 tests)
- **CI/CD** — end-to-end DevSecOps pipeline: secrets/SCA/SAST scanning, lint, tests, coverage, container scanning, SBOM, and Docker Hub publishing (see below)

## Getting started

Requires **Node.js ≥ 24** (for the built-in `node:sqlite` module).

```bash
npm install
cp .env.example .env   # optional; defaults are fine for local dev
npm start
```

Open http://localhost:3000, create an account, and you're on the Free plan.

```bash
npm run dev      # start with auto-reload
npm test         # run the API test suite
npm run lint     # ESLint
npm run format   # Prettier (format)
npm run format:check   # Prettier (verify)
```

## CI/CD

All workflows live in `.github/workflows/` and Dependabot updates dependencies automatically.

| Workflow     | Trigger                       | What it does                                                                                                                    |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`     | push to `main`, pull requests | End-to-end **DevSecOps pipeline** (12 stages, see below)                                                                        |
| `codeql.yml` | push, PRs, weekly             | GitHub CodeQL JavaScript security scanning                                                                                      |
| `deploy.yml` | push to `main` (app paths)    | Builds the image, scans with **Trivy**, publishes to **GHCR** (via OIDC), attaches **SLSA provenance**, optional SSH deploy job |

### DevSecOps pipeline (`ci.yml`)

| #   | Stage                | Tool                                                          |
| --- | -------------------- | ------------------------------------------------------------- |
| 1   | Checkout repo        | `actions/checkout` (full history)                             |
| 2   | Secrets scanning     | **Gitleaks** (fails on any leaked secret)                     |
| 3   | Dependency check     | **OWASP Dependency-Check** (SARIF + HTML report uploaded)     |
| 4   | Static code analysis | **Semgrep** (`p/owasp-top-ten`, SARIF → Security tab)         |
| 5   | Code quality & lint  | **ESLint** + Prettier check                                   |
| 6   | Unit tests           | Node built-in test runner (`node --test`)                     |
| 7   | Code coverage        | **c8** (~94% lines, HTML/lcov report uploaded)                |
| 8   | Build application    | `npm pack --dry-run`                                          |
| 9   | Build Docker image   | `docker/build-push-action` (loaded locally for scanning)      |
| 10  | Container image scan | **Trivy** + **Grype** (fail on HIGH/CRITICAL, SARIF uploaded) |
| 11  | SBOM generation      | **Syft** (CycloneDX, uploaded as artifact)                    |
| 12  | Push image           | **Docker Hub** (`latest` + short-sha tags, main branch only)  |

Steps 3 and 4 run with `continue-on-error` (NVD sync and Semgrep comment posting can be flaky); all their reports are still uploaded. Steps 10a/10b **gate the pipeline** — any HIGH/CRITICAL container finding fails the build.

To enable the Docker Hub push (step 12), add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets to the repo. The image is published as `<username>/saas-web-application:latest` and `:<short-sha>` on every push to `main`.

The separate CD workflow publishes to `ghcr.io/lokeshzenbook-coder/saas-web-application` with `:latest`, `:main`, and `:<sha>` tags. To enable the actual deployment step there, set the `DEPLOY_TARGET` secret and uncomment the example SSH deploy in `deploy.yml`.

## Running with Docker

Build and run with Docker Compose (the SQLite database is kept in a named volume so it survives restarts):

```bash
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  docker compose up -d --build
```

Then open http://localhost:3000. Stop with `docker compose down`; add `-v` to also delete the database volume.

Or build and run manually:

```bash
docker build -t saas-web-application .
docker run -d --name saas-web -p 3000:3000 \
  -e JWT_SECRET=some-long-random-secret \
  -v saas-data:/app/data \
  saas-web-application
```

## API

Base URL: `http://localhost:3000`

| Method | Endpoint                 | Auth        | Description                          |
| ------ | ------------------------ | ----------- | ------------------------------------ |
| GET    | `/healthz`               | –           | Health check                         |
| POST   | `/api/auth/register`     | –           | Create account (sets session cookie) |
| POST   | `/api/auth/login`        | –           | Log in (sets session cookie)         |
| POST   | `/api/auth/logout`       | cookie      | Clear session                        |
| GET    | `/api/auth/me`           | cookie      | Current user + API key               |
| GET    | `/api/plans`             | cookie      | List plans                           |
| POST   | `/api/billing/subscribe` | cookie      | Subscribe / change plan              |
| DELETE | `/api/billing/subscribe` | cookie      | Cancel subscription (back to Free)   |
| GET    | `/api/dashboard/stats`   | cookie      | Usage, plan, subscription status     |
| GET    | `/api/v1/echo`           | `X-API-Key` | Product API echo                     |
| POST   | `/api/v1/data`           | `X-API-Key` | Product API call (consumes quota)    |

Example product API call:

```bash
curl -X POST http://localhost:3000/api/v1/data \
  -H "X-API-Key: sk_live_…" \
  -H "Content-Type: application/json" \
  -d '{"value":"hello"}'
```

### Error format

All errors return a consistent shape:

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "Monthly quota exceeded (1000/1000). Upgrade your plan."
  }
}
```

Common codes: `validation_error`, `email_taken`, `invalid_credentials`, `invalid_token`, `invalid_api_key`, `quota_exceeded`, `rate_limited`, `not_found`.

## Project structure

```
├── public/               # Frontend (HTML/CSS/JS)
│   ├── index.html        # Landing page
│   ├── login.html
│   ├── register.html
│   ├── dashboard.html
│   ├── css/style.css
│   └── js/
├── src/
│   ├── server.js         # Entrypoint
│   ├── app.js            # Express app assembly
│   ├── config.js         # Env-driven config
│   ├── db.js             # SQLite schema + queries
│   ├── middleware/
│   │   ├── auth.js       # JWT + API-key auth
│   │   ├── errors.js     # Error handling
│   │   ├── rateLimit.js  # Sliding-window rate limiter
│   │   └── security.js   # Security headers
│   ├── routes/
│   │   ├── auth.js
│   │   ├── plans.js
│   │   ├── billing.js
│   │   ├── dashboard.js
│   │   └── api.js        # Product API (quota + rate limited)
│   └── utils/
├── test/api.test.js      # End-to-end API tests
└── package.json
```

## Configuration

All settings are read from environment variables (see `.env.example`):

| Variable         | Default        | Description                |
| ---------------- | -------------- | -------------------------- |
| `PORT`           | `3000`         | HTTP port                  |
| `HOST`           | `0.0.0.0`      | Bind address               |
| `JWT_SECRET`     | `dev-only…`    | **Change in production**   |
| `JWT_EXPIRES_IN` | `7d`           | Session lifetime           |
| `BCRYPT_ROUNDS`  | `10`           | Password hash cost         |
| `RATE_LIMIT_MAX` | `100`          | Global limit per window/IP |
| `RATE_WINDOW_MS` | `60000`        | Global rate-limit window   |
| `DB_FILE`        | `data/saas.db` | SQLite database path       |

## Production notes

- Set a strong `JWT_SECRET` and `NODE_ENV=production` (this makes cookies `Secure`).
- Connect a real payment provider (Stripe, Paddle, …) in place of `mockCharge`.
- Add email verification / password reset as needed.
- The in-memory rate limiter is per-process; use a shared store (Redis) when scaling horizontally.

> > > > > > > 0f50472 (Scaffold SaaS starter: auth, subscriptions, quotas, REST API, dashboard)
