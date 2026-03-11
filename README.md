# BK Peru IAC

Infrastructure as Code for the BK Peru platform, built with AWS CDK (TypeScript).

## Architecture

- **VPC**: Default VPC with security groups for ECS and RDS
- **RDS**: PostgreSQL instance (private subnet)
- **S3 + CloudFront**: Static frontend hosting with OAC
- **ECR**: Container image registry for the API
- **ECS Fargate**: Containerized backend service
- **NLB**: Private Network Load Balancer
- **API Gateway**: REST API with VPC Link → NLB → ECS integration
- **Secrets Manager**: Database credentials, JWT secret, and API key

## Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK installed globally: `npm install -g aws-cdk`

## Setup

```bash
npm install
```

## Useful Commands

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript |
| `npm run watch` | Watch for changes and compile |
| `npm test` | Run unit tests |
| `ENVIRONMENT=dev cdk synth` | Synthesize CloudFormation template (dev) |
| `ENVIRONMENT=dev cdk diff` | Show diff against deployed stack (dev) |
| `ENVIRONMENT=dev cdk deploy` | Deploy to development |
| `ENVIRONMENT=prod cdk deploy` | Deploy to production |

## Environments

| Variable | Description |
|---|---|
| `DEV_ACCOUNT_ID` | AWS account ID for development |
| `DEV_REGION` | AWS region for development |
| `PROD_ACCOUNT_ID` | AWS account ID for production |
| `PROD_REGION` | AWS region for production |
| `DEV_OIDC_ROLE_ARN` | OIDC role ARN for dev pipeline authentication |
| `PROD_OIDC_ROLE_ARN` | OIDC role ARN for prod pipeline authentication |

## Pipeline (Bitbucket)

- **PR branches**: synth + diff for both environments + Jira ticket validation
- **develop branch**: synth → diff → deploy (dev), manual trigger
- **main branch**: synth → diff → deploy (prod), manual trigger + Jira ticket update
