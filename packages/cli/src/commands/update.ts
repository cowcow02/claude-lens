import { forceUpdate } from "../updater.js";

export async function update(): Promise<void> {
  await forceUpdate();
}
