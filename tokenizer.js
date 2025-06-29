
// Define token types
export const TokenType = {
    NUMBER: 'NUMBER',
    IDENTIFIER: 'IDENTIFIER',
    OPERATOR: 'OPERATOR',
    PAREN_OPEN: 'PAREN_OPEN',
    PAREN_CLOSE: 'PAREN_CLOSE',
    BRACE_OPEN: 'BRACE_OPEN',
    BRACE_CLOSE: 'BRACE_CLOSE',
    COMMA: 'COMMA',
    EQUALS: 'EQUALS',
    EOF: 'EOF', // End of File/Expression
};

/**
 * Lexer: Converts an expression string into a stream of tokens.
 * @param {string} input The input expression string.
 * @returns {{type: string, value: string}[]} An array of tokens.
 */
export function tokenize(input) {
    const tokens = [];
    let i = 0;

    const isDigit = (c) => c >= '0' && c <= '9';
    const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    const isAlphaNumeric = (c) => isAlpha(c) || isDigit(c);
    const isWhitespace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

    while (i < input.length) {
        let char = input[i];

        if (isWhitespace(char)) {
            i++;
            continue;
        }

        if (isDigit(char) || (char === '-' && (i + 1 < input.length && isDigit(input[i+1])))) {
            let start = i;
            if (char === '-') i++; // Consume the leading minus sign
            while (i < input.length && isDigit(input[i])) {
                i++;
            }
            if (i < input.length && input[i] === '.') {
                i++;
                while (i < input.length && isDigit(input[i])) {
                    i++;
                }
            }
            tokens.push({ type: TokenType.NUMBER, value: input.substring(start, i) });
            continue;
        }

        if (isAlpha(char) || char === '_') {
            let start = i;
            while (i < input.length && isAlphaNumeric(input[i]) || input[i] === '_') {
                i++;
            } 
            tokens.push({ type: TokenType.IDENTIFIER, value: input.substring(start, i) });
            continue;
        }

        switch (char) {
            case '+':
            case '-':
            case '*':
            case '/':
            case '%':
                tokens.push({ type: TokenType.OPERATOR, value: char });
                break;
            case '(':
                tokens.push({ type: TokenType.PAREN_OPEN, value: char });
                break;
            case ')':
                tokens.push({ type: TokenType.PAREN_CLOSE, value: char });
                break;
            case '{':
                // Handle vector literal
                let braceStart = i;
                let braceDepth = 1;
                i++; // Consume '{'
                while (i < input.length && braceDepth > 0) {
                    if (input[i] === '{') braceDepth++;
                    else if (input[i] === '}') braceDepth--;
                    i++;
                }
                if (braceDepth === 0) {
                    const vectorStr = input.substring(braceStart, i);
                    tokens.push({ type: TokenType.NUMBER, value: vectorStr }); // Treat vector literal as a special 'number' type for parseValue
                } else {
                    throw new Error("Unmatched brace in vector literal");
                }
                continue; // Continue outer loop after consuming vector
            case '}': // Should be consumed as part of vector literal, but added for safety
                tokens.push({ type: TokenType.BRACE_CLOSE, value: char });
                break;
            case ',':
                tokens.push({ type: TokenType.COMMA, value: char });
                break;
            case '=':
                tokens.push({ type: TokenType.EQUALS, value: char });
                break;
            default:
                throw new Error(`Unexpected character: ${char} at position ${i}`);
        }
        i++;
    }

    tokens.push({ type: TokenType.EOF, value: '' });
    return tokens;
}
