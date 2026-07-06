# Purpose Investor Network — Local Backend & S3 upload

This project contains a static front-end and a minimal Node/Express backend for collecting survey results.

Features:
- `front-end/pin-member-questionnaire.html` — survey UI
- `front-end/index.html` — front-end landing page
- `backend/index.js` — lightweight Express server that stores responses in a local SQLite DB by default
- Optional: upload survey JSON to an S3 bucket if `AWS_S3_BUCKET` is set

## Local development

Requirements:
- Node.js (16+ recommended)
- npm

Install dependencies:

```bash
npm install
```

Run the server:

```bash
npm start
```

Run tests:

```bash
npm test
```

Open the survey in your browser:

```
http://localhost:3000/pin-member-questionnaire.html
```

When running locally with the backend, the front-end assets are served from `front-end/`.

Submitted responses are stored in `survey.db` (SQLite). The file is created automatically.

## Optional: Upload responses to S3

You can configure the server to also upload each response as a JSON object to an S3 bucket.

1. Create an S3 bucket in your AWS account (or reuse an existing one).
2. Provide credentials to the server via environment variables (the AWS SDK will use standard credential resolution chains):

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-2
export AWS_S3_BUCKET=your-bucket-name
npm start
```

When `AWS_S3_BUCKET` is set, each submission will be saved to `responses/<timestamp>-<rand>.json` in that bucket, and the API will return the S3 key.

## Optional: Save responses to AWS DynamoDB

For AWS-backed storage, set up a DynamoDB table and configure the following variables:

```bash
export AWS_REGION=us-east-2
export AWS_DYNAMODB_TABLE=your-table-name
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

Your DynamoDB table should use a partition key named `id` of type `String`.

You can create this table manually in the AWS Console, or deploy the included CloudFormation template:

```bash
aws cloudformation deploy \
  --template-file infra/dynamodb-table.yml \
  --stack-name pin-survey-db
```

When `AWS_DYNAMODB_TABLE` is set, the server writes each response to DynamoDB as well as SQLite locally. The admin dashboard will read from DynamoDB when available.

## Deploy backend to Lambda

The backend can be deployed as a Lambda-backed HTTP API using the CloudFormation template in `infra/backend.yml`.

1. Build and package the Lambda code:

```bash
npm install
npm run package:backend
```

2. Upload `dist/backend.zip` to an S3 bucket.

3. Deploy the backend stack:

```bash
aws cloudformation deploy \
  --template-file infra/backend.yml \
  --stack-name pin-backend \
  --parameter-overrides \
      DeploymentBucket=your-s3-bucket \
      DeploymentKey=dist/backend.zip \
      DDBTableName=purpose-investor-network-survey-responses \
      SentryDsn=https://examplePublicKey@o0.ingest.sentry.io/0 \
      Environment=production
```

4. Use the API endpoint from the CloudFormation output as the backend host for your deployed front-end.

### Admin login

The backend now includes a simple admin login available at:

```
http://localhost:3000/login
```

Set credentials with:

```bash
export ADMIN_USER=admin
export ADMIN_PASS=strongpassword
export SESSION_SECRET=some-secret-value
```

After logging in, visit:

```
http://localhost:3000/admin
```

This page displays up to the most recent 200 survey responses.

## Deploying the front-end to S3 (static site)

This repository already includes a GitHub Actions workflow that syncs the repo to an S3 bucket on pushes to `main`. Configure the following secrets in your repository settings:
- `AWS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Note: hosting the static files on S3 makes them publicly available; you still need a server (or serverless endpoint) to accept survey POSTs. You can either:

- Host the Node server on an EC2 instance / Elastic Beanstalk / ECS and point the front-end to that API host.
- Create a serverless API (API Gateway + Lambda) that writes to S3 or DynamoDB and update the front-end `fetch` URL accordingly.

If you'd like, I can scaffold a serverless Lambda handler that receives survey POSTs and writes to S3 directly.

## Analytics (PostHog + Plausible)

This project includes lightweight support for client-side analytics and a server-side `/api/track` endpoint that records events to the local SQLite DB and optionally forwards them to PostHog.

Client-side:
- Plausible: add your `data-domain` in the `<script>` tag included in the HTML files.
- PostHog: update the `POSTHOG_KEY` in the page snippets or set up `POSTHOG_HOST`/`POSTHOG_API_KEY` for server forwarding.
- Sentry Browser: set `SENTRY_BROWSER_DSN` for frontend error and performance monitoring.

Server-side forwarding:
- Set `POSTHOG_API_KEY` (project API key) and optionally `POSTHOG_HOST` (defaults to `https://app.posthog.com`) before starting the server to forward events to PostHog.

Recommended Sentry setup:
- Create a Node.js project in Sentry for backend errors and tracing.
- Create a JavaScript (Browser) project in Sentry for frontend errors and performance.
- You can also use one project for both, but separate projects make backend vs browser issues easier to separate.

Example environment variables:

```bash
export POSTHOG_API_KEY=phc_...
export POSTHOG_HOST=https://app.posthog.com
export SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
export SENTRY_BROWSER_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
export SENTRY_TRACES_SAMPLE_RATE=0.05
export SENTRY_BROWSER_TRACES_SAMPLE_RATE=0.05
export SENTRY_RELEASE=purpose-investor-network@1.0.0
export SENTRY_ENVIRONMENT=production
```

Events tracked by default:
- `cta_click` (when CTAs are clicked)
- `survey_completed` (when survey is submitted)

You can also post arbitrary events to the server endpoint:

```bash
curl -X POST http://localhost:3000/api/track -H 'Content-Type: application/json' -d '{"event":"test","properties":{"foo":"bar"}}'
```

## Notes

- `survey.db` is in `.gitignore` and will not be uploaded to version control.
- For production use, consider using DynamoDB or RDS for scalable, queryable storage and add authentication/anti-spam measures.
