// 扩展主入口文件
import * as vscode from 'vscode';
import { Vocabulary, TempVocabulary } from './types';
import { loadVocabulary, initTempVocabulary, saveVocabulary } from './vocabulary/vocabulary-manager';
import { getTargetLanguage, setTargetLanguage } from './config/config-manager';
import { registerCommands } from './commands/command-register';
import { collectAndPrepareTranslatableItems } from './extraction/extractor';
import { processContributionQueue } from './contribution/contribution-manager';
import { applyMotherTongueDecorations, refreshAllDecorations, clearAllDecorations, registerVisibleRangeListener, clearDocumentCache } from './ui/decorator-manager';
import * as fs from 'fs';
import * as path from 'path';
import { fileExists } from './vocabulary/vocabulary-storage';

// 全局变量
let currentVocabulary: Vocabulary | null = null;
let currentVocabularyPath: vscode.Uri | null = null; // 新增：存储当前词汇表的文件路径
let currentTempVocabulary: TempVocabulary | null = null;
let isExtractionEnabled: boolean = true; // 新增：控制是否允许提取功能的标志
let globalExtensionContext: vscode.ExtensionContext | null = null;
let isRefreshing: boolean = false; // 新增：母语显示刷新锁，防止切换时脏刷新

/**
 * 防抖工具函数
 * @param fn 函数
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number) {
    let timer: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/**
 * 扩展激活函数
 * @param context 扩展上下文
 */
export async function activate(context: vscode.ExtensionContext) {
    try {
        console.log('[CodeLocalizer] 扩展 "code-localizer" 正在激活...');
        
        // 保存全局扩展上下文
        globalExtensionContext = context;
        
        // 记录全局存储信息
        console.log(`[CodeLocalizer] globalStorageUri 可用: ${context.globalStorageUri ? '是' : '否'}`);
        if (context.globalStorageUri) {
            console.log(`[CodeLocalizer] globalStorageUri 路径: ${context.globalStorageUri.fsPath}`);
        }
        
        // 检查工作区状态
        const hasWorkspaceFolders = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        if (!hasWorkspaceFolders) {
            console.log("[CodeLocalizer] 无工作区文件夹打开，将使用扩展目录和全局存储进行词汇表管理。");
        } else {
            console.log(`[CodeLocalizer] 已找到工作区文件夹: ${vscode.workspace.workspaceFolders!.map(f => f.uri.fsPath).join(', ')}`);
        }

        // 确定目标语言
        const targetLang = getTargetLanguage();
        console.log(`[CodeLocalizer] 目标语言确定为: ${targetLang}`);
        
        // 列出当前目录下的所有词汇表文件，用于调试
        console.log(`[CodeLocalizer Debug] 扩展目录路径: ${context.extensionUri.fsPath}`);
        console.log(`[CodeLocalizer Debug] 当前工作目录: ${process.cwd()}`);
        
        try {
            const files = fs.readdirSync(process.cwd());
            const vocabFiles = files.filter(f => f.startsWith('loc_core_vocabulary_'));
            console.log(`[CodeLocalizer Debug] 找到词汇表文件: ${vocabFiles.join(', ')}`);
            
            // 检查目标语言的词汇表文件是否存在
            const targetVocabFile = `loc_core_vocabulary_${targetLang}.json`;
            if (vocabFiles.includes(targetVocabFile)) {
                console.log(`[CodeLocalizer Debug] 目标语言词汇表文件存在: ${targetVocabFile}`);
                // 确认文件是否可读
                try {
                    const stat = fs.statSync(path.join(process.cwd(), targetVocabFile));
                    console.log(`[CodeLocalizer Debug] 词汇表文件大小: ${stat.size} 字节`);
                    
                    // 直接加载词汇表文件进行测试
                    try {
                        const fileContent = fs.readFileSync(path.join(process.cwd(), targetVocabFile), 'utf-8');
                        const loadedVocab = JSON.parse(fileContent);
                        console.log(`[CodeLocalizer Debug] 直接加载词汇表成功，包含 ${Object.keys(loadedVocab.system_vocabulary).length} 个系统词汇项`);
                    } catch (readErr) {
                        console.error(`[CodeLocalizer Debug] 直接读取词汇表失败: ${readErr}`);
                    }
                } catch (statErr) {
                    console.error(`[CodeLocalizer Debug] 无法获取词汇表文件信息: ${statErr}`);
                }
            } else {
                console.warn(`[CodeLocalizer Debug] 未找到目标语言词汇表文件: ${targetVocabFile}`);
            }
        } catch (fsErr) {
            console.error(`[CodeLocalizer Debug] 检查词汇表文件时出错: ${fsErr}`);
        }
        
        // 加载词汇表
        console.log(`[CodeLocalizer] 开始加载词汇表...`);
        try {
            const loadResult = await loadVocabulary(context, targetLang);
            
            if (loadResult) {
                currentVocabulary = loadResult.vocabulary;
                currentVocabularyPath = loadResult.path;
                console.log(`[CodeLocalizer] 词汇表加载成功，路径: ${currentVocabularyPath ? currentVocabularyPath.fsPath : '无'}`);

                // 检查 .vscode 目录下是否存在对应语言的主词汇表文件，如果不存在则自动写入
                if (currentVocabularyPath) {
                    const { fileExists } = await import('./vocabulary/vocabulary-storage');
                    const exists = await fileExists(currentVocabularyPath);
                    if (!exists) {
                        // 自动写入主词汇表到 .vscode 目录
                        await saveVocabulary(context, currentVocabulary, targetLang);
                        console.log(`[CodeLocalizer] 自动写入主词汇表到 .vscode 目录: ${currentVocabularyPath.fsPath}`);
                    }
                }
            } else {
                console.error("[CodeLocalizer] 严重错误: 词汇表加载失败。");
                vscode.window.showErrorMessage("Code Localizer: 无法加载词汇表。请重新安装扩展。");
                return;
            }
        } catch (loadErr) {
            console.error(`[CodeLocalizer] 加载词汇表过程中发生错误: ${loadErr}`);
            vscode.window.showErrorMessage(`Code Localizer: 加载词汇表时出错: ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`);
            return; // 出错时直接返回，避免继续执行
        }
        
        // 确保此时currentVocabulary一定不为null
        if (!currentVocabulary) {
            console.error("[CodeLocalizer] 严重错误: 词汇表仍然为null，无法继续。");
            vscode.window.showErrorMessage("Code Localizer: 词汇表初始化失败，扩展无法正常工作。");
            return;
        }
        
        console.log("[CodeLocalizer] 词汇表加载成功:", JSON.stringify(currentVocabulary.meta));
        
        // 如果加载了词汇表，设置正确的目标语言
        if (currentVocabulary.target_language !== targetLang) {
            console.log(`[CodeLocalizer] 更新词汇表目标语言，从 ${currentVocabulary.target_language} 到 ${targetLang}`);
            currentVocabulary.target_language = targetLang;
        }
        
        // 初始化临时词汇表
        currentTempVocabulary = initTempVocabulary();
        
        // 注册工作区文件夹变更事件处理
        const workspaceFoldersChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(
            (event) => handleWorkspaceFoldersChanged(event, context)
        );
        context.subscriptions.push(workspaceFoldersChangeDisposable);

        // 注册命令
        if (currentVocabulary && currentTempVocabulary && currentVocabularyPath) {
            registerCommands(context, currentVocabulary, currentVocabularyPath, currentTempVocabulary);
            
            // 添加清理装饰缓存的命令
            const clearCacheCommand = vscode.commands.registerCommand('codeLocalizer.clearDecorationCache', () => {
                clearAllDecorations(); // 这会同时清理装饰和缓存
                vscode.window.showInformationMessage('已清理所有装饰缓存');
            });
            context.subscriptions.push(clearCacheCommand);
        }

        // 注册母语显示相关的事件和命令
        registerMotherTongueDisplay(context);
        // 激活时注册视口监听
        if (currentVocabulary) {
            registerVisibleRangeListener(context, currentVocabulary);
        }

        console.log('[CodeLocalizer] 扩展 "code-localizer" 激活完成.');
    } catch (error) {
        console.error(`[CodeLocalizer] 扩展激活过程中发生严重错误:`, error);
        vscode.window.showErrorMessage(`Code Localizer: 扩展激活失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 注册母语显示相关的事件和命令
 */
function registerMotherTongueDisplay(context: vscode.ExtensionContext): void {
    // 防抖刷新函数，只刷新当前激活编辑器，支持刷新锁
    const debouncedRefreshActiveEditor = debounce(() => {
        if (isRefreshing) return; // 如果正在切换母语显示，忽略其它刷新
        const editor = vscode.window.activeTextEditor;
        if (editor && currentVocabulary) {
            void applyMotherTongueDecorations(editor, currentVocabulary);
        }
    }, 300);

    // 编辑器切换时，只刷新当前激活编辑器
    const activeEditorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
        debouncedRefreshActiveEditor();
    });
    context.subscriptions.push(activeEditorChangeDisposable);

    // 编辑器可见性变化时，只刷新当前激活编辑器
    const visibleEditorsChangeDisposable = vscode.window.onDidChangeVisibleTextEditors(() => {
        debouncedRefreshActiveEditor();
    });
    context.subscriptions.push(visibleEditorsChangeDisposable);

    // 文档内容变化时，只刷新当前激活编辑器
    const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
        // 清理文档缓存，因为内容已变化
        clearDocumentCache(event.document.uri.toString());
        
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === event.document.uri.toString()) {
            debouncedRefreshActiveEditor();
        }
    });
    context.subscriptions.push(documentChangeDisposable);

    // 注册配置变化事件
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async event => {
        if (event.affectsConfiguration('codeLocalizer.enableMotherTongueDisplay') ||
            event.affectsConfiguration('codeLocalizer.motherTongueDisplayStyle') ||
            event.affectsConfiguration('codeLocalizer.targetLanguage')) {
            
            // 目标语言改变时，重新加载词汇表
            if (event.affectsConfiguration('codeLocalizer.targetLanguage')) {
                const targetLang = getTargetLanguage();
                console.log(`[CodeLocalizer] 目标语言配置已更改为 ${targetLang}，将重新加载词汇表。`);
                
                // 重新加载词汇表
                const loadResult = await loadVocabulary(context, targetLang);
                if (loadResult) {
                    currentVocabulary = loadResult.vocabulary;
                    currentVocabularyPath = loadResult.path;
                    console.log(`[CodeLocalizer] 词汇表已为 ${targetLang} 重新加载。`);
                } else {
                    vscode.window.showErrorMessage(`Code Localizer: 无法加载 ${targetLang} 的词汇表。`);
                }
            }

            // 刷新所有编辑器
            if (currentVocabulary) {
                const enableDisplay = vscode.workspace.getConfiguration('codeLocalizer').get<boolean>('enableMotherTongueDisplay', true);
                if (enableDisplay) {
                    await refreshAllDecorations(currentVocabulary);
                } else {
                    clearAllDecorations();
                }
            }
        }
    });
    context.subscriptions.push(configChangeDisposable);

    // 注册切换母语显示命令，带刷新锁
    const toggleDisplayDisposable = vscode.commands.registerCommand('codeLocalizer.toggleMotherTongueDisplay', async () => {
        const config = vscode.workspace.getConfiguration('codeLocalizer');
        const currentEnabled = config.get<boolean>('enableMotherTongueDisplay', true);
        try {
            isExtractionEnabled = false;
            isRefreshing = true; // 开启刷新锁，阻止其它刷新
            // 如果临时词汇表被清空过，确保它在母语模式切换时仍然保持为空
            const wasCleared = context.workspaceState.get('tempVocabulary.cleared', false);
            if (wasCleared && currentTempVocabulary) {
                const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });
                outputChannel.appendLine(`[CodeLocalizer DEBUG] 母语显示切换: 发现临时词汇表曾被清空，确保它保持为空`);
                
                // 确保数组为空
                currentTempVocabulary.new_identifiers = [];
            }
            
            // 切换状态
            await config.update('enableMotherTongueDisplay', !currentEnabled, vscode.ConfigurationTarget.Global);
            
            if (!currentEnabled) {
                vscode.window.showInformationMessage('已启用代码母语显示');
                const targetLang = getTargetLanguage();
                const loadResult = await loadVocabulary(context, targetLang);
                if (loadResult) {
                    currentVocabulary = loadResult.vocabulary;
                    currentVocabularyPath = loadResult.path;
                } else {
                    currentVocabulary = null;
                    currentVocabularyPath = null;
                }

                if (currentVocabulary) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        await applyMotherTongueDecorations(editor, currentVocabulary);
                    }
                    registerVisibleRangeListener(context, currentVocabulary);
                }
            } else {
                // 如果从启用到禁用，清除所有装饰
                vscode.window.showInformationMessage('已禁用代码母语显示');
                clearAllDecorations();
            }
        } finally {
            isRefreshing = false; // 释放刷新锁
            setTimeout(() => {
                isExtractionEnabled = true;
                console.log('[CodeLocalizer] 提取功能已恢复。');
            }, 1000); // 添加1秒延迟，确保所有事件都处理完毕
        }
    });
    context.subscriptions.push(toggleDisplayDisposable);

    // 刷新母语显示命令，带刷新锁
    const refreshDisplayDisposable = vscode.commands.registerCommand('codeLocalizer.refreshMotherTongueDisplay', async () => {
        if (currentVocabulary) {
            vscode.window.showInformationMessage('正在刷新代码母语显示...');
            try {
                isExtractionEnabled = false;
                isRefreshing = true;
                const targetLang = getTargetLanguage();
                const loadResult = await loadVocabulary(context, targetLang);
                if (loadResult) {
                    currentVocabulary = loadResult.vocabulary;
                    currentVocabularyPath = loadResult.path;
                } else {
                    currentVocabulary = null;
                    currentVocabularyPath = null;
                }
                // 确保词汇表非空
                if (!currentVocabulary) {
                    vscode.window.showErrorMessage('词汇表加载失败，无法刷新显示');
                    return;
                }
                // 只刷新一次当前激活编辑器
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    await applyMotherTongueDecorations(editor, currentVocabulary);
                }
                registerVisibleRangeListener(context, currentVocabulary);
                vscode.window.showInformationMessage('词汇表已重新加载，显示已刷新');
            } catch (error) {
                console.error('[CodeLocalizer] 刷新显示时出错:', error);
                vscode.window.showErrorMessage(`刷新显示失败: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                isRefreshing = false;
                setTimeout(() => {
                    isExtractionEnabled = true;
                    console.log('[CodeLocalizer] 提取功能已恢复。');
                }, 1000); // 添加1秒延迟，确保所有事件都处理完毕
            }
        }
    });
    context.subscriptions.push(refreshDisplayDisposable);

    // 初始应用装饰到所有可见编辑器
    if (currentVocabulary) {
        vscode.window.visibleTextEditors.forEach(editor => {
            // 使用void操作符忽略Promise
            if (currentVocabulary) {
                void applyMotherTongueDecorations(editor, currentVocabulary);
            }
        });
    }
}

/**
 * 扩展停用函数
 */
export function deactivate() {
    console.log('[CodeLocalizer] 扩展 "code-localizer" 正在停用...');
    
    // 清除所有母语显示装饰
    clearAllDecorations();
    
    // 尝试处理剩余的贡献队列
    try {
        const extensionContext = globalExtensionContext;
        if (extensionContext) {
            console.log('[CodeLocalizer] 尝试在停用前处理贡献队列...');
            if (currentVocabulary && currentTempVocabulary && currentTempVocabulary.new_identifiers.length > 0) {
                const choice = vscode.window.showInformationMessage(
                    'Code Localizer: 是否将本次会话提取到的新词条保存到项目词汇表？',
                    { modal: true },
                    '保存'
                );

                choice.then(selection => {
                    if (selection === '保存' && currentVocabulary && currentVocabularyPath) {
                        saveVocabulary(extensionContext, currentVocabulary);
                    }
                });
            }
            processContributionQueue(extensionContext);
        }
    } catch (error) {
        console.error('[CodeLocalizer] 停用时处理贡献队列出错:', error);
    }
}

/**
 * 处理工作区文件夹变更事件
 * @param event 工作区文件夹变更事件
 * @param context 扩展上下文
 */
async function handleWorkspaceFoldersChanged(
    event: vscode.WorkspaceFoldersChangeEvent, 
    context: vscode.ExtensionContext
): Promise<void> {
    console.log('[CodeLocalizer] 工作区文件夹发生变化，将重新加载词汇表...');

    // 重新加载词汇表
    const targetLang = getTargetLanguage();
    const loadResult = await loadVocabulary(context, targetLang);
    if (loadResult) {
        currentVocabulary = loadResult.vocabulary;
        currentVocabularyPath = loadResult.path;
        currentTempVocabulary = initTempVocabulary();
        console.log('[CodeLocalizer] 词汇表已为新的工作区状态重新加载。');

        // 注意：命令是基于激活时的词汇表实例注册的。
        // 在一个复杂的应用中，你可能需要一个更健壮的机制来更新命令中对词汇表的引用。
        // 对于此项目，重新加载窗口可能是确保所有部分都使用新词汇表的最简单方法。
        console.log('[CodeLocalizer] 注意: 命令注册状态未更新。建议重新加载窗口以使所有功能生效。');
    } else {
        console.error('[CodeLocalizer] 重新加载词汇表失败。');
        vscode.window.showErrorMessage('Code Localizer: 工作区变化后重新加载词汇表失败。');
    }
}

/**
 * 执行文档内容的提取
 * 该函数应该仅在用户显式调用提取命令时使用，不应自动执行
 * @param document 文本文档
 * @param context 扩展上下文
 * @returns 提取的结果
 */
export async function extractDocumentContent(
    document: vscode.TextDocument, 
    context: vscode.ExtensionContext
): Promise<{newIdentifiers: string[]}> {
    if (!isExtractionEnabled) {
        return { newIdentifiers: [] };
    }
    
    if (!currentVocabulary) {
        const loadResult = await loadVocabulary(context);
        if (loadResult) {
            currentVocabulary = loadResult.vocabulary;
            currentVocabularyPath = loadResult.path;
        } else {
            vscode.window.showErrorMessage('无法加载词汇表，提取操作中止。');
            return { newIdentifiers: [] };
        }
    }
    
    const { newIdentifiers } = await collectAndPrepareTranslatableItems(
        document,
        currentVocabulary,
        context
    );

    return { newIdentifiers };
}

/**
 * 更新临时词汇表
 * 将提取的内容添加到临时词汇表中
 * @param newIdentifiers 新标识符数组
 */
export function updateTempVocabulary(newIdentifiers: string[]): void {
    if (currentTempVocabulary) {
        currentTempVocabulary.new_identifiers = newIdentifiers;
    }
}

/**
 * 清除全局词汇表缓存
 * 这个函数目前是空的，需要实现
 */
export function clearGlobalVocabularyCache(): void {
    console.log('[CodeLocalizer] clearGlobalVocabularyCache 已被调用，准备重新加载词汇表...');
    
    (async () => {
        if (!globalExtensionContext) {
            console.error('[CodeLocalizer] 扩展上下文未初始化，无法重新加载词汇表。');
            return;
        }
        try {
            const targetLang = getTargetLanguage();
            console.log(`[CodeLocalizer] 正在为语言 ${targetLang} 重新加载词汇表...`);
            const loadResult = await loadVocabulary(globalExtensionContext, targetLang);
            if (loadResult) {
                currentVocabulary = loadResult.vocabulary;
                currentVocabularyPath = loadResult.path;
                console.log('[CodeLocalizer] 词汇表已成功重新加载。');
                if (currentVocabulary) {
                    refreshAllDecorations(currentVocabulary);
                }
                vscode.window.showInformationMessage('词汇表已更新，界面已刷新。');
            } else {
                console.error('[CodeLocalizer] 重新加载词汇表失败。');
                vscode.window.showErrorMessage('重新加载词汇表失败。');
            }
        } catch (error) {
            console.error('[CodeLocalizer] 重新加载词汇表时出错:', error);
            vscode.window.showErrorMessage(`重新加载词汇表时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    })().catch(error => {
        console.error('[CodeLocalizer] 执行词汇表重新加载时捕获到未处理的错误:', error);
    });
}

export function getGlobalExtensionContext(): vscode.ExtensionContext | null {
    return globalExtensionContext;
} 