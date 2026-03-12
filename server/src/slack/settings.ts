let slackCommandsEnabled = false

export function isSlackCommandsEnabled(): boolean {
  return slackCommandsEnabled
}

export function setSlackCommandsEnabled(val: boolean): void {
  slackCommandsEnabled = val
}
