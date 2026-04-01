import {
  configurationProfiles,
  evaluationScenarios,
} from "../data/mockData";
import type {
  CapabilityForm,
  ConfigurationProfile,
  ConfigurationResult,
  Scenario,
  ScenarioResult,
} from "../types";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const seededNoise = (seed: string) => {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }

  return (hash % 100) / 100;
};

const scoreScenario = (
  scenario: Scenario,
  config: ConfigurationProfile,
  form: CapabilityForm,
): ScenarioResult => {
  const structuralDemand =
    Math.max(0, form.requiredSections.length - 3) * 0.018 +
    (form.summaryStyle.toLowerCase().includes("executive") ? 0.01 : 0) +
    (form.outputLength <= 180 ? 0.017 : 0);
  const riskPressure =
    form.riskLevel === "High" ? 0.03 : form.riskLevel === "Medium" ? 0.015 : 0;
  const difficultyPenalty = (scenario.difficulty - 1) * 0.038;
  const sensitivityPenalty = (scenario.sensitivity - 1) * 0.022;
  const scenarioNoise = seededNoise(`${scenario.id}-${config.id}`);

  const faithfulness = clamp(
    config.baseFaithfulness -
      difficultyPenalty -
      structuralDemand * 0.4 -
      sensitivityPenalty * 0.3 +
      scenarioNoise * 0.018,
    0.62,
    0.995,
  );
  const coverage = clamp(
    config.baseCoverage -
      difficultyPenalty * 0.9 -
      structuralDemand * 0.55 +
      scenarioNoise * 0.022,
    0.58,
    0.99,
  );
  const compliance = clamp(
    config.baseCompliance -
      structuralDemand -
      difficultyPenalty * 0.4 -
      riskPressure * 0.5 +
      scenarioNoise * 0.014,
    0.55,
    0.995,
  );
  const privacy = clamp(
    config.basePrivacy -
      sensitivityPenalty * 1.15 -
      riskPressure * 0.25 +
      scenarioNoise * 0.01,
    0.52,
    0.998,
  );
  const latencySeconds = clamp(
    config.averageLatencySeconds +
      scenario.pageCount * 0.055 +
      scenario.difficulty * 0.14 +
      scenarioNoise * 0.35,
    1.8,
    8.5,
  );
  const reviewMinutes = clamp(
    config.reviewMinutesPerDocument +
      scenario.difficulty * 0.24 +
      (1 - faithfulness) * 5 +
      (1 - compliance) * 4,
    1.6,
    9.2,
  );
  const apiCost = Number(
    (
      config.apiCostPerDocument *
      (1 + scenario.pageCount / 28 + scenario.difficulty * 0.05)
    ).toFixed(3),
  );

  const weightedScore =
    faithfulness * 0.34 +
    coverage * 0.24 +
    compliance * 0.22 +
    privacy * 0.2;

  const findings: string[] = [];

  if (faithfulness * 100 < form.thresholds.faithfulness) {
    findings.push("Unsupported or weakly-grounded phrasing needs review.");
  }
  if (coverage * 100 < form.thresholds.coverage) {
    findings.push("Misses one or more required decision points.");
  }
  if (compliance * 100 < form.thresholds.compliance) {
    findings.push("Output format does not reliably follow the requested structure.");
  }
  if (privacy * 100 < form.thresholds.privacy) {
    findings.push("Sensitive material could leak into broad circulation.");
  }
  if (latencySeconds > form.thresholds.maxLatencySeconds) {
    findings.push("Operational latency exceeds the current threshold.");
  }

  let status: ScenarioResult["status"] = "Pass";

  if (findings.length >= 3 || privacy < 0.88) {
    status = "Fail";
  } else if (findings.length > 0) {
    status = "Review";
  }

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    score: weightedScore * 100,
    faithfulness: faithfulness * 100,
    coverage: coverage * 100,
    compliance: compliance * 100,
    privacy: privacy * 100,
    latencySeconds,
    reviewMinutes,
    apiCost,
    status,
    findings,
  };
};

const average = (values: number[]) =>
  values.reduce((total, value) => total + value, 0) / values.length;

export const evaluateConfigurations = (
  form: CapabilityForm,
): ConfigurationResult[] =>
  configurationProfiles.map((config) => {
    const scenarioResults = evaluationScenarios.map((scenario) =>
      scoreScenario(scenario, config, form),
    );

    const faithfulness = average(
      scenarioResults.map((result) => result.faithfulness),
    );
    const coverage = average(scenarioResults.map((result) => result.coverage));
    const compliance = average(
      scenarioResults.map((result) => result.compliance),
    );
    const privacy = average(scenarioResults.map((result) => result.privacy));
    const latencySeconds = average(
      scenarioResults.map((result) => result.latencySeconds),
    );
    const readinessScore =
      faithfulness * 0.3 +
      coverage * 0.23 +
      compliance * 0.21 +
      privacy * 0.16 +
      Math.max(0, 100 - latencySeconds * 8) * 0.1;

    const gateFailures: string[] = [];

    if (faithfulness < form.thresholds.faithfulness) {
      gateFailures.push(
        `Faithfulness below threshold (${faithfulness.toFixed(1)}% vs ${form.thresholds.faithfulness}%).`,
      );
    }
    if (coverage < form.thresholds.coverage) {
      gateFailures.push(
        `Coverage below threshold (${coverage.toFixed(1)}% vs ${form.thresholds.coverage}%).`,
      );
    }
    if (compliance < form.thresholds.compliance) {
      gateFailures.push(
        `Instruction compliance below threshold (${compliance.toFixed(1)}% vs ${form.thresholds.compliance}%).`,
      );
    }
    if (privacy < form.thresholds.privacy) {
      gateFailures.push(
        `Privacy protection below threshold (${privacy.toFixed(1)}% vs ${form.thresholds.privacy}%).`,
      );
    }
    if (latencySeconds > form.thresholds.maxLatencySeconds) {
      gateFailures.push(
        `Average latency above threshold (${latencySeconds.toFixed(1)}s vs ${form.thresholds.maxLatencySeconds}s).`,
      );
    }

    const currentMonthlyCost =
      form.volumePerMonth *
      (form.manualMinutesPerDocument / 60) *
      form.reviewHourlyRate;
    const aiMonthlyCost =
      form.volumePerMonth *
        ((average(scenarioResults.map((result) => result.reviewMinutes)) / 60) *
          form.reviewHourlyRate +
          average(scenarioResults.map((result) => result.apiCost))) +
      form.maintenanceCost;
    const monthlySavings = currentMonthlyCost - aiMonthlyCost;
    const paybackMonths =
      monthlySavings > 0
        ? form.implementationCost / monthlySavings
        : Number.POSITIVE_INFINITY;

    let deploymentDecision: ConfigurationResult["deploymentDecision"] =
      "Not Ready";

    if (gateFailures.length === 0 && monthlySavings > 0) {
      deploymentDecision =
        paybackMonths <= form.paybackTargetMonths ? "Ready" : "Conditional";
    } else if (gateFailures.length <= 2 && privacy >= form.thresholds.privacy - 2) {
      deploymentDecision = "Conditional";
    }

    return {
      config,
      readinessScore,
      deploymentDecision,
      gateFailures,
      faithfulness,
      coverage,
      compliance,
      privacy,
      latencySeconds,
      monthlyCurrentCost: currentMonthlyCost,
      monthlyAiCost: aiMonthlyCost,
      monthlySavings,
      paybackMonths,
      scenarioResults,
    };
  });

export const getChampionConfiguration = (
  results: ConfigurationResult[],
): ConfigurationResult =>
  [...results].sort((left, right) => {
    const decisionRank = { Ready: 3, Conditional: 2, "Not Ready": 1 };
    const decisionDelta =
      decisionRank[right.deploymentDecision] - decisionRank[left.deploymentDecision];

    if (decisionDelta !== 0) {
      return decisionDelta;
    }

    return right.readinessScore - left.readinessScore;
  })[0];
