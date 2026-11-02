import { formatClockTime } from "./time.ts";

export interface AiFailure {
  status: number;
  message: string;
  resetsAt?: string;
}

/** The text a toast shows for a failed AI call. A 429 gets the friendly quota message. */
export function aiFailureText(failure: AiFailure): string {
  if (failure.status === 429) {
    const when = failure.resetsAt ? formatClockTime(failure.resetsAt) : "";
    return when ? `Daily AI limit reached, resets at ${when}` : "Daily AI limit reached, try again tomorrow";
  }
  return failure.message;
}
