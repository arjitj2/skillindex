import type { ResolveIssueRequest, SkillInventorySnapshot } from '@shared/contracts';

import { getDisplaySkillIssueReasons } from './inventory-presentation';

export interface AutoRepairSummary {
  totalIssues: number;
  totalItems: number;
}

export function getAutoRepairSummary(autoResolvableRequests: ResolveIssueRequest[]): AutoRepairSummary {
  return {
    totalIssues: autoResolvableRequests.length,
    totalItems: new Set(autoResolvableRequests.map((request) =>
      request.skillName ?? request.mcpName ?? request.subagentName)).size,
  };
}

export function getActiveIssueCountForAutoRepairScope(
  inventorySnapshot: SkillInventorySnapshot | null,
  entity: ResolveIssueRequest['entity'],
): number {
  if (!inventorySnapshot) {
    return 0;
  }

  switch (entity) {
    case 'skill':
      return inventorySnapshot.skills
        .filter((skill) => skill.driftPresentation === 'active')
        .reduce((count, skill) => count + getDisplaySkillIssueReasons(skill).length, 0);
    case 'mcp':
      return (inventorySnapshot.mcps ?? [])
        .filter((mcp) => mcp.presentation === 'active' && mcp.status === 'needs-attention')
        .reduce((count, mcp) => count + mcp.issueReasons.length, 0);
    case 'subagent':
      return (inventorySnapshot.subagents ?? [])
        .filter((subagent) => subagent.presentation === 'active' && subagent.status === 'needs-attention')
        .reduce((count, subagent) => count + subagent.issueReasons.length, 0);
  }
}
