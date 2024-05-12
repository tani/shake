import { assertEquals, assertRejects } from "jsr:@std/assert";
import { test } from "jsr:@cross/test";
import { Task, run } from "./shake.ts";

// import { stub } from "jsr:@std/testing/mock";
// function stubStat( stat: Record<string, Date | null> ) {
//   return stub(Deno, "stat", (path: string | URL) => {
//     return Promise.resolve({ mtime: stat[path.toString()] } as Deno.FileInfo);
//   });
// }

test("run:task:success", async () => {
  let called = false;
  const task = new Task([], () => { called = true; });
  await run(task);
  assertEquals(called, true);
})

test("run:task:failure", () => {
  const task = new Task([], () => { throw new Error(); });
  assertRejects(() => run(task));
});

function* binaries(size: number): Generator<boolean[]> {
  for (let i = 0; i < 1 << size; i++) {
    const binary = i.toString(2).padStart(size, "0");
    yield binary.split("").map((c) => c === "1");
  }
}

function add(n: boolean[], m: boolean[]): boolean[] {
  return n.map((v, i) => v || m[i]);
}

function mul(n: boolean[], m: boolean[]): boolean[] {
  const x = Math.sqrt(n.length);
  const r = Array.from({ length: x * x }, () => false);
  for (let i = 0; i < x; i++) {
    for (let j = 0; j < x; j++) {
      for (let k = 0; k < x; k++) {
        r[i * x + j] ||= n[i * x + k] && m[k * x + j];
      }
    }
  }
  return r;
}

function pow(n: boolean[],  m: number): boolean[] {
  let r = n;
  for (let l = 1; l < m; l++) {
    r = mul(r, n);
  }
  return r;
}

function isCyclic(n: boolean[]) {
  const x = Math.sqrt(n.length);
  const m = Array.from({ length: x }, (_, i) => pow(n, i + 1)).reduce(add);
  return Array.from({ length: x }, (_, i) => m[i * x + i]).some((v) => v);
}

test("run:task:multiple", async () => {
  for (const vertices of binaries(3)) {
    for (const edges of binaries(vertices.length * vertices.length)) {
      const tasks = vertices.map((v) => new Task([], v ? () => {} : () => { throw new Error(); }));
      for (let i = 0; i < vertices.length; i++) {
        for (let j = 0; j < vertices.length; j++) {
          if (edges[i * vertices.length + j]) {
            tasks[i].deps.push(tasks[j]);
          }
        }
      }
      if (isCyclic(edges)) {
        await assertRejects(() => run(...tasks));
      } else if (vertices.some(v => !v)) {
        await assertRejects(() => run(...tasks));
      } else {
        await run(...tasks);
      }
    }
  }
});
