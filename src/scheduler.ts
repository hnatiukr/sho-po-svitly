import nodeSchedule from 'node-schedule';
import type { Telegraf, Context } from 'telegraf';

import * as db from './db.js';
import config from './config.js';
import * as reply from './replies.js';
import { pendingPing } from './ping.js';

export function runScheduler(bot: Telegraf<Context>): void {
    nodeSchedule.scheduleJob(config.scheduler.rule, async () => {
        try {
            const users = await db.getAllUsers();
            const activeUsers = users.filter(({ isActive }) => isActive);

            for (const user of activeUsers) {
                await pendingPing(user.ip, async (nextPower) => {
                    if (user.power !== nextPower) {
                        await reply.schedulerChangedPower(
                            bot,
                            user.userId,
                            nextPower,
                            user.updatedAt,
                        );

                        await db.changeUserPower(user.userId, nextPower);
                    }
                });
            }
        } catch (error) {
            console.log(error);
        }
    });
}
