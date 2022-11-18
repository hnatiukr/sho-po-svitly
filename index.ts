import fs from 'fs';
import { resolve } from 'path';

// @ts-ignore types declaration does not exist
import netPing from 'net-ping';
import * as dotenv from 'dotenv';
import schedule from 'node-schedule';
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

function utcTimestamp(): number {
    return dayjs().utc().valueOf();
}

function passedTimeFrom(timestamp: number): string {
    return dayjs(timestamp).fromNow(true);
}

//

function readFile<DTO>(path: string): DTO {
    const json = fs.readFileSync(path, 'utf-8');

    return JSON.parse(json);
}

function writeFile<Data>(path: string, data: Data): void {
    fs.writeFileSync(path, JSON.stringify(data, null, 4));
}

//

function getActivations(): Set<UserId> {
    const json = readFile<[UserId]>(pathTo.activationsJSON);

    return new Set(json);
}

function hasActivation(userId: UserId) {
    const activations = getActivations();

    return activations.has(userId);
}

function addActivation(userId: UserId) {
    const activations = getActivations();

    activations.add(userId);

    const values = [...activations.values()];

    writeFile<UserId[]>(pathTo.activationsJSON, values);
}

//

function getLogs(): LogsMap {
    const json = readFile<LogsEntries>(pathTo.logsJSON);

    return new Map(json);
}

function getTrace(userId: UserId): Trace | undefined {
    const logs = getLogs();

    if (logs.has(userId)) {
        const traces = logs.get(userId);

        if (traces && traces.length > 0) {
            return traces[traces.length - 1];
        }
    }
}

function setTrace(userId: UserId, trace: Trace): void {
    const logs = getLogs();
    const prevTraces = logs.get(userId);

    if (prevTraces) {
        const updatedTraces = [...prevTraces, trace];

        logs.set(userId, updatedTraces);
    } else {
        logs.set(userId, [trace]);
    }

    const entries = [...logs.entries()];

    writeFile<LogsEntries>(pathTo.logsJSON, entries);
}

function deleteLog(userId: UserId) {
    const logs = getLogs();

    logs.delete(userId);

    const entries = [...logs.entries()];

    writeFile<LogsEntries>(pathTo.logsJSON, entries);
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

function startSchedule(context: Context): void {
    const everyMinute = '*/1 * * * *';

    schedule.scheduleJob(everyMinute, () => {
        const userId = getUserId(context);
        const trace = getTrace(userId);

        if (!trace) {
            context.reply(
                'Упс.. щось воно не робе. Схоже, твоя IP адреса ще не налаштована. Спробуй наново додати або змінити її через налаштування /settings',
            );

            return;
        }

        const { ip, timestamp, power: prevPower } = trace;

        ping(ip, async (nextPower) => {
            if (prevPower !== nextPower) {
                if (nextPower === 1) {
                    await context.reply(
                        `💡 Аллілуя! Схоже, електропостачання відновлено. Але не зловживай їм, бо президент по жопі надає. Світла не було ${passedTimeFrom(
                            timestamp,
                        )}`,
                    );
                } else {
                    await context.reply(
                        `⛔️ Світлу - пизда. Схоже, електрику вирубили нахуй. У тебе на всьо провсьо було ${passedTimeFrom(
                            timestamp,
                        )}`,
                    );
                }

                setTrace(userId, {
                    ip,
                    power: nextPower,
                    timestamp: utcTimestamp(),
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
    const isActivated = hasActivation(userId);

    if (isActivated) {
        const trace = getTrace(userId);

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
                    if (power === 1) {
                        await context.reply('💡 Схоже, зараз електрика є. І це заєбісь');
                    } else {
                        await context.reply('⛔️ Схоже, cвітлу - пизда. Зараз елекрики немає');
                    }

                    setTrace(userId, {
                        power,
                        ip: ipCandidate,
                        timestamp: utcTimestamp(),
                    });

                    await context.reply(
                        'Я продовжу моніторити і одразу повідомлю, якщо з електропостачанням щось трапиться. Поточний статус можеш перевірити за допомогою команди /ping ',
                    );

                    await startSchedule(context);

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

        addActivation(userId);
    }

    await next();
});

//

bot.command('ping', async (context) => {
    const userId = getUserId(context);
    const trace = getTrace(userId);

    if (trace) {
        const { ip, timestamp } = trace;

        ping(ip, async (power) => {
            if (power === 1) {
                await context.reply(
                    `💡 Британська розвідка доповідає, що електрика в хаті є вже ${passedTimeFrom(
                        timestamp,
                    )}`,
                );
            } else {
                await context.reply(
                    `⛔️ Світлу - пизда. Електропостачання відсутнє вже ${passedTimeFrom(
                        timestamp,
                    )}`,
                );
            }
        });
    }
});

bot.command('settings', async (context) => {
    const userId = getUserId(context);
    const trace = getTrace(userId);

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
    const trace = getTrace(userId);

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
    const trace = getTrace(userId);

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

    deleteLog(userId);
});

//

bot.launch()
    .then(() => {
        if (!fs.existsSync(pathTo.logsJSON)) {
            fs.writeFileSync(pathTo.logsJSON, JSON.stringify([]));

            console.log(`${pathTo.logsJSON} has been created`);
        }

        if (!fs.existsSync(pathTo.activationsJSON)) {
            fs.writeFileSync(pathTo.activationsJSON, JSON.stringify([]));

            console.log(`${pathTo.activationsJSON} has been created`);
        }
    })
    .finally(() => console.log('Bot has been started'));
