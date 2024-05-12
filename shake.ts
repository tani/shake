import * as fs from "@cross/fs";

/**
 * Interface representing the status of a task.
 *
 * @export
 * @interface Status
 */
export interface Status {
  /**
   * The task associated with the status.
   *
   * @type {TaskLike}
   */
  task: TaskLike;

  /**
   * The last modification time of the task.
   *
   * @type {Date}
   */
  mtime: Date;
}

/**
 * Type representing an array of Status objects.
 *
 * @export
 * @type {Status[]}
 */
export type State = Status[];

function status(task: TaskLike, mtime: Date): Status {
  return { task, mtime };
}

/**
 * Interface representing a task-like object.
 *
 * @export
 * @interface TaskLike
 */
export interface TaskLike {
  /**
   * An array of dependencies for the task.
   *
   * @type {TaskLike[]}
   */
  deps: TaskLike[];

  /**
   * Function to run the task. It takes the current state as an argument and returns a promise that resolves to the new state.
   *
   * @param {State} state - The current state of the task.
   * @returns {Promise<State>} - A promise that resolves to the new state after the task is run.
   */
  run(state: State): Promise<State>;
}

type Body = (() => Promise<void>) | (() => void);

/**
 * Class representing a Task.
 *
 * @export
 * @class Task
 * @implements {TaskLike}
 */
export class Task implements TaskLike {
  /**
   * An array of dependencies for the task.
   *
   * @type {TaskLike[]}
   */
  deps: TaskLike[];

  /**
   * The body of the task.
   *
   * @private
   * @type {Body}
   */
  #body: Body;

  /**
   * Creates an instance of Task.
   *
   * @param {TaskLike[]} [deps=[]] - The dependencies of the task.
   * @param {Body} [body=() => {}] - The body of the task.
   */
  constructor(deps?: TaskLike[], body?: Body) {
    this.deps = deps ?? [];
    this.#body = body ?? (() => {});
  }

  /**
   * Runs the task.
   *
   * @param {State} state - The current state of the task.
   * @returns {Promise<State>} - A promise that resolves to the new state after the task is run.
   */
  async run(state: State): Promise<State> {
    await this.#body();
    return state.concat(status(this, new Date()));
  }
}

/**
 * Class representing a File task.
 *
 * @export
 * @class File
 * @implements {TaskLike}
 */
export class File implements TaskLike {
  /**
   * The target file of the task.
   *
   * @private
   * @type {string}
   */
  #target: string;

  /**
   * An array of dependencies for the task.
   *
   * @type {TaskLike[]}
   */
  deps: TaskLike[];

  /**
   * The body of the task.
   *
   * @private
   * @type {Body}
   */
  #body: Body;

  /**
   * Creates an instance of File.
   *
   * @param {string} target - The target file of the task.
   * @param {TaskLike[]} [deps=[]] - The dependencies of the task.
   * @param {Body} [body=() => {}] - The body of the task.
   */
  constructor(target: string, deps?: TaskLike[], body?: Body) {
    this.#target = target;
    this.deps = deps ?? [];
    this.#body = body ?? (() => {});
  }

  /**
   * Runs the task.
   * The task is only run if any of its dependencies have been modified.
   *
   * @param {State} state - The current state of the task.
   * @returns {Promise<State>} - A promise that resolves to the new state after the task is run.
   */
  async run(state: State): Promise<State> {
    let mtime: Date;
    try {
      const stat = await fs.stat(this.#target);
      mtime = stat.mtime ?? new Date(0);
    } catch (error) {
      if (error instanceof fs.NotFoundError) {
        mtime = new Date(0);
      } else {
        throw error;
      }
    }
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

/**
 * Function to create a new File task.
 *
 * @export
 * @param {TemplateStringsArray} parts - The string parts of the file path.
 * @param {...unknown[]} placeholders - The placeholders in the file path.
 * @returns {TaskLike} - A new File task.
 */
export function file(
  parts: TemplateStringsArray,
  ...placeholders: unknown[]
): TaskLike {
  return new File(String.raw(parts, ...placeholders));
}

function topsort(tasks: TaskLike[]): TaskLike[] {
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

/**
 * Asynchronously runs a set of tasks in topological order.
 *
 * @export
 * @param {...TaskLike[]} tasks - The tasks to be run.
 * @returns {Promise<State>} - A promise that resolves to the final state after all tasks have been run.
 */
export async function run(...tasks: TaskLike[]): Promise<State> {
  let state: State = [];
  for (const task of topsort(tasks)) {
    state = await task.run(state);
  }
  return state;
}

/**
 * Watches a file or directory and runs a set of tasks whenever a change is detected.
 *
 * @export
 * @param {string} path - The path to the file or directory to watch.
 * @param {...TaskLike[]} tasks - The tasks to run whenever a change is detected.
 * @returns {Promise<void>} - A promise that resolves when the watch operation is complete.
 */
export async function watch(path: string, ...tasks: TaskLike[]): Promise<void> {
  const watcher = fs.FsWatcher();
  for await (const _event of watcher.watch(path)) {
    await run(...tasks);
  }
}
