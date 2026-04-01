export type RiskLevel = "Low" | "Medium" | "High";

export type CapabilityForm = {
  capabilityName: string;
  businessPurpose: string;
  targetAudience: string;
  documentType: string;
  summaryStyle: string;
  outputLength: number;
  requiredSections: string[];
  excludedContent: string;
  riskLevel: RiskLevel;
  volumePerMonth: number;
  manualMinutesPerDocument: number;
  reviewHourlyRate: number;
  maintenanceCost: number;
  implementationCost: number;
  paybackTargetMonths: number;
  thresholds: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
    maxLatencySeconds: number;
  };
};

export type EnterpriseDocument = {
  id: string;
  title: string;
  type: string;
  owner: string;
  classification: string;
  lengthPages: number;
  freshness: string;
  note: string;
};

export type Scenario = {
  id: string;
  title: string;
  sourceDocumentIds: string[];
  audience: string;
  goal: string;
  requiredPoints: string[];
  restrictedContent: string[];
  difficulty: number;
  sensitivity: number;
  pageCount: number;
};

export type ConfigurationProfile = {
  id: string;
  name: string;
  label: string;
  summary: string;
  baseFaithfulness: number;
  baseCoverage: number;
  baseCompliance: number;
  basePrivacy: number;
  averageLatencySeconds: number;
  apiCostPerDocument: number;
  reviewMinutesPerDocument: number;
  escalationRate: number;
};

export type ScenarioResult = {
  scenarioId: string;
  title: string;
  score: number;
  faithfulness: number;
  coverage: number;
  compliance: number;
  privacy: number;
  latencySeconds: number;
  reviewMinutes: number;
  apiCost: number;
  status: "Pass" | "Review" | "Fail";
  findings: string[];
};

export type ConfigurationResult = {
  config: ConfigurationProfile;
  readinessScore: number;
  deploymentDecision: "Ready" | "Conditional" | "Not Ready";
  gateFailures: string[];
  faithfulness: number;
  coverage: number;
  compliance: number;
  privacy: number;
  latencySeconds: number;
  monthlyCurrentCost: number;
  monthlyAiCost: number;
  monthlySavings: number;
  paybackMonths: number;
  scenarioResults: ScenarioResult[];
};
