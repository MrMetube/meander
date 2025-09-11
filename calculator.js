import { TokenType, tokenize } from './tokenizer.js';

// Global map to store defined variables (vectors or scalars)
const variables = new Map();

/**
 * Parser: Evaluates the expression using a token stream.
 * @param {string} expression The raw expression string.
 * @returns {any | null} The evaluated result.
 */
export function evaluate_expression(expression) {
    const tokens = tokenize(expression);

    let tokenIndex = 0;

    const peek = () => tokens[tokenIndex];
    const consume = (expectedType) => {
        const token = tokens[tokenIndex];
        if (expectedType && token.type !== expectedType) {
            throw new Error(`Expected ${expectedType}, got ${token.type} (${token.value})`);
        }
        tokenIndex++;
        return token;
    };

    // Primary expressions: numbers, vectors, identifiers, parenthesized expressions
    const parsePrimary = () => {
        let token = peek();

        if (token.type === TokenType.NUMBER) {
            consume(TokenType.NUMBER);
            return parseValue(token.value);
        }

        if (token.type === TokenType.IDENTIFIER) {
            const identifier = consume(TokenType.IDENTIFIER).value;
            // Handle function call or variable
            if (peek().type === TokenType.PAREN_OPEN) {
                consume(TokenType.PAREN_OPEN); // Consume '('
                const args = [];
                if (peek().type !== TokenType.PAREN_CLOSE) {
                    args.push(parseExpression());
                    while (peek().type === TokenType.COMMA) {
                        consume(TokenType.COMMA);
                        args.push(parseExpression());
                    }
                }
                consume(TokenType.PAREN_CLOSE); // Consume ')'
                
                // Find and execute function
                const func = functions.find(f => f.name === identifier);
                if (func && args.length === func.args) {
                    // Resolve arguments before passing to function
                    const resolvedArgs = args.map(arg => {
                        if (typeof arg === 'string') return resolveOperand(arg); // If it's still a string (e.g., variable name)
                        return arg; // Already parsed value
                    });

                    // Special handling for scalar-vector operations with single scalar argument
                    if (func.name === "dot" || func.name === "cross") {
                         if (Array.isArray(resolvedArgs[0]) && !Array.isArray(resolvedArgs[1])) {
                             resolvedArgs[1] = createArray(resolvedArgs[0].length, resolvedArgs[1]);
                         } else if (!Array.isArray(resolvedArgs[0]) && Array.isArray(resolvedArgs[1])) {
                             resolvedArgs[0] = createArray(resolvedArgs[1].length, resolvedArgs[0]);
                         }
                    }

                    if (resolvedArgs.every(arg => arg !== null)) {
                        return func.impl(...resolvedArgs);
                    }
                }
                return null; // Invalid function call
            } else {
                // It's a variable
                return resolveOperand(identifier);
            }
        }

        if (token.type === TokenType.PAREN_OPEN) {
            consume(TokenType.PAREN_OPEN);
            const expr = parseExpression();
            consume(TokenType.PAREN_CLOSE);
            return expr;
        }

        return null; // Unrecognized primary
    };

    // Unary operations (e.g., -5) - this parser doesn't explicitly distinguish unary minus for now
    const parseUnary = () => parsePrimary();

    // Multiplication, Division, Modulo
    const parseTerm = () => {
        let left = parseUnary();
        while (['*', '/', '%'].includes(peek().value)) {
            const operator = consume(TokenType.OPERATOR).value;
            const right = parseUnary();
            if (left === null || right === null) return null;
            left = performArithmeticOperation(left, operator, right);
        }
        return left;
    };

    // Addition, Subtraction
    const parseExpression = () => {
        let left = parseTerm();
        while (['+', '-'].includes(peek().value)) {
            const operator = consume(TokenType.OPERATOR).value;
            const right = parseTerm();
            if (left === null || right === null) return null;
            left = performArithmeticOperation(left, operator, right);
        }
        return left;
    };

    // Main parsing logic for assignments or expressions
    const parseProgram = () => {
        if (peek().type === TokenType.IDENTIFIER && tokens[tokenIndex + 1]?.type === TokenType.EQUALS) {
            const varName = consume(TokenType.IDENTIFIER).value;
            consume(TokenType.EQUALS);
            const value = parseExpression();
            if (value !== null) {
                variables.set(varName, value);
                return null; // Assignments don't produce a display result
            }
            return null; // Invalid assignment value
        } else {
            return parseExpression();
        }
    };
    
    let result = parseProgram();
    consume(TokenType.EOF); // Ensure all tokens are consumed
    return result;
}

/**
 * Resolves an operand string which can be a literal or a variable name.
 * This function is now mostly used by the parser's `resolveOperand` to get values for identifiers.
 * @param {string} operandStr The operand string (expected to be a variable name or raw literal string).
 * @returns {number[] | number | null} The resolved value.
 */
function resolveOperand(operandStr) {
    const parsed = parseValue(operandStr); // Try parsing as a literal first
    if (parsed !== null) {
        return parsed;
    }
    if (variables.has(operandStr)) { // Then try as a variable
        return variables.get(operandStr);
    }
    // If it's neither a literal nor a simple variable, it might be a sub-expression
    // This is handled by the new parser's recursive `parseExpression` calls
    return null; // Should not reach here if parseExpression is correctly used.
}

/**
 * Parses a string to a number or vector (array).
 * This is called by the lexer for `NUMBER` token values.
 * @param {string} str The string value from a token.
 * @returns {number[] | number | null} The parsed value.
 */
function parseValue(str) {
    // Check for number
    const num = parseFloat(str);
    if (!isNaN(num) && isFinite(str) && num.toString() === str) { // Ensure the whole string is a valid number
        return num;
    }
    // Check for vector literal like {1, 2, 3}
    if (str.startsWith('{') && str.endsWith('}')) {
        const content = str.substring(1, str.length - 1).trim();
        const elements = content.split(',').map(s => parseFloat(s.trim()));
        if (elements.every(e => !isNaN(e) && isFinite(e))) {
            return elements;
        }
    }
    return null; // Invalid format
}

/**
 * Performs scalar-scalar, vector-scalar, or scalar-vector arithmetic operations.
 * Also handles vector-vector element-wise operations.
 * @param {any} op1 The first operand (number or array).
 * @param {string} operator The operator (+, -, *, /).
 * @param {any} op2 The second operand (number or array).
 * @returns {any | null} The result or null if the operation is not supported or invalid.
 */
function performArithmeticOperation(op1, operator, op2) {
    const isOp1Vector = Array.isArray(op1);
    const isOp2Vector = Array.isArray(op2);
    
    if (isOp1Vector || isOp2Vector) {
        if (!isOp1Vector) {
            op1 = createArray(op2.length, op1)
        } else if (!isOp2Vector) {
            op2 = createArray(op1.length, op2)
        }
        if (op1.length !== op2.length) return null; // Vectors must be same length for element-wise
        
        let result = [];
        
        for(let i = 0; i < op1.length; i++) {
            const val = arithmetic(op1[i], operator, op2[i])
            if (val === null) return null; // Propagate null for invalid arithmetic op
            result[i] = val 
        }
        
        return result;
    } else {
        return arithmetic(op1, operator, op2)
    }
}

// Basic arithmetic operation for two numbers
function arithmetic(a, op, b) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
        case '%': return b === 0 ? null : a % b;
        default: return null;
    }
}

// Dot product of two vectors
function dotProduct(v1, v2) {
    if (v1.length !== v2.length || v1.length === 0) {
        return null; // Vectors must have the same non-zero dimension
    }
    let sum = 0;
    for (let i = 0; i < v1.length; i++) {
        sum += v1[i] * v2[i];
    }
    return sum;
}

// Cross product of two 3D vectors
function crossProduct(v1, v2) {
    if (v1.length !== 3 || v2.length !== 3) {
        return null; // Cross product is defined for 3D vectors only
    }
    return [
        v1[1] * v2[2] - v1[2] * v2[1],
        v1[2] * v2[0] - v1[0] * v2[2],
        v1[0] * v2[1] - v1[1] * v2[0]
    ];
}

// Normalizes a vector
function normalize(v) {
    const len = length(v);
    if (len === 0) return null; // Cannot normalize a zero vector
    return performArithmeticOperation(v, '/', len);
}

// Calculates squared length of a vector
function lengthSquared(v) {
    return dotProduct(v, v);
}

function arm(x) {
    return [Math.cos(x), Math.sin(x)];
}

// Calculates length (magnitude) of a vector
function length(v) {
    const lSq = lengthSquared(v);
    if (lSq === null || lSq < 0) return null; // Should not be < 0 but for safety
    return Math.sqrt(lSq);
}

// Creates an array of n items all with value x
function createArray(n, x) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        return null;
    }
    return Array(n).fill(x);
}
// @todo(viktor): add Tau radtodeg degtorad and cos sin tan and stuff
// List of supported functions for the parser
const functions = [
    { name: "dot", args: 2, impl: dotProduct },
    { name: "cross", args: 2, impl: crossProduct },
    { name: "normalize", args: 1, impl: normalize },
    { name: "max", args: 2, impl: Math.max },
    { name: "min", args: 2, impl: Math.min },
    { name: "arm", args: 1, impl: arm },
    { name: "length", args: 1, impl: length },
    { name: "length_squared", args: 1, impl: lengthSquared },
    { name: "array", args: 2, impl: createArray }, // Add createArray as "array" function
];
