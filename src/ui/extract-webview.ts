// 提取结果WebView模块，负责显示提取结果的交互界面
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TempVocabulary, Vocabulary, VocabularyEntryType } from '../types';
import { translateExtractedItems } from '../commands/extract-commands';
import { mergeTranslatedItemsToVocabulary, saveVocabulary } from '../vocabulary/vocabulary-manager';
import { getTargetLanguage } from '../config/config-manager';
import { getLanguageName } from '../translation/translator';
import { escapeHtml } from '../extraction/word-utils';
import { handleModifiedItems } from '../utils/common-utils';

/**
 * 创建并显示提取结果WebView
 * @param context VS Code扩展上下文
 * @param document 当前文档
 * @param vocabulary 词汇表
 * @param tempVocabulary 临时词汇表
 * @param identifiers 提取的标识符（如果为null则使用tempVocabulary中的内容）
 * @returns 创建的WebView面板
 */
export function showExtractResultsWebView(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument | null,
    vocabulary: Vocabulary,
    tempVocabulary: TempVocabulary,
    identifiers: string[] | null = null
): vscode.WebviewPanel {
    // 确定要显示的标识符列表
    const newIdentifiers = identifiers || tempVocabulary.new_identifiers;
    
    // 创建WebView面板
    const panel = vscode.window.createWebviewPanel(
        'extractedItems',
        '已提取的标识符',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    
    // 读取HTML文件内容
    const htmlPath = path.join(context.extensionPath, 'src', 'ui', 'webview.html');
    let htmlContent = '';
    try {
        htmlContent = fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
        console.error('Failed to read webview.html:', error);
        // 如果读取失败，使用简单的备用HTML
        htmlContent = `
            <!DOCTYPE html>
            <html>
            <head><title>错误</title></head>
            <body>
                <h1>无法加载界面</h1>
                <p>请检查 webview.html 文件是否存在。</p>
            </body>
            </html>
        `;
    }
    
    // 在 postMessage 之前，将 escapeHtml 函数注入到 Webview 中
    // 由于 Webview 是一个沙盒环境，需要确保在其中可用的函数被显式地提供
    const injectedScript = `
        <script>
            // 重新定义 escapeHtml 函数，使其在 Webview 上下文中可用
            function escapeHtml(unsafe) {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }
        </script>
    `;
    panel.webview.html = htmlContent.replace('</head>', injectedScript + '</head>');
    
    // 获取目标语言及其名称
    const targetLanguage = getTargetLanguage();
    const targetLanguageName = getLanguageName(targetLanguage);
    
    // 通过postMessage发送初始数据
    panel.webview.postMessage({
        command: 'setIdentifiers',
        identifiers: newIdentifiers,
        targetLanguage,
        targetLanguageName
    });
    
    // 处理WebView消息
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'translate':
                    panel.dispose(); // 关闭当前面板
                    
                    // 处理已修改的内容
                    handleModifiedItems(newIdentifiers, message.modifiedIdentifiers, message.deletedItems);
                    
                    // 如果提供了文档，则执行翻译流程
                    if (document) {
                        await translateExtractedItems(document, context, vocabulary, tempVocabulary, newIdentifiers);
                    } else {
                        vscode.window.showInformationMessage('没有可翻译的文档。请先打开一个文件。');
                    }
                    break;
                case 'close':
                    // 处理已修改的内容
                    handleModifiedItems(newIdentifiers, message.modifiedIdentifiers, message.deletedItems);
                    
                    panel.dispose(); // 关闭面板
                    break;
                case 'closeCurrentWebview': // 新增：处理关闭当前Webview的命令
                    panel.dispose(); // 关闭当前面板
                    break;
                case 'modifyItem':
                    // 单个项目修改时，实时更新数据
                    if (message.type === 'identifier') {
                        const index = newIdentifiers.indexOf(message.original);
                        if (index !== -1) {
                            newIdentifiers[index] = message.new;
                            // 同时更新临时词汇表
                            const tempIndex = tempVocabulary.new_identifiers.indexOf(message.original);
                            if (tempIndex !== -1) {
                                tempVocabulary.new_identifiers[tempIndex] = message.new;
                            }
                        }
                    }
                    break;
                case 'deleteItem':
                    // 单个项目删除时，实时更新数据
                    if (message.type === 'identifier') {
                        const index = newIdentifiers.indexOf(message.value);
                        if (index !== -1) {
                            newIdentifiers.splice(index, 1);
                            // 同时更新临时词汇表
                            const tempIndex = tempVocabulary.new_identifiers.indexOf(message.value);
                            if (tempIndex !== -1) {
                                tempVocabulary.new_identifiers.splice(tempIndex, 1);
                            }
                        }
                    }
                    break;
                case 'batchDeleteItems':
                    // 批量删除项目
                    if (message.items && message.items.length > 0) {
                        message.items.forEach((item: { type: string; value: string }) => {
                            if (item.type === 'identifier') {
                                const index = newIdentifiers.indexOf(item.value);
                                if (index !== -1) {
                                    newIdentifiers.splice(index, 1);
                                    // 同时更新临时词汇表
                                    const tempIndex = tempVocabulary.new_identifiers.indexOf(item.value);
                                    if (tempIndex !== -1) {
                                        tempVocabulary.new_identifiers.splice(tempIndex, 1);
                                    }
                                }
                            }
                        });
                        
                        console.log(`[CodeLocalizer] 批量删除了 ${message.items.length} 个项目`);
                    }
                    break;
                case 'info':
                    vscode.window.showInformationMessage(message.message);
                    break;
                case 'error':
                    vscode.window.showErrorMessage(message.message);
                    break;
                case 'importAiTranslations': // 将 addToTranslationResults 改为 importAiTranslations
                    // AI翻译内容推送到翻译结果页
                    if (message.translations && Array.isArray(message.translations)) { // 将 message.data 改为 message.translations
                        // 打开或聚焦翻译结果WebView，并推送内容
                        showTranslationResultsWebView(
                            context,
                            document,
                            vocabulary,
                            message.translations, // 将 message.data 改为 message.translations
                            tempVocabulary
                        );
                    } else {
                        vscode.window.showErrorMessage('粘贴内容格式错误，无法推送到翻译结果页。');
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
    
    // 新增：监听WebView可见性变化，切换页面时自动刷新数据
    panel.onDidChangeViewState && panel.onDidChangeViewState(() => {
        if (panel.visible) {
            panel.webview.postMessage({
                command: 'setIdentifiers',
                identifiers: newIdentifiers
            });
        }
    });
    
    return panel;
}

/**
 * 创建并显示翻译结果WebView
 * @param context VS Code扩展上下文
 * @param document 当前文档
 * @param vocabulary 词汇表
 * @param translationResults 翻译结果数组，包含原文、译文和类型
 * @param tempVocabulary 临时词汇表，可选
 * @returns 创建的WebView面板
 */
export function showTranslationResultsWebView(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument | null,
    vocabulary: Vocabulary,
    translationResults: Array<{ original: string, translated: string, type: VocabularyEntryType }>,
    tempVocabulary?: TempVocabulary
): vscode.WebviewPanel {
    // 创建WebView面板
    const panel = vscode.window.createWebviewPanel(
        'translationResults',
        '翻译结果',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    // 读取HTML文件内容
    const htmlPath = path.join(context.extensionPath, 'src', 'ui', 'translation-webview.html');
    let htmlContent = '';
    try {
        htmlContent = fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
        console.error('Failed to read translation-webview.html:', error);
        htmlContent = `<html><body><h1>无法加载翻译结果界面</h1></body></html>`;
    }
    panel.webview.html = htmlContent;
    // 通过postMessage发送翻译结果（只发送已翻译内容）
    const filteredResults = translationResults.filter(item => item.original !== item.translated); // 只保留已翻译项
    panel.webview.postMessage({
        command: 'setTranslationResults',
        translationResults: filteredResults
    });
    // 处理WebView消息
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'merge':
                    // 合并修改后的翻译到词汇表
                    if (message.modifiedTranslations) {
                        // 构造合并对象
                        const mergeMap: Record<string, string> = {};
                        Object.entries(message.modifiedTranslations).forEach(([original, translated]) => {
                            mergeMap[original] = translated as string;
                        });
                        console.log('[CodeLocalizer][DEBUG] mergeMap:', JSON.stringify(mergeMap)); // 日志：合并内容
                        console.log('[CodeLocalizer][DEBUG] 合并前 entries:', vocabulary.entries.length, JSON.stringify(vocabulary.entries.slice(-5)));
                        // 只合并 identifier 类型
                        await mergeTranslatedItemsToVocabulary(vocabulary, mergeMap, 'identifier', 'llm');
                        console.log('[CodeLocalizer][DEBUG] 合并后 entries:', vocabulary.entries.length, JSON.stringify(vocabulary.entries.slice(-5)));
                    }
                    // 处理删除项
                    if (message.deletedItems && Array.isArray(message.deletedItems) && message.deletedItems.length > 0) {
                        // 明确转换为 string[]，防止类型错误
                        const deletedArr: string[] = Array.isArray(message.deletedItems)
                            ? (message.deletedItems as any[]).map((item: any) => String(item))
                            : [];
                        vocabulary.entries = vocabulary.entries.filter(entry => !deletedArr.includes(entry.original));
                    }
                    // 保存词汇表
                        await saveVocabulary(context, vocabulary);
                    // 合并后自动清空缓存
                    if (tempVocabulary && tempVocabulary.translated_map) {
                        tempVocabulary.translated_map = {};
                    }
                    vscode.window.showInformationMessage('Code Localizer: 翻译结果已合并到词汇表。');
                    panel.dispose();
                    break;
                case 'close':
                    panel.dispose();
                    break;
                case 'modifyItem':
                    // 单个项目修改时，记录修改
                    break;
                case 'deleteItem':
                    // 单个项目删除时，记录删除
                    break;
                case 'batchDeleteItems':
                    // 批量删除项目
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
    // 监听WebView可见性变化，重新 postMessage 数据
    panel.onDidChangeViewState && panel.onDidChangeViewState(() => {
        if (panel.visible) {
            panel.webview.postMessage({
                command: 'setTranslationResults',
                translationResults: filteredResults
            });
        }
    });
    return panel;
} 