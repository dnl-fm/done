export class Env {
  static get(key: string) {
    return Deno.env.get(key) as string;
  }

  static set(key: string, value: string) {
    Deno.env.set(key, value);
    return Env;
  }

  static has(key: string) {
    return Deno.env.has(key) === true;
  }

  static delete(key: string) {
    Deno.env.delete(key);
    return Env;
  }
}
