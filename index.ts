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

type UserId = number;

type IsActivated = boolean;

type Ip = string;

type Log = {
    ip: Ip;
    timestamp: number;
    power: Power;
};

//

const fileNames = {
    logs: 'logs.json',
    activations: 'activations.json',
};

//

function isValidIp(ipCandidate: Ip) {
    const ipV4RegExp = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;

    return ipV4RegExp.test(ipCandidate);
}

function pathFromRoot(path: string): string {
    return resolve(process.cwd(), path);
}

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

function ping(ip: Ip, callback: (power: Power) => void): void {
    const session = netPing.createSession();

    session.pingHost(ip, (error: Error) => {
        const power = error ? 0 : 1;
        const logTime = dayjs().locale('en').utcOffset(2).format('DD MMM YYYY, hh:mm a');

        console.log(`${logTime} | ${ip} | status: ${power}`);

        callback(power);

        session.close();
    });
}

function startSchedule(context: Context): void {
    const everyMinute = '*/1 * * * *';

    schedule.scheduleJob(everyMinute, () => {
        const userId = getUserId(context);
        const log = getMapValue<Log>(userId, fileNames.logs);

        if (log === undefined) {
            context.reply(
                'Упс.. щось воно не робе. Схоже, твоя IP адреса ще не налаштована. Спробуй наново додати або змінити її через налаштування /settings',
            );

            return;
        }

        const { ip, timestamp, power: prevPower } = log;

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

                await setMapValue(
                    userId,
                    {
                        ip,
                        power: nextPower,
                        timestamp: utcTimestamp(),
                    },
                    fileNames.logs,
                );
            }
        });
    });
}

function utcTimestamp(): number {
    return dayjs().utc().valueOf();
}

function passedTimeFrom(timestamp: number): string {
    return dayjs(timestamp).fromNow(true);
}

function getParsedMap<Entity>(jsonPath: string): Map<UserId, Entity> {
    const json = fs.readFileSync(jsonPath, 'utf-8');
    const parsed: [UserId, Entity][] = JSON.parse(json);

    const map = new Map<UserId, Entity>();

    for (const [parsedKey, parsedValue] of parsed) {
        map.set(parsedKey, parsedValue);
    }

    return map;
}

function getMapValue<Entity>(userId: UserId, fileName: string): Entity | undefined {
    const map = getParsedMap<Entity>(pathFromRoot(fileName));

    return map.get(userId);
}

function setMapValue<Entity>(userId: UserId, entity: Entity, fileName: string): void {
    const path = pathFromRoot(fileName);
    const map = getParsedMap<Entity>(path);

    map.set(userId, entity);

    const mapEntries = [...map.entries()];

    fs.writeFileSync(path, JSON.stringify(mapEntries, null, 4));
}

function deleteMapValue<Entity>(userId: UserId, fileName: string): void {
    const path = pathFromRoot(fileName);
    const map = getParsedMap<Entity>(path);

    map.delete(userId);

    const mapEntries = [...map.entries()];

    fs.writeFileSync(path, JSON.stringify(mapEntries, null, 4));
}

//

if (process.env.BOT_TOKEN === undefined) {
    throw ReferenceError(`"BOT_TOKEN" env var is required!`);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.on('text', async (context, next) => {
    const userId = getUserId(context);
    const isActivated = getMapValue<IsActivated>(userId, fileNames.activations);

    if (isActivated) {
        const log = getMapValue<Log>(userId, fileNames.logs);

        if (!log) {
            const ipCandidate = context.message.text;

            if (isValidIp(ipCandidate)) {
                await context.reply(
                    `О, красава! У подальшому, ти зможеш перевірити або змінити IP адресу в налаштуваннях`,
                );

                await context.reply(
                    'Давай налаштуємо роботу бота. Для початку, перевіримо шо там по світлу зараз',
                );

                await context.reply('Хвилиночку... 🐢');

                await ping(ipCandidate, async (power) => {
                    if (power === 1) {
                        await context.reply('💡 Схоже, зараз електрика є. І це заєбісь');
                    } else {
                        await context.reply('⛔️ Схоже, cвітлу - пизда. Зараз елекрики немає');
                    }

                    await setMapValue(
                        userId,
                        {
                            power,
                            ip: ipCandidate,
                            timestamp: utcTimestamp(),
                        },
                        fileNames.logs,
                    );

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

        setMapValue<IsActivated>(userId, true, fileNames.activations);
    }

    await next();
});

bot.command('ping', async (context) => {
    const userId = getUserId(context);
    const log = getMapValue<Log>(userId, fileNames.logs);

    if (log) {
        const { ip, timestamp } = log;

        await ping(ip, async (power) => {
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
    const log = getMapValue<Log>(userId, fileNames.logs);

    if (log) {
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
    const log = getMapValue<Log>(userId, fileNames.logs);

    if (log) {
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

bot.command('chmut', async (context) => {
    await context.reply('РУСНІ - ПИЗДА!');
});

bot.action('show-ip', async (context) => {
    const userId = getUserId(context);
    const log = getMapValue<Log>(userId, fileNames.logs);

    if (log === undefined) {
        await context.reply(
            'Схоже, твоя IP адреса ще не налаштована. Запусти команду /settings, а далі сам розберешься',
        );

        return;
    }

    await context.reply(`Твоя IP адреса: ${log.ip}`);
});

bot.action('set-ip', async (context) => {
    const userId = getUserId(context);

    await context.reply(
        '⬇️ Введи свою IP адресу (вона має бути статичною і публічною, інакше ніхуя працювати не буде):',
    );

    await deleteMapValue(userId, fileNames.logs);
});

bot.launch()
    .then(() => {
        const logsJsonPath = pathFromRoot(fileNames.logs);

        if (!fs.existsSync(logsJsonPath)) {
            fs.writeFileSync(logsJsonPath, JSON.stringify([]));

            console.log(`"${fileNames.logs}" has been created`);
            console.log(logsJsonPath);
        }

        const activationsJsonPath = pathFromRoot(fileNames.activations);

        if (!fs.existsSync(activationsJsonPath)) {
            fs.writeFileSync(activationsJsonPath, JSON.stringify([]));

            console.log(`"${fileNames.activations}" has been created`);
            console.log(activationsJsonPath);
        }
    })
    .finally(() => console.log('Bot has been started'));
