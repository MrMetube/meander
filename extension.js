import * as vscode from 'vscode';
import { exec } from 'child_process';

export function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('meander.start', () => {
            startRadDebugger(true);
        }),
        vscode.commands.registerCommand('meander.open', () => {
            startRadDebugger(false);
        }),
    );
    
    updateDecorations(vscode.window.activeTextEditor);

    vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            updateDecorations(editor);
        }
    });

    vscode.window.onDidChangeActiveTextEditor(editor => {
        updateDecorations(editor);
    });
}

export function deactivate() {
    activeDecorations.forEach(decoration => decoration.dispose());
    activeDecorations.clear();
}

////////////////////////////////////////////////
// rad debugger

const config = {
    raddbgPath: 'C:\\tools\\raddbg\\raddbg.exe',
};

async function executeCommand(command) {
    try {
        const stdout = await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
        return stdout;
    } catch (error) {
        console.error(`Command execution failed: ${error.message}`);
        throw error;
    }
}

async function startRadDebugger(run) {
    const isRaddbgRunning = (await executeCommand('tasklist /NH')).toLowerCase().includes('raddbg.exe'.toLowerCase());
    if (isRaddbgRunning) {
        await executeCommand('taskkill /IM raddbg.exe /F');
    }
    
    try {
        if (run) {
            await executeCommand(`${config.raddbgPath} --auto_run --quit_after_success`);
        } else {
            await executeCommand(`${config.raddbgPath}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to start Rad Debugger: ${error.message}`);
    }
}

////////////////////////////////////////////////
// inline math

const MathComment = '///'
// A map to store active decorations for clearing.
const activeDecorations = new Map();

// Global map to store defined variables (vectors or scalars)
const variables = new Map();


/**
 * Updates decorations in the given text editor based on arithmetic and vector expressions in comments.
 * @param {vscode.TextEditor | undefined} editor The VS Code text editor to decorate.
 */
function updateDecorations(editor) {
    if (!editor) {
        return;
    }

    const document = editor.document;
    const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 1rem',
            fontStyle: 'italic',
            color: '#009052',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
    });

    const oldDecoration = activeDecorations.get(editor);
    oldDecoration?.dispose();
    
    activeDecorations.set(editor, decorationType);

    const decorations = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        let expression = null;

        // Extract expression from comment line
        if (line.text.startsWith(MathComment)) {
            expression = line.text.substring(line.text.indexOf(MathComment) + MathComment.length).trim();
        }
        if (expression === null || expression.length === 0) continue;
        
        const result = parse_expression(expression)
        
        if (result !== null) {
            const contentText = ` = ${formatResult(result)}`;
            const decoration = {
                range: line.range,
                renderOptions: {
                    after: { contentText },
                },
            };
            decorations.push(decoration);
        }
    }

    editor.setDecorations(decorationType, decorations);
}

function parse_expression(expression) {
    let result = null;

    try {
        // Check for assignment: `variable = value`
        const equals = expression.indexOf('=');
        if (equals !== -1 && equals > 0) {
            const varName  = expression.substring(0,  equals).trim();
            const valueStr = expression.substring(equals + 1).trim();

            let isValidVarName = true;
            if (varName.length === 0 || !(/[a-zA-Z_]/.test(varName[0]))) {
                isValidVarName = false;
            } else {
                for(let k = 1; k < varName.length; k++) {
                    if (!/[a-zA-Z0-9_]/.test(varName[k])) {
                        isValidVarName = false;
                        break;
                    }
                }
            }
            
            if (isValidVarName) {
                const parsedValue = parseValue(valueStr);
                if (parsedValue !== null) {
                    variables.set(varName, parsedValue);
                    return null; // No visible output for assignments
                }
            }
        }
        
        // Check functions
        const functions = [
            { name: "dot", args: 2, impl: dotProduct, },
            { name: "cross", args: 2, impl: crossProduct, },
            { name: "normalize", args: 1, impl: normalize, },
            { name: "length", args: 1, impl: length, },
            { name: "length_squared", args: 1, impl: lengthSquared, },
        ]
        for (const func of functions) {
            if (expression.startsWith(func.name+'(') && expression.endsWith(')')) {
                const argsContent = expression.substring(func.name.length+1, expression.length - 1).trim();
                
                let op1, op2;
                if(func.args == 2) {
                    const commaIndex = findTopLevelComma(argsContent);
                    if (commaIndex !== -1) {
                        const arg1Str = argsContent.substring(0, commaIndex).trim();
                        const arg2Str = argsContent.substring(commaIndex + 1).trim();
                        op1 = resolveOperand(arg1Str);
                        op2 = resolveOperand(arg2Str);
                    }
                } else {
                    op1 = resolveOperand(argsContent)
                }
                
                if (Array.isArray(op1)) {
                    if (func.args == 2){
                        if(!Array.isArray(op2)) {
                            op2 = Array(op1.length).fill(op2);
                        }
                        result = func.impl(op1, op2);
                    } else {
                        result = func.impl(op1);
                    }
                }
            }
        }
        // Fallback to scalar/scalar-vector arithmetic
        if (result == null) {
            let binaryOperator = null;
                let operatorIndex = -1;
                let braceDepth = 0;

                for (let k = 0; k < expression.length; k++) {
                    const char = expression[k];

                    if (char === '{') {
                        braceDepth++;
                    } else if (char === '}') {
                        braceDepth--;
                    }

                    if (braceDepth === 0) {
                        if (['+', '*', '/', '%'].includes(char)) {
                            binaryOperator = char;
                            operatorIndex = k;
                            break;
                        } else if (char === '-') {
                            let isUnaryCandidate = (k === 0);
                            if (!isUnaryCandidate && k > 0) {
                                let prevChar = expression[k-1];
                                let j = k - 1;
                                while (j >= 0 && expression[j] === ' ') {
                                    j--;
                                    if (j >= 0) prevChar = expression[j];
                                }
                                if (j < 0 || ['+', '-', '*', '/', '%'].includes(prevChar)) {
                                    isUnaryCandidate = true;
                                }
                            }

                            if (!isUnaryCandidate) {
                                binaryOperator = char;
                                operatorIndex = k;
                                break;
                            }
                        }
                    }
                }

                if (binaryOperator && operatorIndex !== -1) {
                    const leftPart  = expression.substring(0, operatorIndex).trim();
                    const rightPart = expression.substring(operatorIndex + 1).trim();

                    const leftOperand = resolveOperand(leftPart);
                    const rightOperand = resolveOperand(rightPart);

                    if (leftOperand !== null && rightOperand !== null) {
                        result = performArithmeticOperation(leftOperand, binaryOperator, rightOperand);
                    }
                } else if (parseValue(expression) !== null) {
                    result = parseValue(expression);
                }
        }
    } catch (error) {
            // Ignore errors.
    }
    return result;
}

/**
 * Helper to find a comma not inside braces for function arguments.
 * @param {string} str The string to search within.
 * @returns {number} The index of the top-level comma, or -1 if not found.
 */
function findTopLevelComma(str) {
    let braceCount = 0;
    let parenCount = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '{') braceCount++;
        else if (str[i] === '}') braceCount--;
        else if (str[i] === '(') parenCount++;
        else if (str[i] === ')') parenCount--;
        else if (str[i] === ',' && braceCount === 0 && parenCount === 0) return i;
    }
    return -1;
}

/**
 * Resolves an operand string which can be a literal or a variable name.
 * @param {string} operandStr The operand string.
 * @returns {number[] | number | null} The resolved value.
 */
function resolveOperand(operandStr) {
    const parsed = parseValue(operandStr);
    if (parsed !== null) {
        return parsed;
    }
    if (variables.has(operandStr)) {
        return variables.get(operandStr);
    }
    
    return parse_expression(operandStr);
}

/**
 * Parses a string to a number, vector (array), or null if invalid.
 * @param {string} str The string to parse.
 * @returns {number[] | number | null} The parsed value.
 */
function parseValue(str) {
    const num = parseFloat(str);
    if (!isNaN(num) && isFinite(str) && num.toString() === str) {
        return num;
    }
    if (str.startsWith('{') && str.endsWith('}')) {
        const content = str.substring(1, str.length - 1).trim();
        const elements = content.split(',').map(s => parseFloat(s.trim()));
        if (elements.every(e => !isNaN(e) && isFinite(e))) {
            return elements;
        }
    }
    return null;
}

/**
 * Performs scalar-scalar or scalar-vector arithmetic operations.
 * @param {any} op1 The first operand.
 * @param {string} operator The operator (+, -, *, /).
 * @param {any} op2 The second operand.
 * @returns {any | null} The result or null if the operation is not supported.
 */
function performArithmeticOperation(op1, operator, op2) {
    const isOp1Vector = Array.isArray(op1);
    const isOp2Vector = Array.isArray(op2);
    
    if (isOp1Vector && isOp2Vector) {
        let result = [];
        for(let i = 0; i < op1.length; i++) {
            const val = arithmetic(op1[i], operator, op2[i])
            if (val === null) return null;
            result[i] = val 
        }
        return result;
    }
    
    if (!isOp1Vector && !isOp2Vector) {
        return arithmetic(op1, operator, op2)
    }
    
    let result = [];
    if(isOp1Vector) {
        for(let i = 0; i < op1.length; i++) {
            const val = arithmetic(op1[i], operator, op2)
            if (val === null) return null;
            result[i] = val 
        }
    } else {
        for(let i = 0; i < op2.length; i++) {
            const val = arithmetic(op1, operator, op2[i])
            if (val === null) return null;
            result[i] = val 
        }
    }
    return result;
}

function arithmetic(a, op, b) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b == 0 ? null : a / b;
        case '%': return b == 0 ? null : a % b;
        default: return null;
    }
}

function dotProduct(v1, v2) {
    if (v1.length !== v2.length || v1.length === 0) {
        return null;
    }
    let sum = 0;
    for (let i = 0; i < v1.length; i++) {
        sum += v1[i] * v2[i];
    }
    return sum;
}

function crossProduct(v1, v2) {
    if (v1.length !== 3 || v2.length !== 3) {
        return null;
    }
    return [
        v1[1] * v2[2] - v1[2] * v2[1],
        v1[2] * v2[0] - v1[0] * v2[2],
        v1[0] * v2[1] - v1[1] * v2[0]
    ];
}

function normalize(v1) {
    return performArithmeticOperation(v1, '/', length(v1))
}

function lengthSquared(v1) {
    return dotProduct(v1, v1)
}
function length(v1) {
    return Math.sqrt(lengthSquared(v1));
}

/**
 * Formats the result for display.
 * @param {any} result The value to format.
 * @returns {string} The formatted string.
 */
function formatResult(result) {
    if (Array.isArray(result)) {
        return `{ ${result.map(n => parseFloat(n.toFixed(6))).join(', ')} }`;
    }
    return parseFloat(result.toFixed(6)).toString();
}
