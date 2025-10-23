class Config {
    constructor() {
        this.VERSION = '1.0.0';
        this.IS_PAUSED = false;
        this.GLOBAL_SETTINGS = {
            autoClearOnServerChange: true,
            autoClearOnTimeout: false,
            outOfCombatClearSeconds: 15,
        };
    }
}

export const config = new Config();
