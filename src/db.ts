import { JsonDB, Config } from 'node-json-db';

import config from './config.js';
import type { User } from './types.js';
import { makeUtcTimestamp } from './helpers.js';

// db config

const dbConfig = new Config(
    config.db.fileName,
    config.db.isSaveOnPush,
    config.db.isHumanReadableFormat,
    config.db.separator,
);

const db = new JsonDB(dbConfig);

// db operations

export async function tryGetUser(userId: User['userId']): Promise<User | undefined> {
    const path = makePath(userId);

    try {
        const user = await db.getObject<User>(path);

        return user;
    } catch {
        return undefined;
    }
}

export async function getUser(userId: User['userId']): Promise<User> {
    const path = makePath(userId);

    const user = await db.getObject<User>(path);

    return user;
}

export async function getAllUsers(): Promise<User[]> {
    const path = config.db.separator;

    const data = await db.getObject<
        Record<typeof config.db.pathname, Record<User['userId'], User>>
    >(path);

    if (data.users === undefined) {
        return [];
    }

    return Object.values(data.users);
}

export async function addUser(
    user: Omit<User, 'createdAt' | 'updatedAt' | 'isActive' | 'logs'>,
): Promise<void> {
    const timestamp = makeUtcTimestamp();
    const logs: User['logs'] = [{ createdAt: timestamp, power: user.power }];

    await db.push(
        makePath(user.userId),
        makeUser({
            ...user,

            logs,
            isActive: true,
            createdAt: timestamp,
            updatedAt: timestamp,
        }),
    );
}

export async function activateUser(userId: User['userId']): Promise<void> {
    const user = await getUser(userId);

    db.push(
        makePath(userId),
        makeUser({
            ...user,

            isActive: true,
        }),
    );
}

export async function deactivateUser(userId: User['userId']): Promise<void> {
    const user = await getUser(userId);

    db.push(
        makePath(userId),
        makeUser({
            ...user,

            isActive: false,
        }),
    );
}

export async function isActivatedUser(userId: User['userId']): Promise<boolean> {
    const user = await getUser(userId);

    return user.isActive;
}

export async function changeUserIP(userId: User['userId'], ip: User['ip']): Promise<void> {
    const user = await getUser(userId);

    db.push(
        makePath(userId),
        makeUser({
            ...user,

            ip,
        }),
    );
}

export async function changeUserPower(userId: User['userId'], power: User['power']): Promise<void> {
    const user = await getUser(userId);
    const timestamp = makeUtcTimestamp();

    db.push(
        makePath(userId),
        makeUser({
            ...user,

            power,
            updatedAt: timestamp,
            logs: [...user.logs, { createdAt: timestamp, power }],
        }),
    );
}

// db helpers

function makePath(userId: User['userId']): string {
    return `${config.db.separator}${config.db.pathname}${config.db.separator}${userId}`;
}

function makeUser(user: User): User {
    return {
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        userId: user.userId,
        isActive: user.isActive,
        ip: user.ip,
        power: user.power,
        logs: [...user.logs],
    };
}
