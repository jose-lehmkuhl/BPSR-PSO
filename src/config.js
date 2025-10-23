class Config {
    constructor() {
        this.VERSION = '1.0.0';
        this.IS_PAUSED = false;
        this.GLOBAL_SETTINGS = {
            autoClearOnServerChange: true,
            autoClearOnTimeout: false,
            outOfCombatClearSeconds: 10,
            theme: 'default',
        };
    }
}

export const config = new Config();
