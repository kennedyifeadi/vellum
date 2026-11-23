/** An error as the reason to give in a log line. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
