import fs from 'fs';
import { resolve } from 'path';

// @ts-ignore types declaration does not exist
import netPing from 'net-ping';
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

type Trace = {
    ip: Ip;
    power: Power;
    timestamp: number;
};

type LogsMap = Map<UserId, Trace[]>;

type LogsEntries = [UserId, Trace[]][];

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

namespace Logs {
    export function get(): LogsMap {
        const json = FS.readFile<LogsEntries>(pathTo.logsJSON);

        return new Map(json);
    }

    export function remove(userId: UserId) {
        const logs = Logs.get();

        logs.delete(userId);

        const entries = [...logs.entries()];

        FS.writeFile<LogsEntries>(pathTo.logsJSON, entries);
    }
}

//

namespace Trace {
    export function get(userId: UserId): Trace | undefined {
        const logs = Logs.get();

        if (logs.has(userId)) {
            const traces = logs.get(userId);

            if (traces && traces.length > 0) {
                return traces[traces.length - 1];
            }
        }
    }

    export function set(userId: UserId, trace: Trace): void {
        const logs = Logs.get();
        const prevTraces = logs.get(userId);

        logs.set(userId, prevTraces ? [...prevTraces, trace] : [trace]);

        const entries = [...logs.entries()];

        FS.writeFile<LogsEntries>(pathTo.logsJSON, entries);
    }
}

//

function getUserId(context: Context): UserId {
    if (context?.from?.id) {
        return context?.from?.id;
    }

    if (context?.message?.from.id) {
        return context?.message?.from.id;
    }

    // @ts-ignore an incorrect context param type
    return context.update.message.from.id;
}

//

function ping(ip: Ip, callback: (power: Power) => void): void {
    const session = netPing.createSession();

    session.pingHost(ip, (error: Error) => {
        const power = error ? Power.Off : Power.On;
        const pingTime = dayjs().locale('en').utcOffset(2).format('DD MMM YYYY, hh:mm a');

        console.log(`${pingTime} | ${ip} | status: ${power}`);

        callback(power);

        session.close();
    });
}

//

function startSchedule(userId: UserId): void {
    const every30Seconds = '1,31 * * * * *';

    scheduleJob(every30Seconds, () => {
        const { ip, timestamp, power: prevPower } = Trace.get(userId)!;

        ping(ip, async (nextPower) => {
            if (prevPower !== nextPower) {
                if (nextPower === Power.On) {
                    await bot.telegram.sendMessage(
                        userId,
                        `💡 Аллілуя! Схоже, електропостачання відновлено. Але не зловживай їм, бо президент по жопі надає. Світла не було ${Time.passedTimeFrom(
                            timestamp,
                        )}`,
                    );
                } else if (nextPower == Power.Off) {
                    await bot.telegram.sendMessage(
                        userId,
                        `⛔️ Світлу - пизда. Схоже, електрику вирубили нахуй. У тебе на всьо провсьо було ${Time.passedTimeFrom(
                            timestamp,
                        )}`,
                    );
                }

                Trace.set(userId, {
                    ip,
                    power: nextPower,
                    timestamp: Time.utcTimestamp(),
                });
            }
        });
    });
}

//

if (process.env.BOT_TOKEN === undefined) {
    throw ReferenceError(`"BOT_TOKEN" env var is required!`);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

//

bot.on('text', async (context, next) => {
    const userId = getUserId(context);
    const isActivated = Activations.has(userId);

    if (isActivated) {
        const trace = Trace.get(userId);

        if (!trace) {
            const ipCandidate = context.message.text;

            if (isValidIp(ipCandidate)) {
                await context.reply(
                    `О, красава! У подальшому, ти зможеш перевірити або змінити IP адресу в налаштуваннях`,
                );

                await context.reply(
                    'Давай налаштуємо роботу бота. Для початку, перевіримо шо там по світлу зараз',
                );

                await context.reply('Хвилиночку... 🐢');

                ping(ipCandidate, async (power) => {
                    if (power === Power.On) {
                        await context.reply('💡 Схоже, зараз електрика є. І це заєбісь');
                    } else if (power === Power.Off) {
                        await context.reply('⛔️ Схоже, cвітлу - пизда. Зараз елекрики немає');
                    }

                    Trace.set(userId, {
                        power,
                        ip: ipCandidate,
                        timestamp: Time.utcTimestamp(),
                    });

                    await context.reply(
                        'Я продовжу моніторити і одразу повідомлю, якщо з електропостачанням щось трапиться. Поточний статус можеш перевірити за допомогою команди /ping ',
                    );

                    await startSchedule(userId);

                    await context.reply('Налаштувати IP адресу можна через команду /settings');

                    await context.reply(
                        'Або, використовуй для виклику команд навігаційне меню ліворуч від того місця, де ти набираєш текст \n\nОтут, внизу ↙️',
                    );
                });
            } else {
                await context.reply('Хуйня якась. Ти шо не можеш додати нормальну IP адресу?');
            }
        }
    } else {
        await context.reply(
            'Привіт. Я вмію інформвати про відключення/відновлення електроенергії, пінгуючи роутер',
        );

        await context.reply(
            'Твоєї IP адреси ще немає в базі. Тисни кніпочку нижче, щоб додати її',
            Markup.inlineKeyboard([Markup.button.callback('кніпочка', 'set-ip')]),
        );

        Activations.add(userId);
    }

    await next();
});

//

bot.command('ping', async (context) => {
    const userId = getUserId(context);
    const trace = Trace.get(userId);

    if (trace) {
        const { ip, timestamp, power: prevPower } = trace;

        if (prevPower === Power.On) {
            await context.reply(
                `💡 Британська розвідка доповідає, що електрика в хаті є вже ${Time.passedTimeFrom(
                    timestamp,
                )}`,
            );
        } else if (prevPower === Power.Off) {
            await context.reply(
                `⛔️ Світлу - пизда. Електропостачання відсутнє вже ${Time.passedTimeFrom(
                    timestamp,
                )}`,
            );
        }

        ping(ip, async (nextPower) => {
            if (prevPower !== nextPower) {
                Trace.set(userId, {
                    ip,
                    power: nextPower,
                    timestamp: Time.utcTimestamp(),
                });
            }
        });
    }
});

bot.command('settings', async (context) => {
    const userId = getUserId(context);
    const trace = Trace.get(userId);

    if (trace) {
        await context.reply(
            '⚙️Налаштування IP адреси\n',
            Markup.inlineKeyboard([
                Markup.button.callback('👀 переглянути', 'show-ip'),
                Markup.button.callback('✏️️ змінити', 'set-ip'),
            ]),
        );
    }
});

bot.command('schedule', async (context) => {
    const userId = getUserId(context);
    const trace = Trace.get(userId);

    if (trace) {
        await context.reply(
            'Графік відключень',
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

//

bot.action('show-ip', async (context) => {
    const userId = getUserId(context);
    const trace = Trace.get(userId);

    if (!trace) {
        await context.reply(
            'Схоже, твоя IP адреса ще не налаштована. Запусти команду /settings, а далі сам розберешься',
        );

        return;
    }

    await context.reply(`Твоя IP адреса: ${trace.ip}`);
});

bot.action('set-ip', async (context) => {
    await context.reply(
        '⬇️ Введи свою IP адресу (вона має бути статичною і публічною, інакше ніхуя працювати не буде):',
    );

    const userId = getUserId(context);

    Logs.remove(userId);
});

//

bot.launch()
    .then(() => {
        FS.createFile<LogsEntries>(pathTo.logsJSON, []);
        FS.createFile<UserId[]>(pathTo.activationsJSON, []);
    })
    .then(() => {
        const logs = Logs.get();

        [...logs.keys()].forEach((userId) => startSchedule(userId));
    })
    .finally(() => console.log('Bot has been started'));
