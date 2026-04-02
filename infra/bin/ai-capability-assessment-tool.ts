import * as cdk from "aws-cdk-lib";
import { AiCapabilityAssessmentToolStack } from "../lib/ai-capability-assessment-tool-stack";

const app = new cdk.App();

new AiCapabilityAssessmentToolStack(app, "AiCapabilityAssessmentToolStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
