export class Counter {
  static count = 0;
  static readonly instances = new Map<string, Counter>();

  static register(name: string): Counter {
    const counter = new Counter();
    Counter.instances.set(name, counter);
    Counter.count++;
    return counter;
  }

  readonly name = "counter";
}
