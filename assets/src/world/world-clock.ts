import { TargetObserver } from "../framwork/observer/target-observer";
import { advanceGameSeconds } from "../framwork/utils/date-utils";
import { setInstance } from "../framwork/utils/instance";
import { WorldConfig } from "./world-define";

/** 秒、分满 60 进位，时满 24，日满 30，月满 12。日和月的计数从 1 开始。 */
const CLOCK_LIMIT = {
    second: 60,
    minute: 60,
    hour: 24,
    day: 30,
    month: 12,
} as const;

/**
 * 需要持久化的世界时钟。
 * 只存累计游戏时间和当前倍速。真实游玩时间不在这里。
 * timeSpeed 是当前倍速，不是历史。历史时段的游戏时间已经加进 totalGameTime。
 */
export interface WorldClockRecord {
    /** 累计游戏时间，秒。世界按这个时间推进。 */
    totalGameTime: number;
    /** 存档时的用户倍速。读档后从这里继续，不会改写已经累计的游戏时间。 */
    timeSpeed: number;
}

/**
 * 世界时钟。只负责游戏时间。
 * 秒、分、时、日、月、年保存在计数里，界面直接读取。
 * 某一档进位时才通知一次；同一次 Tick 里同一档只通知一次。
 * 暂停或倍速为 0 时，游戏时间不动。
 */
@setInstance
export class WorldClock extends TargetObserver {
    /** 累计游戏时间，秒。需要随存档保存，世界事件按它推进。 */
    private _totalGameTime: number = 0;
    /** 当前用户倍速。0 表示游戏时间停住。 */
    private _timeSpeed: number = WorldConfig.TimeSpeed;
    /** 世界是否在运行。暂停只停游戏时间。 */
    private _enableTick: boolean = false;

    /** 当前分钟内的秒，含不足 1 秒的小数。 */
    private _second: number = 0;
    /** 当前小时内的分，0 到 59。 */
    private _minute: number = 0;
    /** 当天的时，0 到 23。 */
    private _hour: number = 0;
    /** 当月的日，1 到 30。 */
    private _day: number = 1;
    /** 当年的月，1 到 12。 */
    private _month: number = 1;
    /** 第几年，从 1 开始，不回头。 */
    private _year: number = 1;

    public get TotalGameTime(): number {
        return this._totalGameTime;
    }

    public get Second(): number {
        return this._second;
    }

    public get Minute(): number {
        return this._minute;
    }

    public get Hour(): number {
        return this._hour;
    }

    public get Day(): number {
        return this._day;
    }

    public get Month(): number {
        return this._month;
    }

    public get Year(): number {
        return this._year;
    }

    /** 当前倍速。修改只影响之后的时间，不改累计游戏时间。 */
    public get TimeSpeed(): number {
        return this._timeSpeed;
    }

    public set TimeSpeed(value: number) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            throw new Error("时间倍速必须是非负有限数字");
        }
        this._timeSpeed = value;
        WorldConfig.TimeSpeed = value;
    }

    public get EnableTick(): boolean {
        return this._enableTick;
    }

    /** 暂停或恢复世界。只控制游戏时间。 */
    public set EnableTick(value: boolean) {
        this._enableTick = value;
    }

    /**
     * 用一段真实秒数推进游戏时间。
     * 调用方在游戏暂停时不要调用，或者先把 EnableTick 设为 false。
     * 本方法不累计真实游玩时间。
     */
    public Tick(realSeconds: number): void {
        if (!this._enableTick) {
            return;
        }
        if (typeof realSeconds !== "number" || !Number.isFinite(realSeconds) || realSeconds < 0) {
            throw new Error("真实秒数必须是非负有限数字");
        }
        if (realSeconds === 0) {
            return;
        }
        const gameDelta = advanceGameSeconds(realSeconds, this._timeSpeed);
        if (gameDelta === 0) {
            return;
        }
        this._stepClock(gameDelta);
    }

    /** 导出需要持久化的游戏时间和当前倍速。 */
    public Save(): WorldClockRecord {
        return {
            totalGameTime: this._totalGameTime,
            timeSpeed: this._timeSpeed,
        };
    }

    /**
     * 读入存档。
     * 游戏时间先停住。计数从累计秒数摆一次，不补发中间的日、月、年事件。
     */
    public Load(record: WorldClockRecord): void {
        if (!record) {
            throw new Error("缺少时钟存档");
        }
        const totalGameTime = this._readPlayTime(record.totalGameTime, "累计游戏时间");
        if (typeof record.timeSpeed !== "number" || !Number.isFinite(record.timeSpeed) || record.timeSpeed < 0) {
            throw new Error("存档里的时间倍速必须是非负有限数字");
        }
        this._timeSpeed = record.timeSpeed;
        WorldConfig.TimeSpeed = record.timeSpeed;
        this._enableTick = false;
        this._placeClock(totalGameTime);
    }

    /** 秒进位时触发一次。参数是进位后的当前秒。 */
    public listen_second(second: number): void {
        void second;
    }

    /** 分进位时触发一次。参数是进位后的当前分。 */
    public listen_min(minute: number): void {
        void minute;
    }

    /** 时进位时触发一次。参数是进位后的当前时。 */
    public listen_hour(hour: number): void {
        void hour;
    }

    /** 日进位时触发一次。参数是进位后的当前日。 */
    public listen_day(day: number): void {
        void day;
    }

    /** 月进位时触发一次。参数是进位后的当前月。 */
    public listen_month(month: number): void {
        void month;
    }

    /** 年进位时触发一次。参数是进位后的当前年。 */
    public listen_year(year: number): void {
        void year;
    }

    /**
     * 把新增的游戏秒加进秒针，满一档就进位。
     * 没满的档不会通知；同一档这次最多通知一次。
     */
    private _stepClock(gameDelta: number): void {
        this._totalGameTime += gameDelta;
        const previousSecond = this._second;
        this._second += gameDelta;

        const minuteCarry = this._carry(this._second, CLOCK_LIMIT.second);
        this._second = minuteCarry.rest;
        if (Math.floor(previousSecond + gameDelta) > Math.floor(previousSecond)) {
            this.listen_second(this._second);
        }
        if (minuteCarry.carry === 0) {
            return;
        }

        const hourCarry = this._carry(this._minute + minuteCarry.carry, CLOCK_LIMIT.minute);
        this._minute = hourCarry.rest;
        this.listen_min(this._minute);
        if (hourCarry.carry === 0) {
            return;
        }

        const dayCarry = this._carry(this._hour + hourCarry.carry, CLOCK_LIMIT.hour);
        this._hour = dayCarry.rest;
        this.listen_hour(this._hour);
        if (dayCarry.carry === 0) {
            return;
        }

        const monthCarry = this._carryFromOne(this._day + dayCarry.carry, CLOCK_LIMIT.day);
        this._day = monthCarry.rest;
        this.listen_day(this._day);
        if (monthCarry.carry === 0) {
            return;
        }

        const yearCarry = this._carryFromOne(this._month + monthCarry.carry, CLOCK_LIMIT.month);
        this._month = yearCarry.rest;
        this.listen_month(this._month);
        if (yearCarry.carry === 0) {
            return;
        }

        this._year += yearCarry.carry;
        this.listen_year(this._year);
    }

    /** 读档时按累计秒数摆好钟面，不发进位事件。 */
    private _placeClock(totalGameTime: number): void {
        this._totalGameTime = totalGameTime;
        const minute = this._carry(totalGameTime, CLOCK_LIMIT.second);
        this._second = minute.rest;
        const hour = this._carry(minute.carry, CLOCK_LIMIT.minute);
        this._minute = hour.rest;
        const day = this._carry(hour.carry, CLOCK_LIMIT.hour);
        this._hour = day.rest;
        const month = this._carry(day.carry, CLOCK_LIMIT.day);
        this._day = month.rest + 1;
        const year = this._carry(month.carry, CLOCK_LIMIT.month);
        this._month = year.rest + 1;
        this._year = year.carry + 1;
    }

    /** 0 起始的计数。满 limit 就进一位，余数留在 rest。 */
    private _carry(value: number, limit: number): { rest: number; carry: number } {
        if (value < limit) {
            return { rest: value, carry: 0 };
        }
        const carry = Math.floor(value / limit);
        return { rest: value - carry * limit, carry };
    }

    /** 1 起始的日、月。第 30 日再加 1 天才进月，第 12 月再加 1 才进年。 */
    private _carryFromOne(value: number, limit: number): { rest: number; carry: number } {
        const offset = value - 1;
        if (offset < limit) {
            return { rest: value, carry: 0 };
        }
        const carry = Math.floor(offset / limit);
        return { rest: offset - carry * limit + 1, carry };
    }

    private _readPlayTime(value: number, name: string): number {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            throw new Error(`${name}必须是非负有限数字`);
        }
        return value;
    }
}
