import type { DayProviderContext, DaySummaryActivity, DaySummaryItem } from "@/lib/day-activity-types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type GitHubResponse = {
  data?: {
    viewer?: {
      contributionsCollection?: {
        totalCommitContributions?: number;
        commitContributionsByRepository?: Array<{
          contributions?: { totalCount?: number };
          repository?: { nameWithOwner?: string; url?: string };
        }>;
      };
    };
  };
  errors?: Array<{ message?: string }>;
};

function token() {
  return process.env.PARALOG_GITHUB_TOKEN?.trim() || null;
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(value.valueOf()) || value.toISOString().slice(0, 10) !== date) return null;
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function githubConfigured() {
  return Boolean(token());
}

function localMidnight(date: string, utcOffsetMinutes: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + utcOffsetMinutes * 60_000).toISOString();
}

export async function githubActivityForDate(date: string, context: DayProviderContext): Promise<DaySummaryActivity> {
  const apiToken = token();
  const tomorrow = nextDate(date);
  if (!apiToken) throw new Error("GitHub is not configured.");
  if (!tomorrow) throw new Error("A valid date is required.");

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      "User-Agent": "Paralog",
    },
    body: JSON.stringify({
      query: `query DailyCommits($from: DateTime!, $to: DateTime!) {
        viewer {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            commitContributionsByRepository(maxRepositories: 100) {
              contributions { totalCount }
              repository { nameWithOwner url }
            }
          }
        }
      }`,
      variables: {
        from: localMidnight(date, context.utcOffsetMinutes),
        to: localMidnight(tomorrow, context.nextUtcOffsetMinutes),
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`GitHub request failed with status ${response.status}.`);
  const result = await response.json() as GitHubResponse;
  if (result.errors?.length || !result.data?.viewer?.contributionsCollection) throw new Error("GitHub returned an invalid contribution response.");

  const contributions = result.data.viewer.contributionsCollection;
  const total = Math.max(0, contributions.totalCommitContributions || 0);
  const items: DaySummaryItem[] = (contributions.commitContributionsByRepository || [])
    .map((item) => ({
      id: item.repository?.nameWithOwner || "",
      label: item.repository?.nameWithOwner || "",
      count: Math.max(0, item.contributions?.totalCount || 0),
      url: item.repository?.url,
    }))
    .filter((item) => item.id && item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const namedTotal = items.reduce((sum, item) => sum + item.count, 0);
  if (total > namedTotal) items.push({ id: "private-or-other", label: "Private or other repositories", count: total - namedTotal });

  return {
    provider: "github",
    source: "GitHub",
    title: "Commits on this day",
    kind: "summary",
    total,
    totalLabel: total === 1 ? "1 commit" : `${total} commits`,
    itemUnit: { singular: "commit", plural: "commits" },
    items,
  };
}
