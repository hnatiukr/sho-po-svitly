import bot from './setup.js';
import * as db from './db.js';
import config from './config.js';
import * as reply from './replies.js';
import * as intents from './intents.js';
import { pendingPing } from './ping.js';
import { runScheduler } from './scheduler.js';
import { getUserId, isValidIp, isBotCommand } from './helpers.js';

//

bot.start(async (context) => {
    const userId = getUserId(context);
    const user = await db.tryGetUser(userId);
    const isExistingUser = Boolean(user);

    if (isExistingUser) {
        await db.activateUser(userId);
    } else {
        intents.changeIp(userId, true);
    }

    await reply.startBot(context, isExistingUser);
});

bot.command(config.bot.commands.stop, async (context) => {
    const userId = getUserId(context);
    const user = await db.tryGetUser(userId);

    if (user) {
        await db.deactivateUser(userId);
    }

    await reply.stopBot(context);
});

//

bot.command(config.bot.commands.ping, async (context) => {
    const userId = getUserId(context);
    const user = await db.tryGetUser(userId);

    if (!user || intents.isPendingInputIp(userId)) {
        await reply.commandsNotAvailable(context);

        return;
    }

    await pendingPing(user.ip, async (nextPower) => {
        const hasPowerChanged = user.power !== nextPower;
        const predicatePower = hasPowerChanged ? nextPower : user.power;
        const replyKey = `${hasPowerChanged}-${predicatePower}`;

        await reply.pingCommand[replyKey](context, user.updatedAt);
    });
});

bot.command(config.bot.commands.settings, async (context) => {
    const userId = getUserId(context);
    const user = await db.tryGetUser(userId);

    if (!user || intents.isPendingInputIp(userId)) {
        await reply.commandsNotAvailable(context);

        return;
    }

    await reply.settingsCommand(context, user.ip);
});

bot.command(config.bot.commands.schedule, async (context) => {
    const userId = getUserId(context);
    const user = await db.tryGetUser(userId);

    if (!user || intents.isPendingInputIp(userId)) {
        await reply.commandsNotAvailable(context);

        return;
    }

    await reply.scheduleCommand(context);
});

bot.command(config.bot.commands.stat, async (context) => {
    await reply.statCommand(context);
});

//

bot.on('text', async (context, next) => {
    const userId = getUserId(context);

    if (intents.isPendingInputIp(userId)) {
        const ipCandidate = context.message.text;

        if (isValidIp(ipCandidate)) {
            await reply.validationIp.intro(context);

            await pendingPing(ipCandidate, async (power) => {
                if (power) {
                    await reply.validationIp.powerOn(context);
                } else {
                    await reply.validationIp.powerOff(context);
                }

                await reply.validationIp.outro(context);

                await db.addUser({ userId, ip: ipCandidate, power });

                intents.changeIp(userId, false);
            });
        } else {
            await reply.validationIp.invalidIp(context);
        }
    } else {
        if (!isBotCommand(context.message.text)) {
            await reply.ifUserInputNotCommand(context);
        }
    }

    await next();
});

//

bot.action('change-ip', async (context) => {
    const userId = getUserId(context);

    await reply.changeIpAction(context);

    intents.changeIp(userId, true);
});

//

bot.launch()
    .then(async () => {
        const users = await db.getAllUsers();

        intents.initialize(users);

        runScheduler(bot);
    })
    .finally(() => console.log('Bot has been started'));
