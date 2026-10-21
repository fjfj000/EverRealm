import { WorldConfig } from "../../world/world-define";

/**
 * 时间分两套，不能互相倒推总时长。
 *
 * 真实游戏时间由 RealTimeCounter 按真实秒累加，暂停游戏也不停，和倍速无关。
 * 游戏时间由 WorldClock 推进。暂停或倍速为 0 时不加。每一小段按当时的 TimeSpeed 折算后累加。
 * 这两个计时互不调用。
 * TimeSpeed 中途会变，所以不能用“当前倍速 × 累计真实时间”还原累计游戏时间。
 *
 * 游戏历法没有时区、没有闰月。每月 30 天，每年 12 个月。
 * 游戏时间戳的单位是累计游戏秒。真实时间戳的单位是 Unix 毫秒。
 */
export const GameTimeUnit = {
    second: 1,
    minute: 60,
    hour: 60 * 60,
    day: 24 * 60 * 60,
    month: 30 * 24 * 60 * 60,
    year: 12 * 30 * 24 * 60 * 60,
} as const;

/** 游戏历法的一段。用于同一时段判断、取整和偏移。 */
export type TimeUnit = keyof typeof GameTimeUnit;

/**
 * 倍速没有变化的一段真实游戏时间。
 * 累计游戏时间等于各段 advanceGameSeconds 之和，不能合成一段再用最后的倍速计算。
 */
export interface GameTimeSegment {
    /** 这一段的真实游戏时间，秒。 */
    realSeconds: number;
    /** 这一段内没有改过的用户倍速。 */
    timeSpeed: number;
}

/** 一段时间的起点和终点，单位与传入的时间戳相同。两端都包含在内。 */
export interface TimeRange {
    start: number;
    end: number;
}

/** 累计游戏秒拆成的游戏历。年、月、日从 1 开始。 */
export interface GameDateParts {
    /** 从 1 开始。 */
    year: number;
    /** 1 到 12。 */
    month: number;
    /** 1 到 30。 */
    day: number;
    hour: number;
    minute: number;
    second: number;
}

/** 真实日期。月从 1 开始。默认是本地时区，不是游戏历。 */
export interface RealDateParts {
    year: number;
    /** 1 到 12。 */
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const formatTokens = ["YYYY", "MM", "DD", "HH", "mm", "ss"] as const;

/**
 * 当前这一刻，1 真实秒会推进多少游戏秒。
 * 只表示“现在”的倍率，等于 TickRate * timeSpeed。
 * 不能拿它去乘累计真实时间。用户改过倍速之后，以前的游戏时间已经按旧倍速加过了。
 */
export function getGameSecondsPerRealSecond(timeSpeed = WorldConfig.TimeSpeed): number {
    assertTimeSpeed(timeSpeed);
    assertTickRate(WorldConfig.TickRate);
    return WorldConfig.TickRate * timeSpeed;
}

/**
 * 把一段真实秒数按这段里固定的倍速换成游戏秒。
 * 倍速只在这段内有效。跨过调速点时要拆成多段，再相加。
 */
export function advanceGameSeconds(realSeconds: number, timeSpeed: number, tickRate = WorldConfig.TickRate): number {
    assertNonNegativeNumber(realSeconds, "真实秒数");
    assertTimeSpeed(timeSpeed);
    assertTickRate(tickRate);
    return realSeconds * tickRate * timeSpeed;
}

/**
 * 按历史分段把真实游戏时间加成累计游戏时间。
 * 这是唯一能从真实时间得到累计游戏时间的算法：每一段使用自己的倍速。
 */
export function sumGameSeconds(segments: readonly GameTimeSegment[], tickRate = WorldConfig.TickRate): number {
    if (!Array.isArray(segments)) {
        throw new Error("游戏时间分段必须是数组");
    }
    assertTickRate(tickRate);
    let total = 0;
    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (!segment) {
            throw new Error("游戏时间分段不能为空");
        }
        total += advanceGameSeconds(segment.realSeconds, segment.timeSpeed, tickRate);
    }
    return total;
}

/**
 * 把累计游戏秒格式化成游戏历。
 * pattern 支持 YYYY、MM、DD、HH、mm、ss。年从 1 开始。
 * 这里格式化的是已经累计好的游戏秒，不会读取真实时间或当前倍速。
 */
export function formatGameTime(gameSeconds: number, pattern = "YYYY-MM-DD HH:mm:ss"): string {
    const parts = getGameDateParts(gameSeconds);
    return fillPattern(pattern, {
        YYYY: padNumber(parts.year, 4),
        MM: padNumber(parts.month, 2),
        DD: padNumber(parts.day, 2),
        HH: padNumber(parts.hour, 2),
        mm: padNumber(parts.minute, 2),
        ss: padNumber(parts.second, 2),
    });
}

/**
 * 把 Unix 毫秒格式化成真实日期。
 * 默认本地时区。utc 为 true 时按 UTC。和游戏历、倍速无关。
 */
export function formatRealTime(realTime: number, pattern = "YYYY-MM-DD HH:mm:ss", utc = false): string {
    const parts = getRealDateParts(realTime, utc);
    return fillPattern(pattern, {
        YYYY: padNumber(parts.year, 4),
        MM: padNumber(parts.month, 2),
        DD: padNumber(parts.day, 2),
        HH: padNumber(parts.hour, 2),
        mm: padNumber(parts.minute, 2),
        ss: padNumber(parts.second, 2),
    });
}

/**
 * 把一段累计游戏秒写成“1年2月3天”这样的时长。
 * 负数会带负号。不足 1 秒时显示 0 秒。
 */
export function formatGameDuration(gameSeconds: number): string {
    assertFiniteNumber(gameSeconds, "游戏时间");
    const sign = gameSeconds < 0 ? "-" : "";
    let rest = Math.abs(Math.floor(gameSeconds));
    const years = Math.floor(rest / GameTimeUnit.year);
    rest -= years * GameTimeUnit.year;
    const months = Math.floor(rest / GameTimeUnit.month);
    rest -= months * GameTimeUnit.month;
    const days = Math.floor(rest / GameTimeUnit.day);
    rest -= days * GameTimeUnit.day;
    const hours = Math.floor(rest / GameTimeUnit.hour);
    rest -= hours * GameTimeUnit.hour;
    const minutes = Math.floor(rest / GameTimeUnit.minute);
    const seconds = rest - minutes * GameTimeUnit.minute;
    const parts: string[] = [];
    if (years !== 0) {
        parts.push(`${years}年`);
    }
    if (months !== 0) {
        parts.push(`${months}月`);
    }
    if (days !== 0) {
        parts.push(`${days}天`);
    }
    if (hours !== 0) {
        parts.push(`${hours}时`);
    }
    if (minutes !== 0) {
        parts.push(`${minutes}分`);
    }
    if (seconds !== 0 || parts.length === 0) {
        parts.push(`${seconds}秒`);
    }
    return sign + parts.join("");
}

/**
 * 把累计游戏秒拆成游戏历。
 * 只看游戏时间轴上的位置，不看这段时间是用什么倍速走过来的。
 */
export function getGameDateParts(gameSeconds: number): GameDateParts {
    assertFiniteNumber(gameSeconds, "游戏时间");
    const total = Math.floor(gameSeconds);
    const yearIndex = Math.floor(total / GameTimeUnit.year);
    const yearRemainder = positiveMod(total, GameTimeUnit.year);
    const monthIndex = Math.floor(yearRemainder / GameTimeUnit.month);
    const monthRemainder = yearRemainder % GameTimeUnit.month;
    const dayIndex = Math.floor(monthRemainder / GameTimeUnit.day);
    const dayRemainder = monthRemainder % GameTimeUnit.day;
    const hour = Math.floor(dayRemainder / GameTimeUnit.hour);
    const hourRemainder = dayRemainder % GameTimeUnit.hour;
    const minute = Math.floor(hourRemainder / GameTimeUnit.minute);
    const second = hourRemainder % GameTimeUnit.minute;
    return {
        year: yearIndex + 1,
        month: monthIndex + 1,
        day: dayIndex + 1,
        hour,
        minute,
        second,
    };
}

/**
 * 把 Unix 毫秒拆成真实日期。
 * utc 为 false 时用本地时区。这是墙上的日历，不是游戏历。
 */
export function getRealDateParts(realTime: number, utc = false): RealDateParts {
    const date = toRealDate(realTime);
    if (utc) {
        return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            hour: date.getUTCHours(),
            minute: date.getUTCMinutes(),
            second: date.getUTCSeconds(),
        };
    }
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
    };
}

/**
 * 两个累计游戏秒是否落在同一个游戏时段。
 * 例如同一游戏日是从 0 点到下一个 0 点，不是同一段真实时间。
 */
export function isSameGameTime(left: number, right: number, unit: TimeUnit): boolean {
    return gameUnitIndex(left, unit) === gameUnitIndex(right, unit);
}

/** 是否同一游戏分钟。参数是累计游戏秒。 */
export function isSameGameMinute(left: number, right: number): boolean {
    return isSameGameTime(left, right, "minute");
}

/** 是否同一游戏小时。参数是累计游戏秒。 */
export function isSameGameHour(left: number, right: number): boolean {
    return isSameGameTime(left, right, "hour");
}

/** 是否同一游戏日。参数是累计游戏秒。 */
export function isSameGameDay(left: number, right: number): boolean {
    return isSameGameTime(left, right, "day");
}

/** 是否同一游戏月。参数是累计游戏秒。 */
export function isSameGameMonth(left: number, right: number): boolean {
    return isSameGameTime(left, right, "month");
}

/** 是否同一游戏年。参数是累计游戏秒。 */
export function isSameGameYear(left: number, right: number): boolean {
    return isSameGameTime(left, right, "year");
}

/**
 * 两个 Unix 毫秒是否落在同一个真实日历时段。
 * 按本地时区计算。跨过午夜就不是同一天，和游戏倍速无关。
 */
export function isSameRealTime(left: number, right: number, unit: TimeUnit): boolean {
    return startOfRealTime(left, unit) === startOfRealTime(right, unit);
}

/** 是否同一真实分钟。参数是 Unix 毫秒。 */
export function isSameRealMinute(left: number, right: number): boolean {
    return isSameRealTime(left, right, "minute");
}

/** 是否同一真实小时。参数是 Unix 毫秒。 */
export function isSameRealHour(left: number, right: number): boolean {
    return isSameRealTime(left, right, "hour");
}

/** 是否同一真实日。参数是 Unix 毫秒。 */
export function isSameRealDay(left: number, right: number): boolean {
    return isSameRealTime(left, right, "day");
}

/** 是否同一真实月。参数是 Unix 毫秒。 */
export function isSameRealMonth(left: number, right: number): boolean {
    return isSameRealTime(left, right, "month");
}

/** 是否同一真实年。参数是 Unix 毫秒。 */
export function isSameRealYear(left: number, right: number): boolean {
    return isSameRealTime(left, right, "year");
}

/**
 * 累计游戏时间从 from 走到 to，越过了多少个 unit 边界。
 * to 不能早于 from。世界只向前走，倒退说明累计值被写坏了。
 */
export function countGameUnitsCrossed(from: number, to: number, unit: TimeUnit): number {
    assertFiniteNumber(from, "开始游戏时间");
    assertFiniteNumber(to, "结束游戏时间");
    if (to < from) {
        throw new Error("游戏时间不能倒退");
    }
    return gameUnitIndex(to, unit) - gameUnitIndex(from, unit);
}

/**
 * 某个累计游戏秒在它所处的 unit 里已经走过的秒数。
 * 例如游戏日进度是从当天 0 点算起的秒数。
 */
export function gameTimeRemainder(gameSeconds: number, unit: TimeUnit): number {
    return gameSeconds - startOfGameTime(gameSeconds, unit);
}

/**
 * 累计游戏秒前后的游戏历范围。
 * amount 为 3、unit 为 day 时，起点是 3 个游戏日之前，终点是 3 个游戏日之后。
 * 这是游戏时间轴上的位移，不是真实时间的 3 天，也不使用当前倍速。
 */
export function getGameTimeRange(gameSeconds: number, amount: number, unit: TimeUnit): TimeRange {
    assertFiniteNumber(gameSeconds, "游戏时间");
    assertAmount(amount);
    const span = gameUnitSeconds(unit) * amount;
    return {
        start: gameSeconds - span,
        end: gameSeconds + span,
    };
}

/**
 * Unix 毫秒前后的真实时间范围。
 * 分、时、日按固定长度移动。月和年按本地日历增减，不是游戏历的 30 天。
 */
export function getRealTimeRange(realTime: number, amount: number, unit: TimeUnit): TimeRange {
    assertAmount(amount);
    return {
        start: addRealTime(realTime, -amount, unit),
        end: addRealTime(realTime, amount, unit),
    };
}

/** 累计游戏秒是否落在范围内。两端都包含。 */
export function isGameTimeInRange(gameSeconds: number, range: TimeRange): boolean {
    assertFiniteNumber(gameSeconds, "游戏时间");
    assertRange(range);
    return gameSeconds >= range.start && gameSeconds <= range.end;
}

/**
 * 在累计游戏秒上加减若干游戏历单位。
 * amount 可以为负。加的是游戏日、游戏小时，不是按当前倍速折算的真实时间。
 */
export function addGameTime(gameSeconds: number, amount: number, unit: TimeUnit): number {
    assertFiniteNumber(gameSeconds, "游戏时间");
    assertFiniteNumber(amount, "偏移量");
    return gameSeconds + amount * gameUnitSeconds(unit);
}

/**
 * 在 Unix 毫秒上加减真实日历单位。
 * 月和年使用本地日历，月底会按 JavaScript 的日期规则进位。
 */
export function addRealTime(realTime: number, amount: number, unit: TimeUnit): number {
    assertFiniteNumber(amount, "偏移量");
    const date = toRealDate(realTime);
    switch (unit) {
        case "second":
            date.setSeconds(date.getSeconds() + amount);
            break;
        case "minute":
            date.setMinutes(date.getMinutes() + amount);
            break;
        case "hour":
            date.setHours(date.getHours() + amount);
            break;
        case "day":
            date.setDate(date.getDate() + amount);
            break;
        case "month":
            date.setMonth(date.getMonth() + amount);
            break;
        case "year":
            date.setFullYear(date.getFullYear() + amount);
            break;
        default:
            return assertNever(unit);
    }
    return date.getTime();
}

/**
 * 累计游戏秒所在 unit 的起点。
 * 游戏日的起点是当天 0 点。返回值仍是累计游戏秒。
 */
export function startOfGameTime(gameSeconds: number, unit: TimeUnit): number {
    assertFiniteNumber(gameSeconds, "游戏时间");
    const size = gameUnitSeconds(unit);
    return Math.floor(gameSeconds / size) * size;
}

/**
 * 累计游戏秒所在 unit 的结束边界。
 * 返回的是下一段的起点，本身不属于这一段。
 */
export function endOfGameTime(gameSeconds: number, unit: TimeUnit): number {
    return startOfGameTime(gameSeconds, unit) + gameUnitSeconds(unit);
}

/**
 * Unix 毫秒所在真实日历单位的起点，本地时区。
 * 日是当地 0 点，月是当月 1 日 0 点，年是当年 1 月 1 日 0 点。
 */
export function startOfRealTime(realTime: number, unit: TimeUnit): number {
    const date = toRealDate(realTime);
    switch (unit) {
        case "second":
            date.setMilliseconds(0);
            break;
        case "minute":
            date.setSeconds(0, 0);
            break;
        case "hour":
            date.setMinutes(0, 0, 0);
            break;
        case "day":
            date.setHours(0, 0, 0, 0);
            break;
        case "month":
            date.setDate(1);
            date.setHours(0, 0, 0, 0);
            break;
        case "year":
            date.setMonth(0, 1);
            date.setHours(0, 0, 0, 0);
            break;
        default:
            return assertNever(unit);
    }
    return date.getTime();
}

/**
 * to 减 from，结果是游戏历单位的数量，带正负，不取整。
 * 90 游戏秒按 minute 计算得到 1.5。比较的是两个累计游戏秒，不是两段真实时间。
 */
export function diffGameTime(from: number, to: number, unit: TimeUnit): number {
    assertFiniteNumber(from, "开始游戏时间");
    assertFiniteNumber(to, "结束游戏时间");
    return (to - from) / gameUnitSeconds(unit);
}

function gameUnitIndex(gameSeconds: number, unit: TimeUnit): number {
    assertFiniteNumber(gameSeconds, "游戏时间");
    return Math.floor(gameSeconds / gameUnitSeconds(unit));
}

function gameUnitSeconds(unit: TimeUnit): number {
    switch (unit) {
        case "second":
            return GameTimeUnit.second;
        case "minute":
            return GameTimeUnit.minute;
        case "hour":
            return GameTimeUnit.hour;
        case "day":
            return GameTimeUnit.day;
        case "month":
            return GameTimeUnit.month;
        case "year":
            return GameTimeUnit.year;
        default:
            return assertNever(unit);
    }
}

function fillPattern(pattern: string, values: Record<(typeof formatTokens)[number], string>): string {
    let text = pattern;
    for (let index = 0; index < formatTokens.length; index++) {
        const token = formatTokens[index];
        text = text.split(token).join(values[token]);
    }
    return text;
}

function padNumber(value: number, width: number): string {
    const sign = value < 0 ? "-" : "";
    let text = Math.abs(Math.trunc(value)).toString();
    while (text.length < width) {
        text = `0${text}`;
    }
    return sign + text;
}

/** 负数取模后仍落在当前周期里，方便拆月、日、时。 */
function positiveMod(value: number, base: number): number {
    const mod = value % base;
    return mod < 0 ? mod + base : mod;
}

function assertFiniteNumber(value: number, name: string): void {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${name}必须是有限数字`);
    }
}

function assertNonNegativeNumber(value: number, name: string): void {
    assertFiniteNumber(value, name);
    if (value < 0) {
        throw new Error(`${name}不能小于 0`);
    }
}

function assertAmount(amount: number): void {
    assertNonNegativeNumber(amount, "数量");
}

function assertTimeSpeed(timeSpeed: number): void {
    assertNonNegativeNumber(timeSpeed, "时间倍速");
}

function assertTickRate(tickRate: number): void {
    if (typeof tickRate !== "number" || !Number.isFinite(tickRate) || tickRate <= 0) {
        throw new Error("TickRate 必须是大于 0 的有限数字");
    }
}

function assertRange(range: TimeRange): void {
    if (!range) {
        throw new Error("缺少时间范围");
    }
    assertFiniteNumber(range.start, "范围起点");
    assertFiniteNumber(range.end, "范围终点");
    if (range.start > range.end) {
        throw new Error("范围起点不能晚于终点");
    }
}

function assertRealTime(realTime: number): void {
    assertFiniteNumber(realTime, "真实时间");
}

function toRealDate(realTime: number): Date {
    assertRealTime(realTime);
    const date = new Date(realTime);
    if (Number.isNaN(date.getTime())) {
        throw new Error("真实时间无法表示成日期");
    }
    return date;
}

function assertNever(unit: never): never {
    throw new Error(`未知时间单位 ${String(unit)}`);
}
