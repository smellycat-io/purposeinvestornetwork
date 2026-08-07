#!/usr/bin/env node
/**
 * Generates private/backend/package.json from the root package.json's "dependencies".
 *
 * Why: the Lambda deploy zips up private/backend/ and runs `npm install` there, so it
 * needs its own package.json. Keeping that hand-written and separate from the
 * root package.json is how we ended up with a Lambda missing serverless-http
 * (the file drifted / got committed to the wrong folder). Generating it from
 * the root package.json means there's exactly one place dependencies are
 * declared, and this can never fall out of sync.
 *
 * devDependencies (jest, supertest, etc.) are intentionally excluded — those
 * are only used by private/backend/server.test.js, which isn't part of the deployed
 * Lambda.
 *
 * Run manually with: node scripts/generate-backend-package.js
 * Also run automatically in CI before `npm install` in the backend deploy step.
 */

const fs = require('fs');
const path = require('path');

const rootPkgPath = path.join(__dirname, '..', 'package.json');
const outPath = path.join(__dirname, '..', 'private', 'backend', 'package.json');

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

const backendPkg = {
  name: 'purpose-investor-network-backend',
  version: '1.0.0',
  private: true,
  main: 'lambda.js',
  dependencies: rootPkg.dependencies || {},
};

fs.writeFileSync(outPath, JSON.stringify(backendPkg, null, 2) + '\n');

console.log(
  `Generated private/backend/package.json with ${Object.keys(backendPkg.dependencies).length} dependencies:`,
  Object.keys(backendPkg.dependencies).join(', ')
);
