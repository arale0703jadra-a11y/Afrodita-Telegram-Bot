export type GlobalActivityState = "running" | "paused";

export class AfroditaActivityControl {
  private state: GlobalActivityState;

  constructor(initialState: GlobalActivityState) {
    this.state = initialState;
  }

  isRunning(): boolean {
    return this.state === "running";
  }

  setState(state: GlobalActivityState): void {
    this.state = state;
  }
}
