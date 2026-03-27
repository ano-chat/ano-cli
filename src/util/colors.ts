const enabled = !process.env.NO_COLOR && process.stdout.isTTY === true;

function wrap(code: string, reset: string) {
  return (text: string) =>
    enabled ? `\x1b[${code}m${text}\x1b[${reset}m` : text;
}

export const bold = wrap("1", "22");
export const dim = wrap("2", "22");
export const red = wrap("31", "39");
export const green = wrap("32", "39");
export const yellow = wrap("33", "39");
export const cyan = wrap("36", "39");
