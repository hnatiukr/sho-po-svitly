// @ts-ignore types declaration does not exist
import ping from 'ping';

import { User, Power } from './types.js';
import { makeKyivTimeZone } from './helpers.js';

export async function pendingPing(ip: User['ip'], callback: (power: Power) => void): Promise<void> {
    try {
        await ping.sys.probe(ip, (isAlive: boolean) => {
            const power = isAlive ? Power.On : Power.Off;
            const pingTime = makeKyivTimeZone().format('DD MMM YYYY, hh:mm a');

            console.log(`${pingTime} | ${ip} | status: ${power}`);

            callback(power);
        });
    } catch (error) {
        console.log(error);
    }
}
