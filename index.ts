import fs from 'fs';
import { resolve } from 'path';

// @ts-ignore types declaration does not exist
import ping from 'ping';
import dayjs from 'dayjs';
import * as dotenv from 'dotenv';
import nodeSchedule from 'node-schedule';
import { markdownTable } from 'markdown-table';
import { Telegraf, Context, Markup } from 'telegraf';

import uk from 'dayjs/locale/uk.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import updateLocale from 'dayjs/plugin/updateLocale.js';

//

dotenv.config();

dayjs.locale(uk);
dayjs.extend(utc);
dayjs.extend(timezone);
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

const command = {
    ping: 'ping',
    stat: 'stat',
    stop: 'stop',
    settings: 'settings',
    schedule: 'schedule',
};

//

namespace Format {
    export function strong(message: string): string {
        return `<strong>${message}</strong>`;
    }

    export function italic(message: string): string {
        return `<italic>${message}</italic>`;
    }
}

namespace Time {
    export function utcTimestamp(): number {
        return dayjs().utc().valueOf();
    }

    export function toLocale(timestamp?: number): dayjs.Dayjs {
        return dayjs(timestamp).utc().local().tz('Europe/Kiev');
    }

    export function passedTimeFrom(timestamp: number): string {
        return dayjs(timestamp).fromNow(true);
    }
}

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

namespace Table {
    export function make(logs: Log[]): string {
        const entries = logs.map(({ createdAt, power }) => {
            const date = Time.toLocale(createdAt).format('hh:mm a');

            return power === Power.On ? [`${date} -`, ''] : ['', `- ${date}`];
        }) as string[][];

        const abc = [];
        const plug = ['', ''];

        for (let index = 0; index < entries.length; index += 1) {
            if (index === 0) {
                abc.push(plug);
            }

            abc.push(entries[index]);
            abc.push(plug);
        }

        const header = Time.toLocale(logs[0].createdAt).format('D MMMM');

        const table = markdownTable([['викл.', 'вкл.']].concat(abc), {
            align: ['r', 'l'],
        });

        return `${header}\n\n<pre>${table}</pre>\n`;
    }

    export function makeByPeriod(logs: Log[], period: number) {
        const startOf = Time.toLocale().subtract(period, 'day');

        const selectedPeriodLogs = logs.filter(
            ({ createdAt }) => Time.toLocale(createdAt).valueOf() >= startOf.valueOf(),
        );

        if (selectedPeriodLogs.length === 0) {
            return 'Шось не знайшлось нічого...';
        }

        if (period === 1) {
            return Table.make(selectedPeriodLogs);
        }

        let dateMemo: string | null = null;
        const logsByDates: Record<string, Log[]> = {};

        for (let index = 0; index < selectedPeriodLogs.length; index += 1) {
            const log = selectedPeriodLogs[index];
            const formattedDate = Time.toLocale(log.createdAt).format('DD MMM');

            if (dateMemo !== formattedDate) {
                logsByDates[formattedDate] = [log];

                dateMemo = formattedDate;
            } else {
                logsByDates[formattedDate] = [...logsByDates[formattedDate], log];
            }
        }

        return Object.values(logsByDates).map(Table.make).join('\n');
    }
}

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

    export function getAll(userId: UserId): Log[] | undefined {
        const user = User.get(userId);

        if (user) {
            return user.logs;
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

        users.push({
            ip: user.ip,
            userId: user.userId,
            createdAt: Time.utcTimestamp(),
            logs: [],
        });

        FS.writeFile(pathTo.logsJSON, users);
    }
}

//

function isValidIp(ipCandidate: Ip) {
    const ipV4RegExp = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;

    return ipV4RegExp.test(ipCandidate);
}

function pathFromRoot(path: string): string {
    return resolve(process.cwd(), path);
}

async function startPing(ip: Ip, callback: (power: Power) => void): Promise<void> {
    await ping.sys.probe(ip, async (isAlive: boolean) => {
        const power = isAlive ? Power.On : Power.Off;

        const pingTime = Time.toLocale().format('DD MMM YYYY, hh:mm a');

        console.log(`${pingTime} | ${ip} | status: ${power}`);

        await callback(power);
    });
}

function startSchedule(): void {
    const everyMinute = '*/1 * * * *';

    nodeSchedule.scheduleJob(everyMinute, async () => {
        const users = User.getAll();

        for (const user of users) {
            const log = Log.getLast(user.userId)!;

            await startPing(user.ip, async (nextPower) => {
                const hasPowerChanged = log.power !== nextPower;

                switch (true) {
                    case hasPowerChanged && nextPower === Power.On: {
                        const message = `💡 Аллілуя! Схоже, електропостачання відновлено. Але не зловживай їм, бо президент по жопі надає. Світла не було ${Time.passedTimeFrom(
                            log.createdAt,
                        )}`;

                        await bot.telegram.sendMessage(user.userId, Format.strong(message), {
                            parse_mode: 'HTML',
                        });

                        await Log.add(user.userId, nextPower);

                        break;
                    }

                    case hasPowerChanged && nextPower === Power.Off: {
                        const message = `⛔️ Світлу - пизда. Схоже, електрику вирубили нахуй. У тебе на всьо провсьо було ${Time.passedTimeFrom(
                            log.createdAt,
                        )}`;

                        await bot.telegram.sendMessage(user.userId, Format.strong(message), {
                            parse_mode: 'HTML',
                        });

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
                        const message = '💡 Схоже, зараз електрика є. І це заєбісь';

                        await context.reply(Format.strong(message), { parse_mode: 'HTML' });

                        break;
                    }

                    case Power.Off: {
                        const message = '⛔️ Схоже, cвітлу - пизда. Зараз елекрики немає';

                        await context.reply(Format.strong(message), { parse_mode: 'HTML' });

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
            await context.reply('Хуйня якась 💩 Ти шо не можеш додати нормальну IP адресу?');
        }
    } else {
        const inputText = context.message.text;
        const commands = Object.values(command).map((cmd) => `/${cmd}`);
        const isInputTextNotCommand = !commands.includes(inputText);

        if (isInputTextNotCommand) {
            await context.reply(
                'Шо? Я звичайний тупий бот. Я нічого не розумію, крім заданних команд. Не змушуй мене відправляти цей текст кожного разу, надсилаючи якусь хуйню в чат',
            );

            await context.reply(
                'Список доступних команд можна переглянути в меню, ліворуч від текстового поля',
            );

            await context.reply(Format.strong('Ось тут ↙️'), { parse_mode: 'HTML' });
        }
    }

    await next();
});

bot.command(command.ping, async (context) => {
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
                    const message = `💡Вечір в хату! Електропостачання щойно відновили. Воно було відсутнє ${Time.passedTimeFrom(
                        createdAt,
                    )}`;

                    await context.reply(Format.strong(message), { parse_mode: 'HTML' });

                    await Log.add(userId, nextPower);

                    break;
                }

                case hasPowerChanged && nextPower === Power.Off: {
                    const message = `⛔Світлу - пизда. У тебе на всьо-провсьо було ${Time.passedTimeFrom(
                        createdAt,
                    )}`;

                    await context.reply(Format.strong(message), { parse_mode: 'HTML' });

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

bot.command(command.settings, async (context) => {
    const userId = User.getId(context);
    const log = Log.getLast(userId);

    if (log) {
        await context.reply(
            '⚙️ Налаштування\n',
            Markup.inlineKeyboard([Markup.button.callback('👀 переглянути IP адресу', 'show-ip')]),
        );
    }
});

bot.command(command.schedule, async (context) => {
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

bot.command(command.stat, async (context) => {
    await context.reply(
        'Переглянути статистику за останні:',
        Markup.inlineKeyboard([
            Markup.button.callback('24 години', 'show-stat-1'),
            Markup.button.callback('3 доби', 'show-stat-3'),
            Markup.button.callback('7 днів', 'show-stat-7'),
        ]),
    );
});

bot.command(command.stop, async (context) => {
    await context.reply(
        '🛑 Ахрана, атмєна. Ти зупинив ботa. Схоже, він всрато працює. Ну сорі, буває',
    );

    await context.reply(
        'І взагалі, я цю команду ще не доробив, то й може бот і далі продовжить пінгувати твій роутер 🦀. А може й ні) ',
    );
});

bot.action('show-ip', async (context) => {
    const userId = User.getId(context);
    const user = User.get(userId);

    if (user) {
        const message = `${Format.strong('Твоя IP адреса')}: ${user.ip}`;

        await context.reply(message, { parse_mode: 'HTML' });
    }
});

bot.action(/^show-stat-(\d+)$/, async (context) => {
    const userId = User.getId(context);
    const logs = Log.getAll(userId);

    if (logs) {
        await context.reply('Хвилиночку... 🐢');

        const period = Number.parseInt(context.match[1]);

        const stringifyPeriod =
            period === 1 ? 'останню добу' : period === 3 ? 'останні 3 доби' : 'останні 7 діб';

        const title = Format.strong(
            `Статистка включень/відключень електропостачання за ${stringifyPeriod}`,
        );

        await context.reply(title, { parse_mode: 'HTML' });

        const table = Table.makeByPeriod(logs, period);

        await context.reply(Table.makeByPeriod(logs, period), { parse_mode: 'HTML' });
    }
});

bot.launch()
    .then(() => {
        FS.createFile<User[]>(pathTo.logsJSON, []);
        FS.createFile<UserId[]>(pathTo.activationsJSON, []);
    })
    .then(startSchedule)
    .finally(() => console.log('Bot has been started'));
