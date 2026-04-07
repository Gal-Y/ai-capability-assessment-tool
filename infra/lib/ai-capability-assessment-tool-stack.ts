import { fileURLToPath } from "node:url";
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

export class AiCapabilityAssessmentToolStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
    const openAiEvaluatorModel = process.env.OPENAI_EVALUATOR_MODEL ?? "gpt-5.4-mini";

    const uploadsBucket = new s3.Bucket(this, "UploadsBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          exposedHeaders: ["ETag"],
        },
      ],
    });

    const artifactsBucket = new s3.Bucket(this, "ArtifactsBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5),
        },
      ],
    });

    new s3deploy.BucketDeployment(this, "FrontendDeployment", {
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ["/*"],
      prune: true,
      sources: [s3deploy.Source.asset(path.join(projectRoot, "dist"))],
    });

    const evaluationsTable = new dynamodb.Table(this, "EvaluationsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "evaluationId",
        type: dynamodb.AttributeType.STRING,
      },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const apiLambdaCode = lambda.Code.fromAsset(
      path.join(projectRoot, "infra/lambda/api"),
    );
    const workflowLambdaCode = lambda.Code.fromAsset(
      path.join(projectRoot, "infra/lambda/workflow"),
    );

    const createPythonFunction = (
      functionId: string,
      handler: string,
      code: lambda.Code,
      environment: Record<string, string> = {},
      timeout = Duration.seconds(30),
    ) =>
      new lambda.Function(this, functionId, {
        runtime: lambda.Runtime.PYTHON_3_12,
        architecture: lambda.Architecture.ARM_64,
        handler,
        code,
        memorySize: 256,
        timeout,
        environment,
      });

    const presignUploadFn = createPythonFunction(
      "PresignUploadFunction",
      "presign_upload.handler",
      apiLambdaCode,
      {
        UPLOADS_BUCKET: uploadsBucket.bucketName,
      },
    );

    const listEvaluationsFn = createPythonFunction(
      "ListEvaluationsFunction",
      "list_evaluations.handler",
      apiLambdaCode,
      {
        EVALUATIONS_TABLE: evaluationsTable.tableName,
      },
    );

    const getEvaluationFn = createPythonFunction(
      "GetEvaluationFunction",
      "get_evaluation.handler",
      apiLambdaCode,
      {
        EVALUATIONS_TABLE: evaluationsTable.tableName,
      },
    );

    const validateInputFn = createPythonFunction(
      "ValidateInputFunction",
      "validate_input.handler",
      workflowLambdaCode,
      {
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      },
    );

    const buildTestCasesFn = createPythonFunction(
      "BuildTestCasesFunction",
      "build_test_cases.handler",
      workflowLambdaCode,
      {
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      },
      Duration.minutes(1),
    );

    const generatePlatformOutputsFn = createPythonFunction(
      "GeneratePlatformOutputsFunction",
      "generate_platform_outputs.handler",
      workflowLambdaCode,
      {
        OPENAI_API_KEY: openAiApiKey,
        OPENAI_EVALUATOR_MODEL: openAiEvaluatorModel,
        UPLOADS_BUCKET: uploadsBucket.bucketName,
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      },
      Duration.minutes(3),
    );

    const loadUploadedOutputsFn = createPythonFunction(
      "LoadUploadedOutputsFunction",
      "load_uploaded_outputs.handler",
      workflowLambdaCode,
      {
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      },
      Duration.minutes(1),
    );

    const scoreEvaluationFn = createPythonFunction(
      "ScoreEvaluationFunction",
      "score_evaluation.handler",
      workflowLambdaCode,
      {
        OPENAI_API_KEY: openAiApiKey,
        OPENAI_EVALUATOR_MODEL: openAiEvaluatorModel,
        UPLOADS_BUCKET: uploadsBucket.bucketName,
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      },
      Duration.minutes(5),
    );

    const finalizeEvaluationFn = createPythonFunction(
      "FinalizeEvaluationFunction",
      "finalize_evaluation.handler",
      workflowLambdaCode,
      {
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        EVALUATIONS_TABLE: evaluationsTable.tableName,
      },
      Duration.minutes(1),
    );

    const markFailedFn = createPythonFunction(
      "MarkFailedFunction",
      "mark_failed.handler",
      workflowLambdaCode,
      {
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        EVALUATIONS_TABLE: evaluationsTable.tableName,
      },
      Duration.minutes(1),
    );

    const validateTask = new tasks.LambdaInvoke(this, "ValidateInput", {
      lambdaFunction: validateInputFn,
      payloadResponseOnly: true,
    });

    const buildCasesTask = new tasks.LambdaInvoke(this, "BuildTestCases", {
      lambdaFunction: buildTestCasesFn,
      payloadResponseOnly: true,
    });

    const platformOutputsTask = new tasks.LambdaInvoke(this, "GeneratePlatformOutputs", {
      lambdaFunction: generatePlatformOutputsFn,
      payloadResponseOnly: true,
    });

    const uploadedOutputsTask = new tasks.LambdaInvoke(this, "LoadUploadedOutputs", {
      lambdaFunction: loadUploadedOutputsFn,
      payloadResponseOnly: true,
    });

    const scoreTask = new tasks.LambdaInvoke(this, "ScoreEvaluation", {
      lambdaFunction: scoreEvaluationFn,
      payloadResponseOnly: true,
    });

    const finalizeTask = new tasks.LambdaInvoke(this, "FinalizeEvaluation", {
      lambdaFunction: finalizeEvaluationFn,
      payloadResponseOnly: true,
    });

    const failureTask = new tasks.LambdaInvoke(this, "MarkFailed", {
      lambdaFunction: markFailedFn,
      payloadResponseOnly: true,
    });

    validateTask.addCatch(failureTask, { resultPath: "$.workflowError" });
    buildCasesTask.addCatch(failureTask, { resultPath: "$.workflowError" });
    platformOutputsTask.addCatch(failureTask, { resultPath: "$.workflowError" });
    uploadedOutputsTask.addCatch(failureTask, { resultPath: "$.workflowError" });
    scoreTask.addCatch(failureTask, { resultPath: "$.workflowError" });
    finalizeTask.addCatch(failureTask, { resultPath: "$.workflowError" });

    const outputChoice = new sfn.Choice(this, "ResolveOutputSource")
      .when(
        sfn.Condition.stringEquals("$.outputSource", "platform-model"),
        platformOutputsTask,
      )
      .otherwise(uploadedOutputsTask);

    const definition = sfn.Chain.start(validateTask)
      .next(buildCasesTask)
      .next(outputChoice.afterwards())
      .next(scoreTask)
      .next(finalizeTask);

    const stateMachine = new sfn.StateMachine(this, "EvaluationWorkflow", {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(10),
    });

    const startEvaluationFn = createPythonFunction(
      "StartEvaluationFunction",
      "start_evaluation.handler",
      apiLambdaCode,
      {
        EVALUATIONS_TABLE: evaluationsTable.tableName,
        EVALUATION_WORKFLOW_ARN: stateMachine.stateMachineArn,
      },
    );

    uploadsBucket.grantPut(presignUploadFn);
    uploadsBucket.grantRead(generatePlatformOutputsFn);
    uploadsBucket.grantRead(loadUploadedOutputsFn);
    uploadsBucket.grantRead(scoreEvaluationFn);

    artifactsBucket.grantReadWrite(validateInputFn);
    artifactsBucket.grantReadWrite(buildTestCasesFn);
    artifactsBucket.grantReadWrite(generatePlatformOutputsFn);
    artifactsBucket.grantReadWrite(loadUploadedOutputsFn);
    artifactsBucket.grantReadWrite(scoreEvaluationFn);
    artifactsBucket.grantReadWrite(finalizeEvaluationFn);
    artifactsBucket.grantReadWrite(markFailedFn);

    evaluationsTable.grantReadData(listEvaluationsFn);
    evaluationsTable.grantReadData(getEvaluationFn);
    evaluationsTable.grantReadWriteData(startEvaluationFn);
    evaluationsTable.grantReadWriteData(finalizeEvaluationFn);
    evaluationsTable.grantReadWriteData(markFailedFn);
    stateMachine.grantStartExecution(startEvaluationFn);

    const httpApi = new apigwv2.HttpApi(this, "AiCapabilityAssessmentApi", {
      apiName: "ai-capability-assessment-api",
      corsPreflight: {
        allowHeaders: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });

    httpApi.addRoutes({
      path: "/uploads/presign",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "PresignUploadIntegration",
        presignUploadFn,
      ),
    });

    httpApi.addRoutes({
      path: "/evaluations",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "StartEvaluationIntegration",
        startEvaluationFn,
      ),
    });

    httpApi.addRoutes({
      path: "/evaluations",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "ListEvaluationsIntegration",
        listEvaluationsFn,
      ),
    });

    httpApi.addRoutes({
      path: "/evaluations/{evaluationId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "GetEvaluationIntegration",
        getEvaluationFn,
      ),
    });

    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, "UploadsBucketName", {
      value: uploadsBucket.bucketName,
    });

    new cdk.CfnOutput(this, "ArtifactsBucketName", {
      value: artifactsBucket.bucketName,
    });

    new cdk.CfnOutput(this, "EvaluationsTableName", {
      value: evaluationsTable.tableName,
    });

    new cdk.CfnOutput(this, "WorkflowArn", {
      value: stateMachine.stateMachineArn,
    });
  }
}
