const BUCKET_SIZE = 15;

export class Client {
  /**
   * How many requests are allowed before no longer polling. refreshed by
   * user interaction and new results.
   */
  bucket: number = BUCKET_SIZE;

  // used by wake to skip the current subscribe timeout
  private signal: () => void = () => {};
  private receiver: (data: ResponseData) => void;
  // run count of the last results sent to receiver
  private runs = 0;
  private polling: boolean = false;
  private getProgramId: () => string;
  private mode: "FAST" | "SLOW" = "FAST";

  constructor(receiver: (results: ResponseData) => void, getId: () => string) {
    this.receiver = receiver;
    this.getProgramId = getId;
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
   * Basic task submission to backend.
   * No rate limiting, no retry. Simply throws on error.
   */
  async submitTask(programId: string, program: string[]) {
    if (!program.length) throw new Error("Empty program, not submitting task");
    const idemKey = crypto.getRandomValues(new Uint8Array(32)).toHex();
    const res = await fetch("/tasks/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        {
          idemKey,
          programId,
          commands: program,
          runs: 500,
        } satisfies CreateTaskBody,
      ),
    });
    this.poll();
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()).data.taskId as number;
  }

  /**
   * Begin polling for results on an interval. stops polling after a timeout
   * when subsequent requests no longer have new results. Sends results to
   * receiver, resolves when polling ends.
   */
  private async subscribe(): Promise<void> {
    if (this.polling) throw new Error("Client is already polling for results");
    this.polling = true;
    this.runs = 0;
    while (this.bucket > 0) {
      this.bucket--;
      // Only look for results if there is a program
      if (this.getProgramId()) {
        this.handleResults(fetch(`/tasks/results/${this.getProgramId()}`));
      }
      await sleep(
        this.mode === "FAST" ? 1000 : 10000,
        (wake) => (this.signal = wake),
      );
    }
    this.polling = false;
  }

  /**
   * Basic response handler. All errors are simply swallowed until the bucket
   * drains. Results may come back out of order.
   */
  private async handleResults(res: Promise<Response>) {
    try {
      const { data } = await (await res).json();
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

function sleep(ms: number, signal?: (wake: () => void) => void) {
  return new Promise<void>((res) => {
    signal?.(res);
    setTimeout(res, ms);
  });
}

interface ResponseData {
  programId: string;
  results: number[];
}

/**
 * Request body for POST /tasks/
 * mirrors CreateTaskBody in TaskManager.kt
 */
interface CreateTaskBody {
  /** /[A-Z0-9]{64}/i */
  idemKey: string;
  /** SHA256 of NSV UTF-8 encoded commands. Hex format */
  programId: string;
  /** A list of command strings, representing gate operations */
  commands: string[];
  /** Positive number of runs */
  runs: number;
}
