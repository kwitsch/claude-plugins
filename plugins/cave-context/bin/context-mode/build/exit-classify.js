export function classifyNonZeroExit(params) {
    const { language, exitCode, stdout, stderr } = params;
    const isSoftFail = language === "shell" &&
        exitCode === 1 &&
        stdout.trim().length > 0;
    return {
        isError: !isSoftFail,
        output: isSoftFail
            ? stdout
            : `Exit code: ${exitCode}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
    };
}
