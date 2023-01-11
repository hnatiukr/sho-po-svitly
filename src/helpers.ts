import type { Context } from 'telegraf';
import { ParseMode } from 'telegraf/types';

import dayjs from 'dayjs';
import uk from 'dayjs/locale/uk.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import updateLocale from 'dayjs/plugin/updateLocale.js';

import config from './config.js';

// time

dayjs.locale(uk);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(updateLocale);

export function makeUtcTimestamp(): number {
    return dayjs().utc().valueOf();
}

export function makeKyivTimeZone(timestamp?: number): dayjs.Dayjs {
    return dayjs(timestamp).utc().local().tz(config.time.tz);
}

export function passedTimeFrom(timestamp: number): string {
    return dayjs(timestamp).fromNow(true);
}

// html formatting

export function toStrong(message: string): string {
    return `<strong>${message}</strong>`;
}

export const parseMode = { parse_mode: 'HTML' as ParseMode };

// context

export function getUserId(context: Context): number {
    if (context?.from?.id) {
        return context?.from?.id;
    }

    if (context?.message?.from.id) {
        return context?.message?.from.id;
    }

    // @ts-ignore an incorrect context param type
    return context.update.message.from.id;
}

// ip v.4 validation

export function isValidIp(ipCandidate: string) {
    const ipV4RegExp = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;

    return ipV4RegExp.test(ipCandidate);
}

// check if text is bot command

export function isBotCommand(textCandidate: string): boolean {
    const commands = Object.values(config.bot.commands).map((cmd) => `/${cmd}`);

    return commands.includes(textCandidate);
}
