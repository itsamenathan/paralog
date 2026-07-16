export type NotificationRule = "always" | "empty";

export type NotificationSchedule = {
  id: string;
  enabled: boolean;
  time: string;
  weekdays: number[];
  rule: NotificationRule;
  title: string;
  body: string;
};
