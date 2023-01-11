import { Telegraf } from 'telegraf';

import config from './config.js';

if (config.bot.token === undefined) {
    throw ReferenceError(`"BOT_TOKEN" env var is required!`);
}

const bot = new Telegraf(config.bot.token);

export default bot;
