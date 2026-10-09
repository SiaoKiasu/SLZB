// Exchange symbols may contain Chinese characters, e.g. 牛来 / 牛来USDT.
// Keep identifiers bounded and exclude whitespace, control characters and separators.
export const assetSymbolPattern = /^[A-Z0-9\p{Script=Han}]{1,30}$/u;
export const tradeSymbolPattern = /^[A-Z0-9\p{Script=Han}]{5,30}$/u;
