// 提取命令模块，实现提取和翻译工作流
import * as vscode from 'vscode';
import { TempVocabulary, Vocabulary, VocabularyEntryType } from '../types';
import { collectAndPrepareTranslatableItems } from '../extraction/extractor';
import { translateWithLocalLLM } from '../translation/translator';
import { initTempVocabulary, mergeTranslatedItemsToVocabulary, saveVocabulary } from '../vocabulary/vocabulary-manager';
import { showExtractResultsWebView, showTranslationResultsWebView } from '../ui/extract-webview';
import { extractDocumentContent, updateTempVocabulary } from '../extension';
import { escapeHtml } from '../extraction/word-utils';
import { getTargetLanguage } from '../config/config-manager';
import { loadBlacklist, getTermsSet } from '../config/blacklist-manager';
import { handleModifiedItems } from '../utils/common-utils';

/**
 * 提取和翻译工作流
 * @param document 文本文档
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表
 * @param tempVocabulary 临时词汇表
 */
export async function extractAndTranslateWorkflow(
    document: vscode.TextDocument, 
    context: vscode.ExtensionContext,
    vocabulary: Vocabulary,
    tempVocabulary: TempVocabulary
): Promise<void> {
    try {
        // 添加调试日志
        const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });
        outputChannel.appendLine(`[CodeLocalizer DEBUG] extractAndTranslateWorkflow 开始处理文件: ${document.uri.fsPath}`);
        outputChannel.appendLine(`[CodeLocalizer DEBUG] 临时词汇表当前状态: new_identifiers=${tempVocabulary.new_identifiers.length}项`);
        
        console.log(`[CodeLocalizer Debug] 开始提取文件: ${document.uri.fsPath}`);
        const systemEntriesCount = vocabulary.entries.filter(e => e.source === 'system').length; // 计算系统词条数量
        const userEntriesCount = vocabulary.entries.filter(e => e.source === 'user').length; // 计算用户词条数量
        const llmEntriesCount = vocabulary.entries.filter(e => e.source === 'llm').length; // 计算LLM翻译的词条数量
        const otherEntriesCount = vocabulary.entries.filter(e => !e.source || (e.source !== 'system' && e.source !== 'user' && e.source !== 'llm')).length; // 计算其他来源或未定义来源的词条数量
        console.log(`[CodeLocalizer Debug] 词汇表状态: 总条目数 ${vocabulary.entries.length} (系统: ${systemEntriesCount}, 用户: ${userEntriesCount}, LLM: ${llmEntriesCount}, 其他: ${otherEntriesCount})`); // 新的日志，提供更详细的词条来源信息
        
        // 1. 使用新的提取函数提取文件内容
        const { newIdentifiers } = await extractDocumentContent(document, context);
        
        // 输出提取结果的统计信息
        console.log(`[CodeLocalizer Debug] 提取结果: 找到 ${newIdentifiers.length} 个新标识符`);
        outputChannel.appendLine(`[CodeLocalizer DEBUG] 本次从 ${document.uri.fsPath} 提取: ${newIdentifiers.length} 个新标识符`);
        
        if (newIdentifiers.length === 0) {
            vscode.window.showInformationMessage('Code Localizer: 未发现需要翻译的新内容。');
            outputChannel.appendLine(`[CodeLocalizer DEBUG] 未发现需要翻译的新内容，流程结束`);
            return;
        }

        // 2. 记录到临时词汇表 - 使用独立的更新函数
        updateTempVocabulary(newIdentifiers);
        
        // 修改: 使用专门的WebView组件显示提取结果，而不是内嵌生成HTML
        const panel = showExtractResultsWebView(
            context,
            document,
            vocabulary,
            tempVocabulary,
            newIdentifiers
        );
        
        outputChannel.appendLine(`[CodeLocalizer DEBUG] 提取完成，显示结果面板，共 ${newIdentifiers.length} 个标识符`);
    } catch (error) {
        console.error('[CodeLocalizer] 提取和翻译工作流出错:', error);
        vscode.window.showErrorMessage(`Code Localizer: 提取和翻译出错: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 翻译提取的内容
 * @param document 文本文档
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表
 * @param tempVocabulary 临时词汇表
 * @param newIdentifiers 新标识符数组
 */
export async function translateExtractedItems(
    document: vscode.TextDocument,
    context: vscode.ExtensionContext,
    vocabulary: Vocabulary,
    tempVocabulary: TempVocabulary,
    newIdentifiers: string[] = []
): Promise<void> {
    // 定义一个临时的持有翻译结果的地方
    let translatedIdentifiersMap: Record<string, string> = {};
    const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '正在翻译',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: '准备翻译标识符...' });
        
        // 3.1 翻译标识符
        if (newIdentifiers.length > 0) {
            progress.report({ message: `正在翻译 ${newIdentifiers.length} 个标识符...` });
            
            try {
                const targetLang = vocabulary.target_language || 'zh-CN';
                const translationRequest = {
                    items: newIdentifiers,
                    sourceLanguage: 'en',
                    targetLanguage: targetLang,
                    type: 'identifier' as 'identifier',
                    documentUri: document.uri.toString(), // 添加文档URI作为上下文
                    documentLanguage: document.languageId // 添加文档语言作为上下文
                };
                
                const result = await translateWithLocalLLM(translationRequest);
                
                // 将翻译结果保存到临时的map，而不是tempVocabulary的旧结构
                // 确保所有原始标识符在map中都有一个条目，如果翻译引擎没有返回，则用原文填充
                newIdentifiers.forEach(id => {
                    const foundTranslation = result.translations.find(t => t.original === id);
                    if (foundTranslation && typeof foundTranslation.translated === 'string' && foundTranslation.translated.trim() !== '') {
                        translatedIdentifiersMap[id] = foundTranslation.translated;
                    } else {
                        translatedIdentifiersMap[id] = id; // Fallback to original
                    }
                });
                
                progress.report({ message: `已处理 ${newIdentifiers.length} 个标识符的翻译请求` });
                
                // 检查并显示标识符翻译质量信息
                if (result.quality) {
                    outputChannel.appendLine(`[CodeLocalizer DEBUG] 标识符翻译质量: 得分=${result.quality.score.toFixed(2)}, 有效翻译=${result.quality.genuinelyTranslatedCount}/${result.quality.totalCount}`);
                    if (result.quality.issues.length > 0) {
                        outputChannel.appendLine(`[CodeLocalizer DEBUG] 标识符翻译存在 ${result.quality.issues.length} 个问题`);
                    }
                }
            } catch (error) {
                console.error('[CodeLocalizer] 翻译标识符时出错:', error);
                vscode.window.showErrorMessage(`Code Localizer: 翻译标识符失败: ${error instanceof Error ? error.message : String(error)}`);
                // 出错时，用原文填充map
                newIdentifiers.forEach(id => {
                    if (!(id in translatedIdentifiersMap)) {
                        translatedIdentifiersMap[id] = id;
                    }
                });
            }
        }
        
        // 延迟，让用户看到进度
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    // 修正：正确计算真正被翻译的条目数量
    let genuinelyTranslatedIdentifiersCount = 0;
    for (const originalId of newIdentifiers) {
        if (translatedIdentifiersMap[originalId] && translatedIdentifiersMap[originalId] !== originalId) {
            genuinelyTranslatedIdentifiersCount++;
        }
    }
    
    const totalRequestedItems = newIdentifiers.length;
    const totalGenuinelyTranslatedItems = genuinelyTranslatedIdentifiersCount;
    const overallQualityThreshold = 0.3; // 至少30%的条目需要被有效翻译

    if (totalRequestedItems > 0) {
        if (totalGenuinelyTranslatedItems === 0) {
            const msg = vscode.l10n.t("翻译引擎未能有效翻译任何新内容。请检查Ollama的日志和配置。");
            vscode.window.showWarningMessage(msg);
            outputChannel.appendLine(`[CodeLocalizer DEBUG] ${msg} (请求翻译 ${totalRequestedItems} 项，有效翻译0项)`);
        } else if ((totalGenuinelyTranslatedItems / totalRequestedItems) < overallQualityThreshold) {
            const percentage = Math.round((totalGenuinelyTranslatedItems / totalRequestedItems) * 100);
            const msg = vscode.l10n.t(
                "翻译质量较低: 仅 {0} / {1} ({2}%) 个条目被有效翻译。建议检查模型或Prompt。翻译结果将不会被进一步处理。",
                totalGenuinelyTranslatedItems,
                totalRequestedItems,
                percentage
            );
            vscode.window.showWarningMessage(msg);
            
            // 增加质量评估信息的日志记录
            outputChannel.appendLine(`[CodeLocalizer DEBUG] ${msg}`);
            outputChannel.appendLine(`[CodeLocalizer DEBUG] 翻译质量详情:`);
            outputChannel.appendLine(`[CodeLocalizer DEBUG] - 标识符: ${genuinelyTranslatedIdentifiersCount}/${newIdentifiers.length} 有效翻译`);
        }
        
        // 如果质量通过阈值，记录一些成功信息
        const percentage = Math.round((totalGenuinelyTranslatedItems / totalRequestedItems) * 100);
        outputChannel.appendLine(`[CodeLocalizer DEBUG] 翻译质量通过检查: ${totalGenuinelyTranslatedItems}/${totalRequestedItems} (${percentage}%) 项目被有效翻译，超过阈值 ${Math.round(overallQualityThreshold * 100)}%`);
    }
    
    // 显示翻译结果预览
    const previewableResults = [
        ...Object.entries(translatedIdentifiersMap).map(([o, t]) => ({ original: o, translated: t, type: 'identifier' as VocabularyEntryType }))
    ];

    if (previewableResults.length === 0) {
        const msg = vscode.l10n.t("没有新的翻译内容可供预览或合并。可能所有内容都已在词汇表中，或翻译结果与原文相同。");
        vscode.window.showInformationMessage(msg);
        outputChannel.appendLine(`[CodeLocalizer DEBUG] ${msg}`);
        return;
    }

    // 使用新的WebView显示翻译结果
    showTranslationResultsWebView(context, document, vocabulary, previewableResults);
    
    // 不再需要单独显示合并提示，因为合并功能已集成到翻译结果WebView中
    outputChannel.appendLine(`[CodeLocalizer DEBUG] 已显示翻译结果WebView。翻译的标识符数量: ${Object.keys(translatedIdentifiersMap).length}`);

    // 翻译后，把翻译结果写入 tempVocabulary，便于预览
    if (tempVocabulary) {
        tempVocabulary.translated_map = { ...translatedIdentifiersMap };
    }
}

/**
 * 翻译选中的文本
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表
 * @param tempVocabulary 临时词汇表
 */
export async function translateSelected(
    context: vscode.ExtensionContext,
    vocabulary: Vocabulary,
    tempVocabulary: TempVocabulary // 保持 tempVocabulary 用于 new_identifiers
): Promise<void> {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Code Localizer: 没有打开的编辑器。');
            return;
        }
        
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showInformationMessage('Code Localizer: 没有选择文本。');
            return;
        }
        
        // 获取选中的文本
        const selectedText = editor.document.getText(selection);
        const items = selectedText.split(/[\s,;]+/).filter(item => item.length > 0);
        
        if (items.length === 0) {
            vscode.window.showInformationMessage('Code Localizer: 没有有效的标识符。');
            return;
        }
        
        // 翻译标识符
        let translatedSelectedMap: Record<string, string> = {};
        
        // 创建输出通道用于显示详细信息
        const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在翻译选中的标识符',
            cancellable: false
        }, async (progress) => {
            try {
                const targetLang = vocabulary.target_language || 'zh-CN';
                const translationRequest = {
                    items, // items 是选中的文本分割后的数组
                    sourceLanguage: 'en',
                    targetLanguage: targetLang,
                    type: 'identifier' as 'identifier',
                    documentUri: editor.document.uri.toString(), // 添加文档URI作为上下文
                    documentLanguage: editor.document.languageId // 添加文档语言作为上下文
                };
                
                progress.report({ message: `正在翻译 ${items.length} 个标识符...` });
                
                const result = await translateWithLocalLLM(translationRequest);
                
                // 将翻译结果保存到临时的map，确保所有原始条目都有译文
                items.forEach(id => {
                    const foundTranslation = result.translations.find(t => t.original === id);
                    if (foundTranslation && typeof foundTranslation.translated === 'string' && foundTranslation.translated.trim() !== '') {
                        translatedSelectedMap[id] = foundTranslation.translated;
                    } else {
                        translatedSelectedMap[id] = id; // Fallback to original
                    }
                });

                progress.report({ message: `已完成 ${items.length} 个标识符的翻译` });
                
                // 检查并显示翻译质量信息
                if (result.quality) {
                    outputChannel.appendLine(`[CodeLocalizer DEBUG] 选中文本翻译质量: 得分=${result.quality.score.toFixed(2)}, 有效翻译=${result.quality.genuinelyTranslatedCount}/${result.quality.totalCount}`);
                    if (result.quality.issues.length > 0) {
                        outputChannel.appendLine(`[CodeLocalizer DEBUG] 翻译存在 ${result.quality.issues.length} 个问题`);
                        // 可选：记录具体问题
                        result.quality.issues.forEach(issue => {
                            outputChannel.appendLine(`[CodeLocalizer DEBUG] - "${issue.original}" -> "${issue.translated}": ${issue.issue}`);
                        });
                    }
                }

            } catch (error) {
                console.error('[CodeLocalizer] 翻译选中标识符时出错:', error);
                vscode.window.showErrorMessage(`Code Localizer: 翻译选中标识符失败: ${error instanceof Error ? error.message : String(error)}`);
                // 出错时填充原文
                items.forEach(id => {
                    if (!(id in translatedSelectedMap)) {
                        translatedSelectedMap[id] = id;
                    }
                });
            }
        });

        // 计算有效翻译数量
        const genuinelyTranslatedCount = Object.values(translatedSelectedMap)
            .filter((translated, index) => translated !== items[index])
            .length;
            
        // 显示合并选项
        if (Object.keys(translatedSelectedMap).length > 0) {
            // 只在有效翻译数量大于0，或用户确认的情况下合并
            if (genuinelyTranslatedCount > 0) {
                const choice = await vscode.window.showInformationMessage(
                    `翻译完成 ${items.length} 个选定项，其中 ${genuinelyTranslatedCount} 个有效翻译。是否合并到主词汇表？`,
                    { modal: true },
                    '合并', '取消'
                );

                if (choice === '合并') {
                    await mergeTranslatedItemsToVocabulary(vocabulary, translatedSelectedMap, 'identifier', 'llm-selected');
                    await saveVocabulary(context, vocabulary);
                    vscode.window.showInformationMessage('Code Localizer: 选中项的翻译已合并到词汇表。');
                    // 清理 tempVocabulary 中的 new_identifiers (如果这些选中的项也来源于此)
                    tempVocabulary.new_identifiers = tempVocabulary.new_identifiers.filter(id => !items.includes(id));
                }
            } else {
                // 没有有效翻译，显示警告
                vscode.window.showWarningMessage('Code Localizer: 没有从选中项中获得有效翻译，所有译文与原文相同。');
            }
        } else {
            vscode.window.showInformationMessage('Code Localizer: 没有从选中项中获得有效翻译。');
        }

    } catch (error) {
        console.error('[CodeLocalizer] 翻译选中文本时出错:', error);
        vscode.window.showErrorMessage(`Code Localizer: 翻译选中文本失败: ${error instanceof Error ? error.message : String(error)}`);
    }
} 