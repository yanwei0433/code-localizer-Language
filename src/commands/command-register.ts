// 命令注册模块，用于注册所有扩展命令
import * as vscode from 'vscode';
import { Vocabulary, TempVocabulary } from '../types';
import { clearVocabulary, loadVocabulary, saveVocabulary, mergeTranslatedItemsToVocabulary } from '../vocabulary/vocabulary-manager';
import { configLocalLLM, setTargetLanguage, getTargetLanguage } from '../config/config-manager';
import { extractAndTranslateWorkflow, translateSelected } from './extract-commands';
import { showContributionStats } from '../contribution/contribution-manager';
import { showExtractResultsWebView, showTranslationResultsWebView } from '../ui/extract-webview';
import { VocabularyOrganizerManager } from '../ui/vocabulary-organizer';
import { 
    addTermToCustomBlacklist, 
    removeTermFromCustomBlacklist,
    loadBlacklist, 
    openBlacklistForEditing 
} from '../config/blacklist-manager';

/**
 * 注册所有命令
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表
 * @param vocabularyPath 当前词汇表的文件路径
 * @param tempVocabulary 临时词汇表
 */
export function registerCommands(
    context: vscode.ExtensionContext, 
    vocabulary: Vocabulary, 
    vocabularyPath: vscode.Uri,
    tempVocabulary: TempVocabulary
): void {
    // 词汇表整理命令
    const organizeVocabularyCommand = vscode.commands.registerCommand('codeLocalizer.organizeVocabulary', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.organizeVocabulary' command invoked.");
            
            // 每次执行命令时都重新加载词汇表，确保获取最新数据
            const targetLang = getTargetLanguage();
            const loadResult = await loadVocabulary(context, targetLang);

            if (loadResult && loadResult.vocabulary && loadResult.path) {
                const organizer = new VocabularyOrganizerManager(context, loadResult.path);
                await organizer.openVocabularyOrganizer(loadResult.vocabulary);
            } else {
                vscode.window.showErrorMessage('Code Localizer: 无法加载词汇表以进行整理。');
            }
        } catch (error) {
            console.error(`[CodeLocalizer] Error in organizeVocabulary command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 打开词汇表整理工具失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 提取当前文件命令
    const extractCurrentFileCommand = vscode.commands.registerCommand('codeLocalizer.extractCurrentFile', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.extractCurrentFile' command invoked.");
            
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showInformationMessage('Code Localizer: 没有打开的文件，请先打开文件。');
                console.log("[CodeLocalizer] No active editor for extract command.");
                return;
            }

            // 修改：直接执行提取操作，不再询问用户
            console.log("[CodeLocalizer] 开始提取文件: " + activeEditor.document.uri.fsPath);
            
            // 使用新的提取和翻译工作流
            await extractAndTranslateWorkflow(activeEditor.document, context, vocabulary, tempVocabulary);
        } catch (error) {
            console.error(`[CodeLocalizer] Error in extractCurrentFile command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 提取过程中出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 测试提取器命令
    const testCollectorCommand = vscode.commands.registerCommand('codeLocalizer.testCollector', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.testCollector' command invoked.");
            
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showInformationMessage('Code Localizer: 没有打开的编辑器。');
                return;
            }

            // 使用提取工作流，但不翻译，仅显示结果
            await extractAndTranslateWorkflow(activeEditor.document, context, vocabulary, tempVocabulary);
        } catch (error) {
            console.error(`[CodeLocalizer] Error in testCollector command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 测试提取器失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 显示目标语言命令
    const showTargetLanguageCommand = vscode.commands.registerCommand('codeLocalizer.showTargetLanguage', () => {
        try {
            const lang = vocabulary.target_language;
            vscode.window.showInformationMessage(`Code Localizer: 当前目标语言: ${lang}`);
            vscode.window.showInformationMessage(`Code Localizer: 词汇表名称: ${vocabulary.meta.name}`);
        } catch (error) {
            console.error(`[CodeLocalizer] Error in showTargetLanguage command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 显示目标语言失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    
    // 设置目标语言命令
    const setTargetLanguageCommand = vscode.commands.registerCommand('codeLocalizer.setTargetLanguage', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.setTargetLanguage' command invoked.");
            
            // 显示语言选择菜单
            const newLanguage = await setTargetLanguage();
            
            if (!newLanguage) {
                return; // 用户取消
            }
            
            // 重新加载词汇表
            const loadResult = await loadVocabulary(context, newLanguage);
            
            if (loadResult) {
                // 更新当前词汇表
                Object.assign(vocabulary, loadResult.vocabulary);
                // 注意：这里可能需要更新全局的 vocabularyPath 变量
                vscode.window.showInformationMessage(`Code Localizer: 已切换到${newLanguage}词汇表`);
            } else {
                vscode.window.showWarningMessage(`Code Localizer: 无法加载${newLanguage}词汇表，请检查配置`);
            }
        } catch (error) {
            console.error(`[CodeLocalizer] Error in setTargetLanguage command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 设置目标语言失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 清除词汇表命令
    const clearVocabularyCommand = vscode.commands.registerCommand('codeLocalizer.clearVocabulary', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.clearVocabulary' command invoked.");
            
            // 显示确认对话框
            const confirmClear = await vscode.window.showWarningMessage(
                '您确定要清除词汇表吗？这将删除所有用户自定义的标识符和注释翻译。',
                { modal: true },
                '清除', '取消'
            );
            
            if (confirmClear !== '清除') {
                return;
            }
            
            await clearVocabulary(context, vocabulary);
        } catch (error) {
            console.error(`[CodeLocalizer] Error in clearVocabulary command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 清除词汇表时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 配置本地LLM命令
    const configLocalLLMCommand = vscode.commands.registerCommand('codeLocalizer.configLocalLLM', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.configLocalLLM' command invoked.");
            await configLocalLLM();
        } catch (error) {
            console.error(`[CodeLocalizer] Error in configLocalLLM command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 配置LLM失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 翻译选中文本命令
    const translateSelectedCommand = vscode.commands.registerCommand('codeLocalizer.translateSelected', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.translateSelected' command invoked.");
            await translateSelected(context, vocabulary, tempVocabulary);
        } catch (error) {
            console.error(`[CodeLocalizer] Error in translateSelected command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 翻译选中文本失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 显示翻译贡献统计命令
    const showContributionStatsCommand = vscode.commands.registerCommand('codeLocalizer.showContributionStats', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.showContributionStats' command invoked.");
            await showContributionStats(context);
        } catch (error) {
            console.error(`[CodeLocalizer] Error in showContributionStats command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 显示贡献统计失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 显示已提取内容命令
    const showExtractedItemsCommand = vscode.commands.registerCommand('codeLocalizer.showExtractedItems', () => {
        try {
            const commandInvokeMsg = "[CodeLocalizer] 'codeLocalizer.showExtractedItems' command invoked.";
            console.log(commandInvokeMsg); // 保留这个控制台日志用于开发者调试

            // 获取或创建输出通道
            const outputChannel = vscode.window.createOutputChannel("Code Localizer Log");
            outputChannel.appendLine(commandInvokeMsg); // 也在输出通道显示调用信息
            outputChannel.show(true); // 显示输出通道，但不抢占焦点

            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                outputChannel.appendLine(`[CodeLocalizer Log] Displaying extracted items from tempVocabulary. Active file when viewing: ${activeEditor.document.uri.fsPath}`);
                outputChannel.appendLine(`[CodeLocalizer Log] Note: tempVocabulary may contain items from this active file, from the last file processed by an 'Extract...' command, or an accumulation if multiple files were opened/processed without clearing.`);
            } else {
                outputChannel.appendLine(`[CodeLocalizer Log] Displaying extracted items from tempVocabulary. No active file editor when viewing.`);
            }
            outputChannel.appendLine(`[CodeLocalizer Log] tempVocabulary.new_identifiers (${tempVocabulary.new_identifiers.length} items): ${JSON.stringify(tempVocabulary.new_identifiers.slice(0, 20))}`); // 日志中最多显示前20个以避免过长

            const identifiersCount = tempVocabulary.new_identifiers.length;
            
            if (identifiersCount === 0) {
                vscode.window.showInformationMessage('Code Localizer: 当前没有提取的标识符。');
                return;
            }
            
            // 使用新的WebView组件显示结果
            showExtractResultsWebView(
                context,
                activeEditor ? activeEditor.document : null,
                vocabulary,
                tempVocabulary
            );
        } catch (error) {
            console.error(`[CodeLocalizer] Error in showExtractedItems command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 显示提取内容失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 清除临时词汇表命令
    const clearTempVocabularyCommand = vscode.commands.registerCommand('codeLocalizer.clearTempVocabulary', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.clearTempVocabulary' command invoked.");
            
            // 创建日志输出通道
            const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });
            outputChannel.appendLine(`[CodeLocalizer DEBUG] 清除临时词汇表命令被调用，当前状态: new_identifiers=${tempVocabulary.new_identifiers.length}项`);
            
            const choice = await vscode.window.showInformationMessage(
                '确认清除所有缓存？',
                { modal: true },
                '确认清除', '取消'
            );

            if (choice === '确认清除') {
                // 同时清空提取和翻译缓存
                tempVocabulary.new_identifiers = [];
                tempVocabulary.translated_map = {};
                outputChannel.appendLine(`[CodeLocalizer DEBUG] 临时缓存已清空。`);
                vscode.window.showInformationMessage('Code Localizer: 临时缓存已清除。');
            } else {
                outputChannel.appendLine(`[CodeLocalizer DEBUG] 用户取消了清除操作`);
                vscode.window.showInformationMessage('Code Localizer: 清除操作已取消。');
            }
        } catch (error) {
            console.error(`[CodeLocalizer] Error in clearTempVocabulary command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 清除临时词汇表时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 显示翻译预览命令
    const showTranslationPreviewCommand = vscode.commands.registerCommand('codeLocalizer.showTranslationPreview', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.showTranslationPreview' command invoked.");
            
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showInformationMessage('Code Localizer: 没有打开的编辑器。');
                return;
            }
            
            // 获取或创建输出通道
            const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });
            outputChannel.appendLine(`[CodeLocalizer DEBUG] 显示翻译预览命令被调用，当前文件: ${activeEditor.document.uri.fsPath}`);
            
            // 从临时词汇表中获取已提取的标识符
            const identifiersCount = tempVocabulary.new_identifiers.length;
            
            if (identifiersCount === 0) {
                vscode.window.showInformationMessage('Code Localizer: 当前没有提取的标识符。请先提取需要翻译的内容。');
                return;
            }
            
            // 从词汇表中查找已有的翻译（优先用 tempVocabulary.translated_map）
            const previewData = tempVocabulary.new_identifiers.map(original => {
                let translated = original;
                if (tempVocabulary.translated_map && tempVocabulary.translated_map[original]) {
                    translated = tempVocabulary.translated_map[original];
                } else {
                    // 在词汇表中查找这个标识符的翻译
                    const entry = vocabulary.entries.find(entry => 
                        entry.type === 'identifier' && 
                        (entry.original === original || entry.original === original.toLowerCase())
                    );
                    if (entry) translated = entry.translated;
                }
                return {
                    original,
                    translated,
                    type: 'identifier' as const
                };
            });
            
            // 使用新的WebView组件显示翻译结果
            showTranslationResultsWebView(
                context,
                activeEditor.document,
                vocabulary,
                previewData,
                tempVocabulary
            );
            
            // 计算已翻译的项目数量
            const translatedCount = previewData.filter(item => item.translated !== item.original).length;
            
            outputChannel.appendLine(`[CodeLocalizer DEBUG] 已显示翻译预览面板，共 ${previewData.length} 个标识符，其中 ${translatedCount} 个有翻译。`);
        } catch (error) {
            console.error(`[CodeLocalizer] Error in showTranslationPreview command:`, error);
            vscode.window.showErrorMessage(`Code Localizer: 显示翻译预览失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 管理技术术语黑名单命令
    const manageBlacklistCommand = vscode.commands.registerCommand('codeLocalizer.manageBlacklist', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.manageBlacklist' command invoked.");
            
            // 显示管理选项
            const options = [
                "打开黑名单文件进行编辑",
                "添加新术语到黑名单",
                "从黑名单移除术语"
            ];
            
            const selectedOption = await vscode.window.showQuickPick(options, {
                placeHolder: "请选择黑名单管理操作"
            });
            
            if (!selectedOption) {
                return;
            }
            
            switch (selectedOption) {
                case "打开黑名单文件进行编辑":
                    // 打开黑名单文件
                    await openBlacklistForEditing(context);
                    break;
                
                case "添加新术语到黑名单":
                    const newTerm = await vscode.window.showInputBox({
                        placeHolder: "输入要添加到黑名单的技术术语",
                        prompt: "术语将不会被提取和翻译"
                    });
                    
                    if (newTerm && newTerm.trim()) {
                        await addTermToCustomBlacklist(context, newTerm.trim().toLowerCase());
                        vscode.window.showInformationMessage(`已添加 "${newTerm.trim()}" 到黑名单`);
                    }
                    break;
                
                case "从黑名单移除术语":
                    // 加载黑名单
                    const blacklist = await loadBlacklist(context);
                    
                    if (blacklist.customBlacklist.length === 0) {
                        vscode.window.showInformationMessage("当前用户自定义黑名单为空，没有术语可以移除");
                        return;
                    }
                    
                    const termToRemove = await vscode.window.showQuickPick(blacklist.customBlacklist.sort(), {
                        placeHolder: "选择要从黑名单中移除的术语"
                    });
                    
                    if (termToRemove) {
                        await removeTermFromCustomBlacklist(context, termToRemove);
                        vscode.window.showInformationMessage(`已从黑名单中移除 "${termToRemove}"`);
                    }
                    break;
            }
        } catch (error) {
            console.error("[CodeLocalizer] 管理黑名单出错:", error);
            vscode.window.showErrorMessage(`管理黑名单时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    
    // 添加当前选中的标识符到黑名单命令
    const addToBlacklistCommand = vscode.commands.registerCommand('codeLocalizer.addToBlacklist', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.addToBlacklist' command invoked.");
            
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage("没有打开的编辑器");
                return;
            }
            
            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showInformationMessage("请先选择要添加到黑名单的标识符");
                return;
            }
            
            // 获取选中的文本
            const selectedText = editor.document.getText(selection);
            
            // 验证选中文本格式（只允许字母、数字、下划线等有效标识符字符）
            if (!/^[a-zA-Z0-9_]+$/.test(selectedText)) {
                vscode.window.showWarningMessage("选中的文本不是有效的标识符，只能包含字母、数字和下划线");
                return;
            }
            
            // 确认添加
            const confirmation = await vscode.window.showInformationMessage(
                `确定要将 "${selectedText}" 添加到黑名单吗？添加后将不会被提取和翻译。`,
                "确定",
                "取消"
            );
            
            if (confirmation === "确定") {
                await addTermToCustomBlacklist(context, selectedText.toLowerCase());
                vscode.window.showInformationMessage(`已将 "${selectedText}" 添加到黑名单`);
            }
        } catch (error) {
            console.error("[CodeLocalizer] 添加到黑名单出错:", error);
            vscode.window.showErrorMessage(`添加到黑名单时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 在 settings.json 中编辑自定义黑名单命令
    const editBlacklistInSettingsCommand = vscode.commands.registerCommand('codeLocalizer.editBlacklistInSettings', async () => {
        try {
            console.log("[CodeLocalizer] 'codeLocalizer.editBlacklistInSettings' command invoked.");
            
            // 直接调用 openBlacklistForEditing 函数打开黑名单文件
            await openBlacklistForEditing(context);
        } catch (error) {
            console.error("[CodeLocalizer] 编辑黑名单文件出错:", error);
            vscode.window.showErrorMessage(`编辑黑名单文件时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // 添加所有命令到上下文订阅
    context.subscriptions.push(
        organizeVocabularyCommand,
        extractCurrentFileCommand,
        testCollectorCommand,
        showTargetLanguageCommand,
        setTargetLanguageCommand,
        clearVocabularyCommand,
        configLocalLLMCommand,
        translateSelectedCommand,
        showContributionStatsCommand,
        showExtractedItemsCommand,
        clearTempVocabularyCommand,
        showTranslationPreviewCommand,
        manageBlacklistCommand,
        addToBlacklistCommand,
        editBlacklistInSettingsCommand
    );

    // 记录命令注册成功
    console.log('[CodeLocalizer] All commands registered successfully.');
} 