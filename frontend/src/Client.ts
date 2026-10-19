import type {
  APIResponse,
  CreateTaskBody,
  ProgramData,
  RunResultsData,
  TaskIdData,
  TaskStatusData,
} from "./types";

const BUCKET_SIZE = 15;

export class Client {
  /**
   * How many requests are allowed before no longer polling. refreshed by
   * user interaction and new results.
   */
  bucket: number = BUCKET_SIZE;
  polling: boolean = false;

  private baseUrl: string;
  // used by wake to skip the current subscribe timeout
  private signal: () => void = () => {};
  private receiver: (data: RunResultsData) => void;
  // Triggers react re-render for polling status
  private onChange: () => void;
  // run count of the last results sent to receiver
  private runs = 0;
  private getProgramId: () => string;
  private mode: "FAST" | "SLOW" = "FAST";

  constructor(
    receiver: (results: RunResultsData) => void,
    getId: () => string,
    onChange: () => void,
    baseUrl = "",
  ) {
    this.baseUrl = baseUrl;
    this.receiver = receiver;
    this.getProgramId = getId;
    this.onChange = onChange;
  }
  /**
   * Fetch the result from the server. This relies on the server being properly
   * RESTful, if "ok" then the json response is presumed to be the correct shape
   *
   * i.e. there is no validation on the response json
   */
  private async request<T>(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(this.baseUrl + path, init);
    if (!res.ok) throw new ClientError(res.status, `${method} ${path} ${await res.text()}`);
    return ((await res.json()) as APIResponse<T>).data;
  }

  /**
   * Submits task to the server, supply idemKey if this will be retried.
   */
  async submitTask(
    commands: string[],
    runs = 500,
    idemKey = Client.idemKey(),
  ): Promise<number> {
    const programId = await Client.programId(commands);
    const body: CreateTaskBody = { idemKey, programId, commands, runs };
    const { taskId } = await this.request<TaskIdData>("/tasks/", "POST", body);
    return taskId;
  }
  async getStatus(taskId: number): Promise<TaskStatusData> {
    return this.request<TaskStatusData>(`/tasks/${taskId}/status`);
  }
  async getProgram(programId: string): Promise<ProgramData> {
    return this.request<ProgramData>(`/tasks/programs/${programId}`);
  }
  async getResults(programId: string, taskId?: number): Promise<RunResultsData> {
    if (taskId !== undefined) {
      return this.request<RunResultsData>(`/tasks/results/${programId}?taskId=${taskId}`);
    } else {
      return this.request<RunResultsData>(`/tasks/results/${programId}`);
    }
  }

  /** 32 random bytes, hex encoded */
  static idemKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** SHA256 of the NSV UTF-8 encoded commands, hex encoded */
  static async programId(commands: string[]): Promise<string> {
    const bytes = new TextEncoder().encode(commands.join("\n"));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Triggered by UI events to get results. A bit trigger happy, but not too
   * heavy.
   */
  async poll() {
    this.bucket = BUCKET_SIZE;
    this.mode = "FAST";
    if (this.polling) this.signal();
    else this.subscribe();
  }

  /**
   * Begin polling for results on an interval. stops polling after a timeout
   * when subsequent requests no longer have new results. Sends results to
   * receiver, resolves when polling ends.
   */
  private async subscribe(): Promise<void> {
    if (this.polling) throw new Error("Client is already polling for results");
    this.polling = true;
    this.onChange();
    this.runs = 0;
    while (this.bucket > 0) {
      this.bucket--;
      this.getResults(this.getProgramId());
      await sleep(
        this.mode === "FAST" ? 1000 : 10000,
        (wake) => (this.signal = wake),
      );
    }
    this.polling = false;
    this.onChange();
  }

  /**
   * Basic response handler. All errors are simply swallowed until the bucket
   * drains. Results may come back out of order.
   */
  private async handleResults(res: Promise<RunResultsData>) {
    try {
      const data = await res;
      if (data.results.length != this.runs) {
        this.mode = "FAST";
        this.bucket = Math.min(1.3 + this.bucket, BUCKET_SIZE);
      } else if (this.bucket < 10) this.mode = "SLOW";
      this.runs = data.results.length;
      this.receiver(data);
    } catch (e) {
      console.log(e);
    }
  }
}

export class ClientError extends Error {
  name = "ClientError";
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number, signal?: (wake: () => void) => void) {
  return new Promise<void>((res) => {
    signal?.(res);
    setTimeout(res, ms);
  });
}
