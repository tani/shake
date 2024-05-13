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
 * Class representing a FileTask task.
 *
 * @export
 * @class FileTask
 * @implements {TaskLike}
 */
export class FileTask implements TaskLike {
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
   * Creates an instance of FileTask.
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
      if (!stat.mtime) {
        throw new Error(`invalid mtime for ${this.#target}`);
      }
      mtime = stat.mtime;
    } catch (error) {
      if (error instanceof fs.NotFoundError) {
        mtime = new Date(0);
      } else {
        throw error;
      }
    }
    /*
     * The task should run if:
     * - The target file does not exist.
     * - Any of its dependencies have been modified.
     */
    let shouldRunBody = mtime.getTime() === 0;
    for (let i = 0; i < state.length && !shouldRunBody; i++) {
      const isDep = this.deps.includes(state[i].task);
      const isModified = state[i].mtime >= mtime;
      shouldRunBody = isDep && isModified;
    }
    if (shouldRunBody) {
      await this.#body();
    }
    const stat = await fs.stat(this.#target);
    if (!stat.mtime) {
      throw new Error(`invalid mtime for ${this.#target}`);
    }
    return state.concat(status(this, stat.mtime));
  }
}

function findCycle(tasks: TaskLike[]): TaskLike[] | undefined {
  function visit(path: TaskLike[], task: TaskLike): TaskLike[] | undefined {
    if (path.includes(task)) {
      return path.concat(task);
    }
    return task.deps
      .map((dep) => visit(path.concat(task), dep))
      .find((cycle) => cycle && cycle.length > 0);
  }
  return visit([], new Task(tasks, () => {}));
}

type TsortState = [TaskLike[], TaskLike[]];
function tsort(tasks: TaskLike[]): TaskLike[] {
  function visit(state: TsortState, task: TaskLike): TsortState {
    const [visited0, sorted0] = state;
    if (visited0.includes(task)) {
      return [visited0, sorted0];
    }
    const [visited1, sorted1] = [visited0.concat(task), sorted0];
    const [visited2, sorted2] = task.deps.reduce(visit, [visited1, sorted1]);
    return [visited2, sorted2.concat(task)];
  }
  return tasks.reduce(visit, [[], []] as TsortState)[1];
}


/**
 * Asynchronously runs a set of tasks in topological order.
 *
 * @export
 * @param {...TaskLike[]} tasks - The tasks to be run.
 * @returns {Promise<State>} - A promise that resolves to the final state after all tasks have been run.
 */
export async function run(...tasks: TaskLike[]): Promise<State> {
  if (findCycle(tasks) !== undefined) {
    throw new Error("cyclic dependency");
  }
  let state: State = [];
  for (const task of tsort(tasks)) {
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
