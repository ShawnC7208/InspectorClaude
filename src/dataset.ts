import type { CapabilityProfile, CoachingCategory, NormalizedDataset } from "./types.js";

export type DatasetFilterOptions = {
  timeRange?: {
    start?: string;
    end?: string;
  };
  since?: string;
  limit?: number;
  projectPath?: string;
  taskId?: string;
};

export type DashboardScopeOptions = {
  dimensions?: CoachingCategory[];
};

export function mergeDatasets(datasets: NormalizedDataset[]): NormalizedDataset {
  const capabilityProfiles = new Map<string, CapabilityProfile>();
  const seenInteractionIds = new Set<string>();
  const interactions: NormalizedDataset["interactions"] = [];
  const seenEventIds = new Set<string>();
  const events: NormalizedDataset["events"] = [];

  for (const dataset of datasets) {
    for (const profile of dataset.capabilityProfiles) {
      capabilityProfiles.set(profile.id, profile);
    }
    for (const interaction of dataset.interactions) {
      // First file wins for the interaction record; sub-agent files that share the
      // same sessionId are merged by keeping their events under the same interactionId.
      if (!seenInteractionIds.has(interaction.id)) {
        seenInteractionIds.add(interaction.id);
        interactions.push(interaction);
      }
    }
    for (const event of dataset.events) {
      // Deduplicate events by id to prevent double-counting when sub-agent log files
      // re-emit events that already appeared in the parent session file.
      if (!seenEventIds.has(event.id)) {
        seenEventIds.add(event.id);
        events.push(event);
      }
    }
  }

  return {
    interactions,
    events,
    capabilityProfiles: [...capabilityProfiles.values()]
  };
}

export function filterDataset(dataset: NormalizedDataset, options: DatasetFilterOptions = {}): NormalizedDataset {
  const start = options.timeRange?.start ?? options.since;
  const end = options.timeRange?.end;
  const projectPath = options.projectPath;
  const taskId = options.taskId;

  let interactions = dataset.interactions.filter((interaction) => {
    if (projectPath && interaction.projectPath !== projectPath) return false;
    if (taskId && interaction.taskId !== taskId) return false;
    if ((start || end) && !overlapsRange(interaction.startedAt, interaction.endedAt, start, end)) return false;
    return true;
  });

  if (options.limit !== undefined) {
    interactions = interactions
      .slice()
      .sort((left, right) => dateSortValue(right) - dateSortValue(left))
      .slice(0, Math.max(0, options.limit));
  }

  const interactionIds = new Set(interactions.map((interaction) => interaction.id));
  const events = dataset.events.filter((event) => interactionIds.has(event.interactionId));
  const profileIds = new Set(interactions.map((interaction) => interaction.capabilityProfileId));
  const capabilityProfiles = dataset.capabilityProfiles.filter((profile) => profileIds.has(profile.id));

  return {
    interactions,
    events,
    capabilityProfiles
  };
}

function overlapsRange(startedAt: string | undefined, endedAt: string | undefined, start: string | undefined, end: string | undefined): boolean {
  const interactionStart = parseDate(startedAt ?? endedAt);
  const interactionEnd = parseDate(endedAt ?? startedAt);
  if (interactionStart === undefined || interactionEnd === undefined) return false;
  const rangeStart = parseDate(start);
  const rangeEnd = parseDate(end);
  if (rangeStart !== undefined && interactionEnd < rangeStart) return false;
  if (rangeEnd !== undefined && interactionStart > rangeEnd) return false;
  return true;
}

function dateSortValue(interaction: { startedAt?: string; endedAt?: string }): number {
  return parseDate(interaction.endedAt ?? interaction.startedAt) ?? 0;
}

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
