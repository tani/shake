import * as fs from "jsr:@cross/fs";

export interface Status {
  task: TaskLike;
  mtime: Date;
}

export type State = Status[];

function status(task: TaskLike, mtime: Date): Status {
  return { task, mtime };
}

export interface TaskLike {
  readonly deps: TaskLike[];
  run(state: State): Promise<State>;
}

type Body = (() => Promise<void>) | (() => void);

export class Task implements TaskLike {
  deps: TaskLike[];
  #body: Body;
  constructor(deps?: TaskLike[], body?: Body) {
    this.deps = deps ?? [];
    this.#body = body ?? (() => {});
  }
  async run(state: State): Promise<State> {
    await this.#body();
    return state.concat(status(this, new Date()));
  }
}

export class File implements TaskLike {
  #dst: string;
  deps: TaskLike[];
  #body: Body;
  constructor(dst: string, deps?: TaskLike[], body?: Body) {
    this.#dst = dst;
    this.deps = deps ?? [];
    this.#body = body ?? (() => {});
  }
  async run(state: State): Promise<State> {
    const stat = await fs.stat(this.#dst);
    let mtime = stat.mtime ?? new Date(0);
    for (const s of state) {
      if (this.deps.includes(s.task) && s.mtime > mtime) {
        await this.#body();
        mtime = new Date();
        break;
      }
    }
    return state.concat(status(this, mtime));
  }
}

export function file(
  parts: TemplateStringsArray,
  ...placeholders: unknown[]
): TaskLike {
  return new File(String.raw(parts, ...placeholders));
}

export function topsort(tasks: TaskLike[]): TaskLike[] {
  const sorted: TaskLike[] = [];
  const visited = new Set<TaskLike>();
  const visit = (task: TaskLike, path: TaskLike[]) => {
    if (path.includes(task)) {
      throw new Error("cyclic dependency");
    }
    if (visited.has(task)) {
      return;
    }
    visited.add(task);
    for (const dep of task.deps) {
      visit(dep, path.concat(task));
    }
    sorted.push(task);
  };
  for (const task of tasks) {
    visit(task, []);
  }
  return sorted;
}

export async function run(...tasks: TaskLike[]): Promise<State> {
  let state: State = [];
  for (const task of topsort(tasks)) {
    state = await task.run(state);
  }
  return state;
}

export async function watch(path: string, ...tasks: TaskLike[]): Promise<void> {
  const watcher = fs.FsWatcher();
  for await (const _event of watcher.watch(path)) {
    await run(...tasks);
  }
}
