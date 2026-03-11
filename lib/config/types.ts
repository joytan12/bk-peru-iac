export interface EnvironmentConfig {
  account: string;
  region: string;
  tags: Record<string, string>;
  vpc: VpcConfig;
  rds: RdsConfig;
  s3: S3Config;
  cloudfront: CloudFrontConfig;
  apiGateway: ApiGatewayConfig;
  ecs: EcsConfig;
  ecr: EcrConfig;
  lambda: LambdaConfig;
  dynamodb: DynamoDbConfig;
  cognito: CognitoConfig;
}

// ── VPC ────────────────────────────────────────────────────────────────────────
export interface VpcConfig {
  /** Number of Availability Zones to use (>= 2 recommended for HA). */
  maxAzs: number;
  /** Number of NAT Gateways to deploy (1 for dev, 1-per-AZ for prod). */
  natGateways: number;
}

// ── RDS ────────────────────────────────────────────────────────────────────────
export interface RdsConfig {
  instanceType: string;
  multiAz: boolean;
  enableRdsProxy: boolean;
  allocatedStorage: number;
  storageType: 'GP2' | 'GP3' | 'IO1';
  enablePerformanceInsights: boolean;
  databaseName: string;
  engineVersion: string;
  removalPolicy: 'DESTROY' | 'RETAIN' | 'SNAPSHOT';
}

// ── S3 ─────────────────────────────────────────────────────────────────────────
export interface S3Config {
  /** Bucket name for the React Native / web frontend (served via CloudFront). */
  staticBucketPrefix: string;
  /** Bucket name for documents stored and consumed by ECS. */
  documentsBucketPrefix: string;
  versioned: boolean;
  removalPolicy: 'DESTROY' | 'RETAIN';
}

// ── CloudFront ─────────────────────────────────────────────────────────────────
export interface CloudFrontConfig {
  priceClass: 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All';
  enableLogging: boolean;
}

// ── API Gateway ────────────────────────────────────────────────────────────────
export interface ApiGatewayConfig {
  apiName: string;
  throttle: {
    rateLimit: number;
    burstLimit: number;
  };
  quota: {
    limit: number;
    period: 'DAY' | 'WEEK' | 'MONTH';
  };
}

// ── ECS ────────────────────────────────────────────────────────────────────────
export interface EcsConfig {
  clusterName: string;
  bkPeruMngr: {
    desiredCount: number;
    cpu: number;
    memory: number;
    containerPort: number;
  };
}

// ── ECR ────────────────────────────────────────────────────────────────────────
export interface EcrConfig {
  removalPolicy: 'DESTROY' | 'RETAIN' | 'SNAPSHOT';
}

// ── Lambda ─────────────────────────────────────────────────────────────────────
export interface LambdaConfig {
  /** Lambda memory in MB. */
  memorySize: number;
  /** Lambda timeout in seconds. */
  timeout: number;
}

// ── DynamoDB ───────────────────────────────────────────────────────────────────
export interface DynamoDbConfig {
  tableName: string;
  billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
  removalPolicy: 'DESTROY' | 'RETAIN';
}

// ── Cognito ────────────────────────────────────────────────────────────────────
export interface CognitoConfig {
  userPoolName: string;
  /** Allow end-users to self-register (false in prod is typical). */
  selfSignUpEnabled: boolean;
}

export type Environment = 'dev' | 'prod';

export type Environments = {
  [K in Environment]: EnvironmentConfig;
};
