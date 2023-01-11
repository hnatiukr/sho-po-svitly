import { Context, Markup, Telegraf } from 'telegraf';

import * as db from './db.js';
import { Power, User } from './types.js';
import { toStrong, parseMode, passedTimeFrom } from './helpers.js';

export async function startBot(context: Context, isExistingUser: boolean) {
    await context.reply(
        'Привіт. Я вмію інформвати про відключення/відновлення електроенергії, пінгуючи роутер',
    );

    if (isExistingUser) {
        await context.reply(
            'Твоя IP адреса вже є в базі. Я продовжу моніторити і одразу повідомлю, якщо з електропостачанням щось трапиться.',
        );
    } else {
        await context.reply(
            'Твоєї IP адреси ще немає в базі. Просто відправ її мені наступним повідомленням:',
        );
    }
}

export async function stopBot(context: Context): Promise<void> {
    await context.reply(
        '🛑 Ахрана, атмєна. Ти зупинив ботa. Схоже, він всрато працює. Ну сорі, буває',
    );
}

export async function commandsNotAvailable(context: Context): Promise<void> {
    await context.reply(
        'Чуєш пес, ти спочатку налаштуй нормально бота, а потім лізь куди хочеться',
    );

    await context.reply(
        'Твоєї IP адреси ще немає в базі. Просто відправ її мені наступним повідомленням:',
    );
}

export async function ifUserInputNotCommand(context: Context): Promise<void> {
    await context.reply(
        'Шо? Я звичайний тупий бот. Я нічого не розумію, крім заданних команд. Не змушуй мене відправляти цей текст кожного разу, надсилаючи якусь хуйню в чат 😡',
    );

    await context.reply(
        'Список доступних команд можна переглянути в меню, ліворуч від текстового поля',
    );

    await context.reply(toStrong('Ось тут ↙️'), parseMode);
}

export async function scheduleCommand(context: Context): Promise<void> {
    const buttons = [
        Markup.button.url('Київ', 'https://kyiv.yasno.com.ua/schedule-turn-off-electricity'),
        Markup.button.url('Львів', 'https://poweroff.loe.lviv.ua/'),
    ];
    const inlineKeyboard = Markup.inlineKeyboard(buttons);

    await context.reply(
        'Подивитись графік відключень ти можеш нижче за посиланнями. Але ж ти знаєш, що вони ніхуя не працюють, бо йобані росіяни - нікчеми, гній і підараси!',
        inlineKeyboard,
    );
}

export async function settingsCommand(context: Context, ip: User['ip']): Promise<void> {
    const buttons = [Markup.button.callback('✏️ змінити IP адресу', 'change-ip')];
    const inlineKeyboard = Markup.inlineKeyboard(buttons);

    await context.reply('⚙️ Налаштування\n');
    await context.reply(`Твоя IP адреса: ${toStrong(ip)}\n`, { ...parseMode, ...inlineKeyboard });
}

export async function statCommand(context: Context): Promise<void> {
    await context.reply('🚧 Ця фіча тимчасово недоступна');
}

export const pingCommand = {
    [`${true}-${Power.On}`]: async (context: Context, updatedAt: User['updatedAt']) => {
        const message = `💡Вечір в хату! Електропостачання щойно відновили. Воно було відсутнє ${passedTimeFrom(
            updatedAt,
        )}`;

        await context.reply(toStrong(message), parseMode);
    },

    [`${true}-${Power.Off}`]: async (context: Context, updatedAt: User['updatedAt']) => {
        const message = `⛔Світлу - пизда. У тебе на всьо-провсьо було ${passedTimeFrom(
            updatedAt,
        )}`;

        await context.reply(toStrong(message), parseMode);
    },

    [`${false}-${Power.On}`]: async (context: Context, updatedAt: User['updatedAt']) => {
        await context.reply(`⚡️Електропостачання в хаті є вже ${passedTimeFrom(updatedAt)}`);
    },

    [`${false}-${Power.Off}`]: async (context: Context, updatedAt: User['updatedAt']) => {
        await context.reply(`🔌Електропостачання відсутнє вже ${passedTimeFrom(updatedAt)}`);
    },
};

export const validationIp = {
    intro: async (context: Context) => {
        await context.reply('О, красава! Тепер, давай перевіримо шо таму тебе по світлу зараз');

        await context.reply('Хвилиночку... 🐢');
    },

    powerOn: async (context: Context) => {
        const message = '💡 Схоже, зараз електрика є. І це заєбісь';

        await context.reply(toStrong(message), parseMode);
    },

    powerOff: async (context: Context) => {
        const message = '⛔️ Схоже, cвітлу - пизда. Зараз елекрики немає';

        await context.reply(toStrong(message), parseMode);
    },

    outro: async (context: Context) => {
        await context.reply(
            'Я продовжу моніторити і повідомлю, як тільки статус електропостачання зміниться',
        );
    },

    invalidIp: async (context: Context) => {
        await context.reply('Хуйня якась 💩 Ти шо не можеш додати нормальну IP адресу?');
    },
};

export async function changeIpAction(context: Context): Promise<void> {
    await context.reply('Введу нову IP адресу нижче, наступним повідомленням:');
}

export async function schedulerChangedPower(
    bot: Telegraf<Context>,
    userId: User['userId'],
    power: User['power'],
    updatedAt: User['updatedAt'],
) {
    const message = power
        ? `💡 Аллілуя! Схоже, електропостачання відновлено. Але не зловживай їм, бо президент по жопі надає. Світла не було ${passedTimeFrom(
              updatedAt,
          )}`
        : `⛔️ Світлу - пизда. Схоже, електрику вирубили нахуй. У тебе на всьо провсьо було ${passedTimeFrom(
              updatedAt,
          )}`;

    try {
        await bot.telegram.sendMessage(userId, toStrong(message), parseMode);
    } catch (error) {
        console.log(error);

        await db.deactivateUser(userId);
    }
}
