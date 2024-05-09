import * as path from "jsr:@std/path";
import * as fs from "jsr:@cross/fs";

export type Body = () => Promise<void>;
export type Status = {
  type: "success";
  target: string;
  mtime: Date;
} | {
  type: "failure";
  target: string;
  error: Error;
};

export interface Runnable {
  run(): Promise<Status>;
}

export class Task implements Runnable {
  #target: string;
  #deps: Runnable[];
  #body: Body;
  constructor(target: string, deps: Runnable[], body: Body) {
    this.#target = target;
    this.#deps = deps;
    this.#body = body;
  }
  async run(): Promise<Status> {
    for (const source of this.#deps) {
      const result = await source.run();
      if (result.type === "failure") {
        return result;
      }
    }
    try {
      await this.#body();
    } catch (error) {
      return { type: "failure", target: this.#target, error };
    }
    return { type: "success", target: this.#target, mtime: new Date() };
  }
}

export class File implements Runnable {
  #target: string;
  #deps?: Runnable[];
  #body?: Body;
  constructor(target: string, deps?: Runnable[], body?: Body) {
    const cwd = Deno.cwd();
    this.#target = path.isAbsolute(target) ? target : path.join(cwd, target);
    this.#deps = deps;
    this.#body = body;
  }
  async run(): Promise<Status> {
    let deps_mtime: Date = new Date(0);
    for (const dependency of this.#deps ?? []) {
      const result = await dependency.run();
      if (result.type === "success") {
        deps_mtime = deps_mtime.getTime() > result.mtime.getTime()
          ? deps_mtime
          : result.mtime;
      } else {
        return result;
      }
    }
    const target_mtime = await fs.stat(this.#target).then((s) => s.mtime);
    if (!target_mtime || target_mtime.getTime() <= deps_mtime.getTime()) {
      try {
        await this.#body?.();
      } catch (error) {
        return { type: "failure", target: this.#target, error };
      }
      return { type: "success", target: this.#target, mtime: new Date() };
    }
    return { type: "success", target: this.#target, mtime: target_mtime };
  }
}

export function file(
  parts: TemplateStringsArray,
  ...placeholders: unknown[]
): Runnable {
  return new File(String.raw(parts, ...placeholders));
}

export async function watch(...tasks: Runnable[]) {
  while (true) {
    const watcher = fs.FsWatcher()
    for await (const _event of watcher.watch(".")) {
      for (const task of tasks) {
        const result = await task.run();
        if (result.type === "failure") {
          console.error(`Failed at ${result.target}: ${result.error}`);
        }
        console.log(`Successfully built ${result.target}`);
      }
      break;
    }
  }
}

export async function run(...tasks: Runnable[]) {
  for (const task of tasks) {
    const result = await task.run();
    if (result.type === "failure") {
      console.error(`Failed at ${result.target}: ${result.error}`);
    }
    console.log(`Successfully built ${result.target}`);
  }
}
