# Shake

<p align="center">
  <strong>A simple task runner/ dependency resolver for JavaScript. </strong><br /><br />
  <img width="200" src="https://raw.githubusercontent.com/tani/shake/main/shake.avif" />
</p>

## Usage

```typescript
import $ from 'jsr:@david/dax';
import { File, file, Task, run, watch } from 'jsr:@tani/shake';

// File task will be run only if the file is missing or older than the dependencies
const hello = new File("hello.out", [file`hello.c`], async () => {
  await $`gcc -o hello.out hello.c`;
});


// Task always will be run when it is called
const greet = new Task([hello], async () => {
  await $`./hello.out`;
});

// Run the task once
run(greet);

// Watch the task
// This will run the task when the file is changed
watch(".", greet);
```

## License

MIT License

Copyright (c) 2024, Masaya Taniguchi
