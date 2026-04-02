# AI Capability Assessment Tool

MVP thesis prototype for assessing whether an AI capability is ready for enterprise deployment.

This version is focused on the `Document Summarisation` capability and currently includes:

- a minimal dashboard home
- a guided `Start evaluation` flow
- support for `platform model` or `uploaded AI outputs`
- uploads for source documents, reference outputs, and policy files
- a thesis-aligned AWS MVP architecture defined in CDK

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## AWS MVP Infrastructure

The repository now includes an AWS CDK stack for the thesis MVP architecture:

- `S3` upload bucket for documents, reference outputs, policy files, and uploaded AI outputs
- `S3` artifact bucket for extracted assets, test cases, workflow artifacts, and reports
- `S3 + CloudFront` frontend hosting for the built React app
- `DynamoDB` table for evaluation metadata and status
- `API Gateway` HTTP API for presigned uploads and evaluation job endpoints
- `Step Functions` workflow for validation, case building, output resolution, scoring, and finalisation
- `Lambda` functions in `Python` for API handlers and workflow compute

### Current Workflow

1. User uploads files to S3 through presigned URLs.
2. User starts an evaluation through the API.
3. Step Functions runs the MVP pipeline:
   - validate input manifest
   - extract and normalise uploaded assets
   - build one summarisation test case per document
   - either generate platform outputs or load uploaded AI outputs
   - score the run and write a readiness result
   - persist the final report and status

### Infrastructure Commands

```bash
npm install
npm run build
npm run infra:synth
```

Bootstrap once per account/region:

```bash
npm run infra:bootstrap -- aws://ACCOUNT_ID/REGION
```

Deploy:

```bash
npm run infra:deploy
```

## GitHub Actions Deploy

The repository now includes `.github/workflows/deploy.yml`.

- pushes to `main` deploy the primary stack: `AiCapabilityAssessmentToolStack`
- pull requests targeting `main` deploy a preview stack: `AiCapabilityAssessmentToolPr<PR_NUMBER>`
- when a PR is closed, its preview stack is destroyed

Set these GitHub repository values before using the workflow:

- repository secret `AWS_ACCESS_KEY_ID`
- repository secret `AWS_SECRET_ACCESS_KEY`
- repository secret `AWS_REGION`

These credentials should belong to a dedicated IAM user for deployment and allow CDK deployment permissions.

### API Endpoints

- `POST /uploads/presign`
- `POST /evaluations`
- `GET /evaluations`
- `GET /evaluations/{evaluationId}`

### Notes

- The workflow currently scaffolds the MVP pipeline with placeholder extraction/output-generation logic so the architecture is deployable before the full evaluation engine is wired in.
- The stack uses permissive CORS for MVP convenience. Tighten this before any real production use.
- `npm run build` should be run before deployment so the frontend assets exist in `dist/`.
