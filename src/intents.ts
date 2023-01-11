import type { User } from './types.js';

type Intents = Record<User['userId'], Record<'ip', boolean>>;

const intents: Intents = {};

export function initialize(users: User[]): void {
    for (const user of users) {
        intents[user.userId] = { ip: false };
    }
}

export function changeIp(userId: User['userId'], pending: boolean): void {
    intents[userId].ip = pending;
}

export function isPendingInputIp(userId: User['userId']): boolean {
    return intents[userId].ip;
}
