import fs from 'fs';
import { resolve } from 'path';

// @ts-ignore types declaration does not exist
import ping from 'ping';
import * as dotenv from 'dotenv';
import { scheduleJob } from 'node-schedule';
import { Telegraf, Context, Markup } from 'telegraf';

import dayjs from 'dayjs';
import uk from 'dayjs/locale/uk';
import utc from 'dayjs/plugin/utc';
import relativeTime from 'dayjs/plugin/relativeTime';
import updateLocale from 'dayjs/plugin/updateLocale';

//

dotenv.config();

dayjs.locale(uk);
dayjs.extend(utc);
dayjs.extend(relativeTime);
dayjs.extend(updateLocale);

//

enum Power {
    Off = 0,
    On = 1,
}

type Ip = string;

type UserId = number;

//

const pathTo = {
    logsJSON: pathFromRoot('logs.json'),
    activationsJSON: pathFromRoot('activations.json'),
};

//

function isValidIp(ipCandidate: Ip) {
    const ipV4RegExp = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;

    return ipV4RegExp.test(ipCandidate);
}

function pathFromRoot(path: string): string {
    return resolve(process.cwd(), path);
}

//

namespace Time {
    export function utcTimestamp(): number {
        return dayjs().utc().valueOf();
    }

    export function passedTimeFrom(timestamp: number): string {
        return dayjs(timestamp).fromNow(true);
    }
}

//

namespace FS {
    export function readFile<Data>(path: string): Data {
        const json = fs.readFileSync(path, 'utf-8');

        return JSON.parse(json);
    }

    export function writeFile<Data>(path: string, data: Data): void {
        fs.writeFileSync(path, JSON.stringify(data, null, 4));
    }

    export function createFile<Data>(path: string, data: Data): void {
        if (!fs.existsSync(path)) {
            FS.writeFile(path, data);

            console.log(`${path} has been created`);
        }
    }
}

//

namespace Activations {
    export function get(): Set<UserId> {
        const json = FS.readFile<[UserId]>(pathTo.activationsJSON);

        return new Set(json);
    }

    export function has(userId: UserId) {
        const activations = Activations.get();

        return activations.has(userId);
    }

    export function add(userId: UserId) {
        const activations = Activations.get();

        activations.add(userId);

        const values = [...activations.values()];

        FS.writeFile<UserId[]>(pathTo.activationsJSON, values);
    }
}

//

interface Log {
    createdAt: number;
    power: Power;
}

namespace Log {
    export function getLast(userId: UserId): Log | undefined {
        const user = User.get(userId);

        if (user) {
            return user.logs[user.logs.length - 1];
        }
    }

    export function add(userId: UserId, power: Power): void {
        const users = User.getAll();

        const updatedUsers = users.map((user) => {
            if (user.userId === userId) {
                const log: Log = {
                    power,
                    createdAt: Time.utcTimestamp(),
                };

                return {
                    ...user,
                    logs: [...user.logs, log],
                };
            }

            return user;
        });

        FS.writeFile(pathTo.logsJSON, updatedUsers);
    }
}

//

interface User {
    createdAt: number;
    userId: UserId;
    ip: Ip;
    logs: Log[];
}

namespace User {
    export function getAll(): User[] {
        return FS.readFile<User[]>(pathTo.logsJSON);
    }

    export function get(userId: UserId): User | undefined {
        const users = User.getAll();

        return users.find((user) => user.userId === userId);
    }

    export function getId(context: Context): number {
        if (context?.from?.id) {
            return context?.from?.id;
        }

        if (context?.message?.from.id) {
            return context?.message?.from.id;
        }

        // @ts-ignore an incorrect context param type
        return context.update.message.from.id;
    }

    export function add(user: Pick<User, 'ip' | 'userId'>): void {
        const users = User.getAll();

        const timestamp = Time.utcTimestamp();

        users.push({
            ip: user.ip,
            userId: user.userId,
            createdAt: timestamp,
            logs: [],
        });

        FS.writeFile(pathTo.logsJSON, users);
    }
}

//

async function startPing(ip: Ip, callback: (power: Power) => void): Promise<void> {
    await ping.sys.probe(ip, async (isAlive: boolean) => {
        const power = isAlive ? Power.On : Power.Off;

        const pingTime = dayjs().locale('en').utcOffset(2).format('DD MMM YYYY, hh:mm a');

        console.log(`${pingTime} | ${ip} | status: ${power}`);

        await callback(power);
    });
}

//

function startSchedule(): void {
    const every30Seconds = '1,31 * * * * *';

    scheduleJob(every30Seconds, async () => {
        const users = User.getAll();

        for (const user of users) {
            const log = Log.getLast(user.userId)!;

            await startPing(user.ip, async (nextPower) => {
                const hasPowerChanged = log.power !== nextPower;

                switch (true) {
                    case hasPowerChanged && nextPower === Power.On: {
                        await bot.telegram.sendMessage(
                            user.userId,
                            `💡 Аллілуя! Схоже, електропостачання відновлено. Але не зловживай їм, бо президент по жопі надає. Світла не було ${Time.passedTimeFrom(
                                log.createdAt,
                            )}`,
                        );

                        await Log.add(user.userId, nextPower);

                        break;
                    }

                    case hasPowerChanged && nextPower === Power.Off: {
                        await bot.telegram.sendMessage(
                            user.userId,
                            `⛔️ Світлу - пизда. Схоже, електрику вирубили нахуй. У тебе на всьо провсьо було ${Time.passedTimeFrom(
                                log.createdAt,
                            )}`,
                        );

                        await Log.add(user.userId, nextPower);

                        break;
                    }

                    default: {
                        break;
                    }
                }
            });
        }
    });
}

//

if (process.env.BOT_TOKEN === undefined) {
    throw ReferenceError(`"BOT_TOKEN" env var is required!`);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

//

bot.start(async (context) => {
    const userId = User.getId(context);
    const isActivated = Activations.has(userId);

    await context.reply(
        'Привіт. Я вмію інформвати про відключення/відновлення електроенергії, пінгуючи роутер',
    );

    if (isActivated) {
        const user = User.get(userId);

        if (user) {
            await context.reply(
                'Твоя IP адреса вже є в базі. Я продовжу моніторити і одразу повідомлю, якщо з електропостачанням щось трапиться.',
            );
        }
    } else {
        await context.reply(
            'Твоєї IP адреси ще немає в базі. Просто відправ її мені наступним повідомленням: ',
        );

        Activations.add(userId);
    }
});

bot.on('text', async (context, next) => {
    const userId = User.getId(context);
    const user = User.get(userId);

    const isActivated = Activations.has(userId);

    if (isActivated && !user) {
        const ipCandidate = context.message.text;

        if (isValidIp(ipCandidate)) {
            await User.add({ userId, ip: ipCandidate });

            await context.reply('О, красава! Тепер, давай перевіримо шо таму тебе по світлу зараз');

            await context.reply('Хвилиночку... 🐢');

            await startPing(ipCandidate, async (power) => {
                switch (power) {
                    case Power.On: {
                        await context.reply('💡 Схоже, зараз електрика є. І це заєбісь');

                        break;
                    }

                    case Power.Off: {
                        await context.reply('⛔️ Схоже, cвітлу - пизда. Зараз елекрики немає');

                        break;
                    }

                    default: {
                        throw new Error(`bot.on: Unknown power value: ${power}`);
                    }
                }

                await context.reply(
                    'Я продовжу моніторити і повідомлю, як тільки статус електропостачання зміниться',
                );

                await Log.add(userId, power);
            });
        } else {
            await context.reply('Хуйня якась. Ти шо не можеш додати нормальну IP адресу?');
        }
    }

    await next();
});

bot.command('ping', async (context) => {
    const userId = User.getId(context);
    const user = User.get(userId);
    const log = Log.getLast(userId);

    if (user && log) {
        const { ip } = user;
        const { createdAt, power: prevPower } = log;

        await startPing(ip, async (nextPower) => {
            const hasPowerChanged = prevPower !== nextPower;

            switch (true) {
                case hasPowerChanged && nextPower === Power.On: {
                    await context.reply(
                        `💡Вечір в хату! Електропостачання щойно відновили. Воно було відсутнє ${Time.passedTimeFrom(
                            createdAt,
                        )}`,
                    );

                    await Log.add(userId, nextPower);

                    break;
                }

                case hasPowerChanged && nextPower === Power.Off: {
                    await context.reply(
                        `⛔Світлу - пизда. У тебе на всьо-провсьо було ${Time.passedTimeFrom(
                            createdAt,
                        )}`,
                    );

                    await Log.add(userId, nextPower);

                    break;
                }

                case !hasPowerChanged && prevPower === Power.On: {
                    await context.reply(
                        `⚡️Електропостачання в хаті є вже ${Time.passedTimeFrom(createdAt)}`,
                    );

                    break;
                }

                case !hasPowerChanged && prevPower === Power.Off: {
                    await context.reply(
                        `🔌Електропостачання відсутнє вже ${Time.passedTimeFrom(createdAt)}`,
                    );

                    break;
                }

                default: {
                    throw new Error('command: /ping - unknown scenario');
                }
            }
        });
    }
});

bot.command('settings', async (context) => {
    const userId = User.getId(context);
    const log = Log.getLast(userId);

    if (log) {
        await context.reply(
            '⚙️Налаштування\n',
            Markup.inlineKeyboard([Markup.button.callback('👀 переглянути IP адресу', 'show-ip')]),
        );
    }
});

bot.command('schedule', async (context) => {
    const userId = User.getId(context);
    const log = Log.getLast(userId);

    if (log) {
        await context.reply(
            'Подивитись графік відключень ти можеш нижче за посиланнями. Але ж ти знаєш, що вони ніхуя не працюють, бо йобані росіяни - нікчеми, гній і підараси!',
            Markup.inlineKeyboard([
                Markup.button.url(
                    'Київ',
                    'https://kyiv.yasno.com.ua/schedule-turn-off-electricity',
                ),
                Markup.button.url('Львів', 'https://poweroff.loe.lviv.ua/'),
            ]),
        );
    }
});

bot.action('show-ip', async (context) => {
    const userId = User.getId(context);
    const user = User.get(userId);

    if (user) {
        await context.reply(`Твоя IP адреса: ${user.ip}`);
    }
});

bot.command('stop', async (context) => {
    await context.reply(
        '🛑Ахрана, атмєна. Ти зупинив ботa. Схоже, він всрато працює. Ну сорі, буває',
    );
});

bot.launch()
    .then(() => {
        FS.createFile<User[]>(pathTo.logsJSON, []);
        FS.createFile<UserId[]>(pathTo.activationsJSON, []);
    })
    .then(startSchedule)
    .finally(() => console.log('Bot has been started'));
