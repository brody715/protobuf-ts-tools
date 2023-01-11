export function debounce<Fn extends (...p: any[]) => any>(
  fn: Fn,
  opts: {
    wait: number;
    immediate?: boolean;
  }
): Fn {
  let timeout: NodeJS.Timeout | null = null;
  let result: any;
  let lastThis: any;
  let lastArgs: any[];

  const later = () => {
    timeout = null;
    if (!opts.immediate) {
      result = fn.apply(lastThis, lastArgs);
    }
  };

  const debounced = function (this: any, ...args: any[]) {
    const callNow = opts.immediate && !timeout;
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, opts.wait);
    if (callNow) {
      result = fn.apply(this, args);
    }
    lastThis = this;
    lastArgs = args;
    return result;
  };

  return debounced as Fn;
}
