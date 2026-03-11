import { Environments } from './types';

export const environments: Environments = {
  dev: {
    account: process.env.DEV_ACCOUNT_ID || '123456789012',
    region: process.env.DEV_REGION || 'us-east-1',
    tags: {
      Project: 'BkPeru',
      ManagedBy: 'CDK',
      Environment: 'dev',
      CostCenter: 'Development',
    },
    vpc: {
      maxAzs: 2,
      natGateways: 1,
    },
    rds: {
      instanceType: 'db.t4g.micro',
      multiAz: false,
      enableRdsProxy: false,
      allocatedStorage: 20,
      storageType: 'GP3',
      enablePerformanceInsights: true,
      databaseName: 'BkPeru_dev',
      engineVersion: '16.6',
      removalPolicy: 'DESTROY',
    },
    s3: {
      staticBucketPrefix: 'bk-peru-static-dev',
      documentsBucketPrefix: 'bk-peru-documents-dev',
      versioned: false,
      removalPolicy: 'DESTROY',
    },
    cloudfront: {
      priceClass: 'PriceClass_100',
      enableLogging: false,
    },
    apiGateway: {
      apiName: 'bk-peru-api-dev',
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      quota: {
        limit: 500,
        period: 'DAY',
      },
    },
    ecs: {
      clusterName: 'bk-peru-cluster-dev',
      bkPeruMngr: {
        desiredCount: 0,
        cpu: 256,
        memory: 512,
        containerPort: 3000,
      },
    },
    ecr: {
      removalPolicy: 'DESTROY',
    },
    lambda: {
      memorySize: 256,
      timeout: 10,
    },
    dynamodb: {
      tableName: 'bk-peru-table-dev',
      billingMode: 'PAY_PER_REQUEST',
      removalPolicy: 'DESTROY',
    },
    cognito: {
      userPoolName: 'bk-peru-user-pool-dev',
      selfSignUpEnabled: true,
    },
  },
  prod: {
    account: process.env.PROD_ACCOUNT_ID || '987654321098',
    region: process.env.PROD_REGION || 'us-east-1',
    tags: {
      Project: 'BkPeru',
      ManagedBy: 'CDK',
      Environment: 'prod',
      CostCenter: 'Production',
      Compliance: 'Required',
    },
    vpc: {
      maxAzs: 2,
      natGateways: 2,
    },
    rds: {
      instanceType: 'db.t4g.small',
      multiAz: true,
      enableRdsProxy: false,
      allocatedStorage: 20,
      storageType: 'GP3',
      enablePerformanceInsights: true,
      databaseName: 'BkPeru_prod',
      engineVersion: '16.6',
      removalPolicy: 'SNAPSHOT',
    },
    s3: {
      staticBucketPrefix: 'bk-peru-static-prod',
      documentsBucketPrefix: 'bk-peru-documents-prod',
      versioned: true,
      removalPolicy: 'RETAIN',
    },
    cloudfront: {
      priceClass: 'PriceClass_All',
      enableLogging: true,
    },
    apiGateway: {
      apiName: 'bk-peru-api-prod',
      throttle: {
        rateLimit: 200,
        burstLimit: 400,
      },
      quota: {
        limit: 20000,
        period: 'DAY',
      },
    },
    ecs: {
      clusterName: 'bk-peru-cluster-prod',
      bkPeruMngr: {
        desiredCount: 1,
        cpu: 512,
        memory: 1024,
        containerPort: 3000,
      },
    },
    ecr: {
      removalPolicy: 'RETAIN',
    },
    lambda: {
      memorySize: 512,
      timeout: 15,
    },
    dynamodb: {
      tableName: 'bk-peru-table-prod',
      billingMode: 'PAY_PER_REQUEST',
      removalPolicy: 'RETAIN',
    },
    cognito: {
      userPoolName: 'bk-peru-user-pool-prod',
      selfSignUpEnabled: false,
    },
  },
};
