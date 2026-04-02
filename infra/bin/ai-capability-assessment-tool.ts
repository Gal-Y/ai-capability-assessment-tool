import * as cdk from "aws-cdk-lib";
import { AiCapabilityAssessmentToolStack } from "../lib/ai-capability-assessment-tool-stack";

const app = new cdk.App();
const stackId = process.env.CDK_STACK_ID ?? "AiCapabilityAssessmentToolStack";
const stackName = process.env.CDK_STACK_NAME ?? stackId;

new AiCapabilityAssessmentToolStack(app, stackId, {
  stackName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
