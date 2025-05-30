declare module "spark-md5" {
  export class ArrayBuffer {
    constructor();
    append(arr: ArrayBuffer | ArrayBufferView): void;
    end(): string;
  }

  export function hash(str: string): string;

  export default {
    ArrayBuffer,
    hash,
  };
}
