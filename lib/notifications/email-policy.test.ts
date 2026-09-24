import { describe, expect, it } from "vitest";

import {
  DEFAULT_URGENT_BATCH_WINDOW_MINUTES,
  DEFAULT_URGENT_DAILY_LIMIT,
  parseEmailNotificationPolicy,
} from "./email-policy";

describe("parseEmailNotificationPolicy", () => {
  it("usa uma hora e seis resumos por dia quando a organização não configurou", () => {
    expect(parseEmailNotificationPolicy({})).toEqual({
      urgent_batch_window_minutes: DEFAULT_URGENT_BATCH_WINDOW_MINUTES,
      urgent_daily_limit: DEFAULT_URGENT_DAILY_LIMIT,
    });
  });

  it("aceita somente inteiros dentro dos limites operacionais", () => {
    expect(
      parseEmailNotificationPolicy({
        notifications: {
          email: { urgent_batch_window_minutes: 120, urgent_daily_limit: 4 },
        },
      }),
    ).toEqual({ urgent_batch_window_minutes: 120, urgent_daily_limit: 4 });

    expect(
      parseEmailNotificationPolicy({
        notifications: {
          email: { urgent_batch_window_minutes: 1, urgent_daily_limit: 100 },
        },
      }),
    ).toEqual({
      urgent_batch_window_minutes: DEFAULT_URGENT_BATCH_WINDOW_MINUTES,
      urgent_daily_limit: DEFAULT_URGENT_DAILY_LIMIT,
    });
  });
});
