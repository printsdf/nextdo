export const AGENT_TYPES = ['main', 'planner', 'worker', 'reviewer', 'researcher'] as const;
export type AgentType = (typeof AGENT_TYPES)[number];
