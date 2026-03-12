import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { EnvironmentConfig } from './config/types';
import path from 'path';
import fs from 'fs';

export interface BkPeruIacStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
}

export class BkPeruIacStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BkPeruIacStackProps) {
    super(scope, id, props);

    const { envConfig } = props;

    const removalPolicyMap: Record<string, cdk.RemovalPolicy> = {
      DESTROY: cdk.RemovalPolicy.DESTROY,
      RETAIN: cdk.RemovalPolicy.RETAIN,
      SNAPSHOT: cdk.RemovalPolicy.SNAPSHOT,
    };

    // =========================================================================
    // VPC â€” 3 subnet tiers
    //
    //  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
    //  â”‚  Public (NAT GW / IGW)                                  â”‚
    //  â”‚  CloudFront + S3 frontend are regional (no VPC binding) â”‚
    //  â”‚  Cognito + API Gateway are regional (no VPC binding)    â”‚
    //  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
    //  â”‚  Private  (PRIVATE_WITH_EGRESS via NAT)                 â”‚
    //  â”‚  â–¸ Lambda â€” Cognito pre-authentication trigger          â”‚
    //  â”‚  â–¸ RDS PostgreSQL â€” user data store                     â”‚
    //  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
    //  â”‚  ECS  (PRIVATE_WITH_EGRESS via NAT)                     â”‚
    //  â”‚  â–¸ ECS Fargate â€” core application service               â”‚
    //  â”‚  â–¸ NLB â€” private load balancer                          â”‚
    //  â”‚  â–¸ DynamoDB (regional, accessed via Gateway endpoint)   â”‚
    //  â”‚  â–¸ S3 documents bucket (regional, Gateway endpoint)     â”‚
    //  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
    // =========================================================================
    const vpc = new ec2.Vpc(this, 'BkPeruVpc', {
      maxAzs: envConfig.vpc.maxAzs,
      natGateways: envConfig.vpc.natGateways,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          // Lambda + RDS
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          // ECS Fargate + NLB
          name: 'ECS',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Gateway endpoints â€” no hourly cost, traffic stays within AWS backbone
    vpc.addGatewayEndpoint('S3GatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    vpc.addGatewayEndpoint('DynamoDbGatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // =========================================================================
    // Security Groups
    // =========================================================================
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      securityGroupName: `lambda-sg-bk-peru-${envConfig.tags.Environment}`,
      description: 'Cognito pre-auth Lambda â€” outbound only (reaches RDS and AWS APIs via NAT)',
      allowAllOutbound: true,
    });

    const rdsSg = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc,
      securityGroupName: `rds-sg-bk-peru-${envConfig.tags.Environment}`,
      description: 'RDS PostgreSQL â€” inbound from Lambda only',
      allowAllOutbound: false,
    });
    // Lambda â†’ RDS
    rdsSg.addIngressRule(lambdaSg, ec2.Port.tcp(5432), 'Lambda to RDS PostgreSQL');

    const nlbSg = new ec2.SecurityGroup(this, 'NlbSecurityGroup', {
      vpc,
      securityGroupName: `nlb-sg-bk-peru-${envConfig.tags.Environment}`,
      description: 'Private NLB â€” inbound from API Gateway VPC Link',
      allowAllOutbound: true,
    });
    nlbSg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80), 'VPC CIDR to NLB port 80');

    const ecsSg = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      securityGroupName: `ecs-sg-bk-peru-${envConfig.tags.Environment}`,
      description: 'ECS Fargate â€” inbound from NLB only',
      allowAllOutbound: true,
    });
    ecsSg.addIngressRule(
      nlbSg,
      ec2.Port.tcp(envConfig.ecs.bkPeruMngr.containerPort),
      'NLB to ECS container port',
    );

    // =========================================================================
    // Secrets Manager
    // =========================================================================
    const databaseSecret = new secretsmanager.Secret(this, 'BkPeruDbSecret', {
      secretName: `bk-peru-db-${envConfig.tags.Environment}`,
      description: `BkPeru RDS credentials for ${envConfig.tags.Environment}`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'bkperu_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
      removalPolicy: this.getNonSnapshotRemovalPolicy(envConfig.rds.removalPolicy),
    });

    const jwtSecret = new secretsmanager.Secret(this, 'BkPeruJwtSecret', {
      secretName: `bk-peru-jwt-${envConfig.tags.Environment}`,
      description: `BkPeru JWT secret for ${envConfig.tags.Environment}`,
      secretObjectValue: {
        JWT_SECRET: cdk.SecretValue.unsafePlainText('CHANGE_ME_IN_PRODUCTION'),
      },
      removalPolicy: this.getNonSnapshotRemovalPolicy(envConfig.rds.removalPolicy),
    });

    // =========================================================================
    // RDS PostgreSQL â€” Private subnets (Subnet tier 2)
    // =========================================================================
    const storageTypeMap: Record<string, rds.StorageType> = {
      GP2: rds.StorageType.GP2,
      GP3: rds.StorageType.GP3,
      IO1: rds.StorageType.IO1,
    };

    const [majorVersion] = envConfig.rds.engineVersion.split('.');

    const rdsSubnetGroup = new rds.SubnetGroup(this, 'RdsSubnetGroup', {
      vpc,
      description: 'RDS subnet group â€” Private subnets',
      vpcSubnets: { subnetGroupName: 'Private' },
    });

    const dbInstance = new rds.DatabaseInstance(this, 'PostgresInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of(envConfig.rds.engineVersion, majorVersion),
      }),
      instanceType: new ec2.InstanceType(envConfig.rds.instanceType.replace(/^db\./, '')),
      vpc,
      vpcSubnets: { subnetGroupName: 'Private' },
      subnetGroup: rdsSubnetGroup,
      securityGroups: [rdsSg],
      databaseName: envConfig.rds.databaseName,
      multiAz: envConfig.rds.multiAz,
      allocatedStorage: envConfig.rds.allocatedStorage,
      storageType: storageTypeMap[envConfig.rds.storageType],
      enablePerformanceInsights: envConfig.rds.enablePerformanceInsights,
      removalPolicy: removalPolicyMap[envConfig.rds.removalPolicy],
      deletionProtection: envConfig.rds.removalPolicy === 'RETAIN',
      credentials: rds.Credentials.fromSecret(databaseSecret),
    });

    const databaseUrl = `postgresql://${databaseSecret.secretValueFromJson('username').unsafeUnwrap()}:${databaseSecret.secretValueFromJson('password').unsafeUnwrap()}@${dbInstance.dbInstanceEndpointAddress}:5432/${envConfig.rds.databaseName}`;

    const masterDatabaseSecret = new secretsmanager.Secret(this, 'BkPeruMasterDbSecret', {
      secretName: `bk-peru-database-url-${envConfig.tags.Environment}`,
      description: `BkPeru full DATABASE_URL for ${envConfig.tags.Environment}`,
      secretObjectValue: {
        DATABASE_URL: cdk.SecretValue.unsafePlainText(databaseUrl),
      },
      removalPolicy: this.getNonSnapshotRemovalPolicy(envConfig.rds.removalPolicy),
    });

    // =========================================================================
    // Lambda â€” Cognito pre-authentication trigger (Private subnets, Subnet tier 2)
    //
    // Flow: Cognito â†’ Lambda â†’ RDS (validates user is active)
    // =========================================================================
    const authLambdaLogGroup = new logs.LogGroup(this, 'AuthLambdaLogGroup', {
      logGroupName: `/aws/lambda/bk-peru-cognito-auth-${envConfig.tags.Environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const authLambdaRole = new iam.Role(this, 'AuthLambdaRole', {
      roleName: `bk-peru-cognito-auth-role-${envConfig.tags.Environment}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      // AWSLambdaVPCAccessExecutionRole grants VPC ENI + basic CloudWatch Logs permissions
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        SecretsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [masterDatabaseSecret.secretArn],
            }),
          ],
        }),
      },
    });

    const authLambda = new lambda.Function(this, 'CognitoAuthLambda', {
      functionName: `bk-peru-cognito-auth-${envConfig.tags.Environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src', 'lambda', 'cognito-auth')),
      vpc,
      vpcSubnets: { subnetGroupName: 'Private' },
      securityGroups: [lambdaSg],
      role: authLambdaRole,
      timeout: cdk.Duration.seconds(envConfig.lambda.timeout),
      memorySize: envConfig.lambda.memorySize,
      logGroup: authLambdaLogGroup,
      environment: {
        DATABASE_URL_SECRET_ARN: masterDatabaseSecret.secretArn,
        ENVIRONMENT: envConfig.tags.Environment,
      },
    });

    // =========================================================================
    // Cognito â€” User Pool (Subnet tier 1: public/regional service)
    //
    // Flow: Frontend â†’ Cognito (pre-auth trigger â†’ Lambda â†’ RDS) â†’ JWT
    // =========================================================================
    const userPool = new cognito.UserPool(this, 'BkPeruUserPool', {
      userPoolName: envConfig.cognito.userPoolName,
      selfSignUpEnabled: envConfig.cognito.selfSignUpEnabled,
      signInAliases: { email: true, username: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      lambdaTriggers: {
        preAuthentication: authLambda,
      },
      removalPolicy: envConfig.rds.removalPolicy === 'RETAIN'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'BkPeruUserPoolClient', {
      userPool,
      userPoolClientName: `bk-peru-client-${envConfig.tags.Environment}`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });

    // =========================================================================
    // S3 â€” Frontend bucket (Subnet tier 1: public, served via CloudFront)
    // =========================================================================
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: envConfig.s3.staticBucketPrefix,
      versioned: envConfig.s3.versioned,
      removalPolicy: removalPolicyMap[envConfig.s3.removalPolicy],
      autoDeleteObjects: envConfig.s3.removalPolicy === 'DESTROY',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    const priceClassMap: Record<string, cloudfront.PriceClass> = {
      PriceClass_100: cloudfront.PriceClass.PRICE_CLASS_100,
      PriceClass_200: cloudfront.PriceClass.PRICE_CLASS_200,
      PriceClass_All: cloudfront.PriceClass.PRICE_CLASS_ALL,
    };

    const distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      priceClass: priceClassMap[envConfig.cloudfront.priceClass],
      enableLogging: envConfig.cloudfront.enableLogging,
      errorResponses: [
        { httpStatus: 400, ttl: cdk.Duration.seconds(10), responsePagePath: '/index.html', responseHttpStatus: 200 },
        { httpStatus: 403, ttl: cdk.Duration.seconds(10), responsePagePath: '/index.html', responseHttpStatus: 200 },
        { httpStatus: 404, ttl: cdk.Duration.seconds(10), responsePagePath: '/index.html', responseHttpStatus: 200 },
      ],
    });

    // =========================================================================
    // S3 â€” Documents bucket (ECS tier: accessed by ECS via Gateway endpoint)
    // =========================================================================
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: envConfig.s3.documentsBucketPrefix,
      versioned: true,
      removalPolicy: removalPolicyMap[envConfig.s3.removalPolicy],
      autoDeleteObjects: envConfig.s3.removalPolicy === 'DESTROY',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // =========================================================================
    // DynamoDB â€” Main table (ECS tier, accessed via Gateway endpoint)
    // =========================================================================
    const dynamoTable = new dynamodb.Table(this, 'BkPeruTable', {
      tableName: envConfig.dynamodb.tableName,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: envConfig.dynamodb.billingMode === 'PAY_PER_REQUEST'
        ? dynamodb.BillingMode.PAY_PER_REQUEST
        : dynamodb.BillingMode.PROVISIONED,
      pointInTimeRecovery: envConfig.tags.Environment === 'prod',
      removalPolicy: removalPolicyMap[envConfig.dynamodb.removalPolicy],
    });

    // =========================================================================
    // CloudWatch Logs + IAM â€” ECS (ECS tier)
    // =========================================================================
    const ecsLogGroup = new logs.LogGroup(this, 'BkPeruEcsLogGroup', {
      logGroupName: `/ecs/bk-peru-${envConfig.tags.Environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ecsLogsPolicy = new iam.ManagedPolicy(this, 'EcsCloudWatchLogsPolicy', {
      managedPolicyName: `ecs-cw-bk-peru-${envConfig.tags.Environment}`,
      description: 'ECS tasks â€” CloudWatch Logs write access',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:CreateLogGroup'],
          resources: [ecsLogGroup.logGroupArn, `${ecsLogGroup.logGroupArn}:*`],
        }),
      ],
    });

    const ecsTaskExecutionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      roleName: `ecs-bk-peru-execution-role-${envConfig.tags.Environment}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [ecsLogsPolicy],
      inlinePolicies: {
        EcrAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage',
              ],
              resources: ['*'],
            }),
          ],
        }),
        SecretsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [masterDatabaseSecret.secretArn, jwtSecret.secretArn],
            }),
          ],
        }),
      },
    });

    const ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      roleName: `ecs-bk-peru-task-role-${envConfig.tags.Environment}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [ecsLogsPolicy],
    });

    // ECS task role: read/write DynamoDB and documents S3 bucket
    dynamoTable.grantReadWriteData(ecsTaskRole);
    documentsBucket.grantReadWrite(ecsTaskRole);

    // =========================================================================
    // ECR â€” Container image repository
    // =========================================================================
    const ecrRepository = new ecr.Repository(this, 'BkPeruEcrRepo', {
      repositoryName: 'bk-peru-api',
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: this.getRemovalPolicy(envConfig.ecr.removalPolicy),
      lifecycleRules: [
        { description: 'Keep last 5 images', maxImageCount: 5 },
        { description: 'Remove untagged after 1 day', tagStatus: ecr.TagStatus.UNTAGGED, maxImageAge: cdk.Duration.days(1) },
      ],
    });

    // =========================================================================
    // ECS â€” Cluster + Fargate Service (Subnet tier 3)
    // =========================================================================
    const targetGroup = new elbv2.NetworkTargetGroup(this, 'BkPeruTargetGroup', {
      vpc,
      port: envConfig.ecs.bkPeruMngr.containerPort,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        protocol: elbv2.Protocol.TCP,
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    const cluster = new ecs.Cluster(this, 'BkPeruEcsCluster', {
      clusterName: envConfig.ecs.clusterName,
      vpc,
      enableFargateCapacityProviders: true,
      containerInsights: true,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'BkPeruTaskDef', {
      family: `bk-peru-${envConfig.tags.Environment}`,
      cpu: envConfig.ecs.bkPeruMngr.cpu,
      memoryLimitMiB: envConfig.ecs.bkPeruMngr.memory,
      executionRole: ecsTaskExecutionRole,
      taskRole: ecsTaskRole,
    });

    const imageTag = envConfig.tags.Environment === 'prod' ? 'latest' : 'beta';
    taskDefinition.addContainer('bk-peru-container', {
      containerName: 'bk-peru-service',
      image: ecs.ContainerImage.fromRegistry(`${ecrRepository.repositoryUri}:${imageTag}`),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'bk-peru',
        logGroup: ecsLogGroup,
      }),
      portMappings: [
        { containerPort: envConfig.ecs.bkPeruMngr.containerPort, protocol: ecs.Protocol.TCP },
      ],
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(masterDatabaseSecret, 'DATABASE_URL'),
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, 'JWT_SECRET'),
      },
      environment: {
        DYNAMODB_TABLE_NAME: dynamoTable.tableName,
        DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
        ENVIRONMENT: envConfig.tags.Environment,
      },
    });

    const ecsService = new ecs.FargateService(this, 'BkPeruFargateService', {
      cluster,
      taskDefinition,
      serviceName: 'bk-peru-service',
      desiredCount: envConfig.ecs.bkPeruMngr.desiredCount,
      vpcSubnets: { subnetGroupName: 'ECS' },
      securityGroups: [ecsSg],
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
    });

    ecsService.attachToNetworkTargetGroup(targetGroup);
    dbInstance.secret?.grantRead(ecsTaskRole);

    // =========================================================================
    // NLB â€” Private, in ECS subnets (Subnet tier 3)
    // =========================================================================
    const nlb = new elbv2.NetworkLoadBalancer(this, 'BkPeruNlb', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetGroupName: 'ECS' },
      securityGroups: [nlbSg],
      crossZoneEnabled: true,
    });

    nlb.addListener('BkPeruListener', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [targetGroup],
    });

    // =========================================================================
    // VPC Link â€” API Gateway â†’ NLB
    // =========================================================================
    const vpcLink = new apigateway.VpcLink(this, 'BkPeruVpcLink', {
      vpcLinkName: `${envConfig.apiGateway.apiName}-vpc-link`,
      targets: [nlb],
      description: `VPC Link for ${envConfig.tags.Environment}`,
    });

    // =========================================================================
    // API Gateway â€” REST API with Cognito authorizer (Subnet tier 1: public/regional)
    //
    // Flow: Frontend (JWT) â†’ API GW (Cognito authorizer) â†’ VPC Link â†’ NLB â†’ ECS
    // =========================================================================
    const apiGwCwRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
      ],
    });
    new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGwCwRole.roleArn,
    });

    const openApiTemplatePath = path.join(__dirname, 'openapi', 'api-definition.json');
    const openApiTemplate = fs.readFileSync(openApiTemplatePath, 'utf8');
    const openApiDefinition = openApiTemplate
      .replace(/\{\{vpcLinkId\}\}/g, vpcLink.vpcLinkId)
      .replace(/\{\{nlbDnsName\}\}/g, nlb.loadBalancerDnsName)
      .replace(/\{\{stageRoute\}\}/g, envConfig.tags.Environment)
      .replace(/\{\{userPoolArn\}\}/g, userPool.userPoolArn);

    const api = new apigateway.SpecRestApi(this, 'BkPeruApi', {
      restApiName: envConfig.apiGateway.apiName,
      description: `BK Peru REST API for ${envConfig.tags.Environment}`,
      apiDefinition: apigateway.ApiDefinition.fromInline(JSON.parse(openApiDefinition)),
      deployOptions: {
        stageName: envConfig.tags.Environment,
        throttlingRateLimit: envConfig.apiGateway.throttle.rateLimit,
        throttlingBurstLimit: envConfig.apiGateway.throttle.burstLimit,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    // =========================================================================
    // Stack Outputs
    // =========================================================================
    new cdk.CfnOutput(this, 'VpcId', { value: vpc.vpcId });
    new cdk.CfnOutput(this, 'RdsEndpoint', { value: dbInstance.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'FrontendBucketName', { value: frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'DocumentsBucketName', { value: documentsBucket.bucketName });
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'EcrRepositoryUri', { value: ecrRepository.repositoryUri });
    new cdk.CfnOutput(this, 'EcsClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'NlbDnsName', { value: nlb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'ApiGatewayUrl', { value: api.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'DynamoDbTableName', { value: dynamoTable.tableName });
  }

  private getNonSnapshotRemovalPolicy(policy: string): cdk.RemovalPolicy {
    if (policy === 'SNAPSHOT') return cdk.RemovalPolicy.RETAIN;
    return this.getRemovalPolicy(policy);
  }

  private getRemovalPolicy(policy: string): cdk.RemovalPolicy {
    switch (policy) {
      case 'DESTROY': return cdk.RemovalPolicy.DESTROY;
      case 'RETAIN': return cdk.RemovalPolicy.RETAIN;
      case 'SNAPSHOT': return cdk.RemovalPolicy.SNAPSHOT;
      default: return cdk.RemovalPolicy.RETAIN;
    }
  }
}
