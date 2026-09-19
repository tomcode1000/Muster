/**
 * Runs one round of check-in calls from the terminal, outside the schedule.
 *
 *   npm run calls               everyone not yet checked in
 *   npm run calls -- <activity> one booking
 *
 * Needs the server running and MUSTER_PUBLIC_URL pointing at it.
 */

import "dotenv-flow/config";
import { runRound } from "./calls/dialer";
import { loadSettings } from "./settings";
import { currentProject } from "./source";

async function main() {
  const settings = loadSettings();
  const result = await runRound({
    project: currentProject(),
    schedule: settings.schedule,
    phone: settings.phone,
    onlyActivityId: process.argv[2],
  });
  console.log(`${result.called} called, ${result.reached} checked in, ${result.remaining} still open`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
