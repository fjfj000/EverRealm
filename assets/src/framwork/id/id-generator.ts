import { IdType } from "./id-define";

export function generateId(type: IdType): string {
    return `${type}:${Date.now()}:${Math.random().toString(36).substring(2, 15)}`;
}
