import * as vscode from 'vscode';
import { evaluate_expression } from './calculator.js';
import { exec } from 'child_process';

const config = {
    raddbgPath: 'C:\\tools\\raddbg\\raddbg.exe',
    showInlineMath: true,
};

export function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('meander.start', () => {
            startRadDebugger(true);
        }),
        vscode.commands.registerCommand('meander.open', () => {
            startRadDebugger(false);
        }),
        vscode.commands.registerCommand('meander.toggle_math', () => {
            config.showInlineMath = !config.showInlineMath;
            updateDecorations(vscode.window.activeTextEditor);
        }),
        vscode.commands.registerCommand('meander.check_math', () => {
            vscode.window.showInformationMessage(`Inline Math is currently ${config.showInlineMath ? "active" : "inactive"}`);
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
    clearDecorations()
}

////////////////////////////////////////////////
// rad debugger

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

const MathComment = '/// '
// A map to store active decorations for clearing.
const activeDecorations = new Map();

function clearDecorations() {
    activeDecorations.forEach(decoration => decoration.dispose());
    activeDecorations.clear();
}

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
    
    if (!config.showInlineMath) {
        clearDecorations()
    } else {
        const oldDecoration = activeDecorations.get(editor);
        oldDecoration?.dispose();
        
        activeDecorations.set(editor, decorationType);

        const decorations = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            let expression = null;

            // Extract expression from comment line
            if (line.text.includes(MathComment)) {
                expression = line.text.substring(line.text.indexOf(MathComment) + MathComment.length).trim();
            }
            if (expression === null || expression.length === 0) continue;
            
            try {
                const result = evaluate_expression(expression)
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
            } catch (error) {
                const contentText = ` :: ${error}`;
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
    // Handle null result explicitly
    if (result === null) {
        return 'Error';
    }
    return parseFloat(result.toFixed(6)).toString();
}
