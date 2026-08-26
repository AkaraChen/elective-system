import { eq } from "drizzle-orm";
import { config } from "../db/schema";
import { defaultEndTime, defaultStartTime } from "./time";

type ConfigClient = {
  select: (...args: any[]) => any;
};

export function readConfig(client: ConfigClient, key: string): string | undefined {
  const row = client.select({ value: config.value }).from(config).where(eq(config.key, key)).get();
  return row?.value;
}

export function readStartTime(client: ConfigClient): string {
  return readConfig(client, "start_time") || defaultStartTime();
}

export function readEndTime(client: ConfigClient): string {
  return readConfig(client, "end_time") || defaultEndTime();
}
