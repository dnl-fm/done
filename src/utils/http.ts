import { Context } from 'hono';
import { err, ok } from 'result';

export const HTTP_NAMESPACE = 'Done';

export class Http {
  static getAbortSignal(timeoutInSeconds = 8) {
    return AbortSignal.timeout(timeoutInSeconds * 1000);
  }

  static isJson(ctx: Context) {
    return ctx.req.raw.headers.get('content-type') === 'application/json';
  }

  static async validateDns(url: string, options: { timeoutInSeconds: number } = { timeoutInSeconds: 4 }) {
    try {
      await Deno.resolveDns(new URL(url).hostname, 'A', { signal: Http.getAbortSignal(options.timeoutInSeconds) });

      return ok(true);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err({ message: `DNS validation failed for ${url}`, error: errorMessage });
    }
  }

  static delayExtract(ctx: Context) {
    const absolute = ctx.req.header(`${HTTP_NAMESPACE}-Not-Before`);
    const relative = ctx.req.header(`${HTTP_NAMESPACE}-Delay`);

    if (relative && !absolute) {
      return Http.delayHandleRelative(relative).delayDate;
    }

    if (absolute) {
      return Http.delayHandleAbsolute(absolute);
    }

    return new Date();
  }

  static delayHandleAbsolute(notBefore: string) {
    return new Date(Number(notBefore) * 1000);
  }

  static delayHandleRelative(delay: string) {
    const number = Number(delay.slice(0, -1));
    const unit = delay.slice(-1);

    const nowDate = new Date();
    const delayDate = new Date(nowDate);

    switch (unit) {
      case 's':
        delayDate.setSeconds(delayDate.getSeconds() + number);
        break;
      case 'm':
        delayDate.setMinutes(delayDate.getMinutes() + number);
        break;
      case 'h':
        delayDate.setHours(delayDate.getHours() + number);
        break;
      case 'd':
        delayDate.setDate(delayDate.getDate() + number);
        break;
      default:
    }

    return {
      delay,
      number,
      unit,
      nowDate,
      delayDate,
    };
  }

  static extractHeaders(ctx: Context) {
    const command: Record<string, string> = {};
    const forward: Record<string, string> = {};

    for (const [key, value] of ctx.req.raw.headers) {
      const forwardPrefix = `${HTTP_NAMESPACE}-forward-`.toLowerCase();
      if (key.indexOf(forwardPrefix) !== -1) {
        forward[key.replace(forwardPrefix, '')] = value;
        continue;
      }

      const commandPrefix = `${HTTP_NAMESPACE}-`.toLowerCase();
      if (key.indexOf(commandPrefix) !== -1) {
        command[key.replace(commandPrefix, '')] = value;
      }
    }

    return { command, forward };
  }

  static buildDefaultCallbackHeaders(headers: HeadersInit, options: { messageId: string; retried: number; status: string }) {
    return {
      ...headers,
      'Done-Message-Id': options.messageId,
      'Done-Status': options.status,
      'Done-Retried': options.retried.toString(),
      'User-Agent': 'Done Light',
    } as HeadersInit;
  }
}
