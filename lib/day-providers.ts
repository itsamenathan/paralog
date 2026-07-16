import type { DayActivity, DayProviderContext } from "@/lib/day-activity-types";
import { githubActivityForDate, githubConfigured } from "@/lib/github";
import { immichConfigured, photosForDate } from "@/lib/immich";

type DayProvider = {
  id: string;
  configured: () => boolean;
  activityForDate: (date: string, context: DayProviderContext) => Promise<DayActivity>;
};

const providers: DayProvider[] = [
  {
    id: "immich",
    configured: immichConfigured,
    activityForDate: async (date) => {
      const result = await photosForDate(date);
      return { provider: "immich", source: "Immich", title: "Photos from this day", kind: "photos", ...result };
    },
  },
  { id: "github", configured: githubConfigured, activityForDate: githubActivityForDate },
];

export async function activitiesForDate(date: string, context: DayProviderContext) {
  const configured = providers.filter((provider) => provider.configured());
  const settled = await Promise.allSettled(configured.map((provider) => provider.activityForDate(date, context)));
  return {
    activities: settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    unavailable: settled.flatMap((result, index) => result.status === "rejected" ? [configured[index].id] : []),
  };
}
