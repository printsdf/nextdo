export const SKILL_TYPES = ['prompt', 'code', 'workflow', 'tool'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

export const SKILL_STATUSES = ['draft', 'active', 'deprecated'] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

/**
 * Skill entity (skill table). Skills are stored as directories under
 * ~/.nextdo/skills/ (SKILL.md + support files).
 */
export interface Skill {
  id: string;
  name: string;
  version: string;
  description?: string;
  type: SkillType;
  status: SkillStatus;
  owner: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Individual file belonging to a skill (skill_file table).
 */
export interface SkillFile {
  id: string;
  skillId: string;
  filePath: string;
  content: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}
