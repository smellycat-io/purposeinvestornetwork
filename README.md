# Purpose Investor Network — Local Backend & S3 upload

This project contains a static front-end and a minimal Node/Express backend for collecting survey results.

Features:
- `pin-member-questionnaire.html` — survey UI
- `server.js` — lightweight Express server that stores responses in a local SQLite DB by default
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

## Notes

- `survey.db` is in `.gitignore` and will not be uploaded to version control.
- For production use, consider using DynamoDB or RDS for scalable, queryable storage and add authentication/anti-spam measures.
