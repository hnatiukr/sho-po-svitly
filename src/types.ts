export enum Power {
    Off = 0,
    On = 1,
}

export type User = {
    createdAt: number;
    updatedAt: number;
    userId: number;
    isActive: boolean;
    ip: string;
    power: Power;
    logs: Array<{
        createdAt: number;
        power: number;
    }>;
};
