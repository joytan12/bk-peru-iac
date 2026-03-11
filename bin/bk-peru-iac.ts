#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { BkPeruIacStack } from '../lib/bk-peru-iac-stack';
import { environments } from "../lib/config/environments";
import { Environment } from "../lib/config/types";

const app = new cdk.App();

const environmentName = (process.env.ENVIRONMENT || 'dev') as Environment;

if (!environments[environmentName]) {
    throw new Error(
        `Invalid environment: ${environmentName}. Valid environments are: ${Object.keys(environments).join(', ')}`
    );
}

const envConfig = environments[environmentName];

const stack = new BkPeruIacStack(app, `BkPeru-${environmentName}`, {
    env: {
        account: envConfig.account,
        region: envConfig.region,
    },
    envConfig,
    description: `BkPeru Infrastructure Stack for ${environmentName} environment`,
});

addTags(stack, envConfig.tags);

function addTags(stack: cdk.Stack, tags: Record<string, string>): void {
    for (const [key, value] of Object.entries(tags)) {
        cdk.Tags.of(stack).add(key, value);
    }
}
