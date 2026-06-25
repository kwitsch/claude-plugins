import { homedir } from "node:os";
import { resolve } from "node:path";
export function resolveKimiConfigDir() {
    const envVal = process.env.KIMI_CODE_HOME;
    if (envVal) {
        if (envVal.startsWith("~")) {
            return resolve(homedir(), envVal.replace(/^~[/\\]?/, ""));
        }
        return resolve(envVal);
    }
    return resolve(homedir(), ".kimi-code");
}
