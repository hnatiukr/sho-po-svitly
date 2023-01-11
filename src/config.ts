import * as dotenv from 'dotenv';

dotenv.config();

const config = {
    bot: {
        token: process.env.BOT_TOKEN,

        commands: {
            ping: 'ping',
            stat: 'stat',
            stop: 'stop',
            settings: 'settings',
            schedule: 'schedule',
        },
    },

    db: {
        fileName: 'db.json',
        separator: '/',
        pathname: 'users',
        isSaveOnPush: true,
        isHumanReadableFormat: true,
    },

    scheduler: {
        rule: '*/2 * * * *',
    },

    time: {
        tz: 'Europe/Kiev',
    },
};

export default config;
