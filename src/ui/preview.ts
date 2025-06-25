// 预览UI模块，处理翻译结果预览和显示
import * as vscode from 'vscode';
import { TempVocabulary, VocabularyEntry, VocabularyEntryType } from '../types';

/**
 * 显示翻译预览
 * @param previewItems 包含待预览翻译条目的数组，每个条目包含 original, translated, 和 type
 */
export async function showTranslationPreview(
    previewItems: Array<{ original: string, translated: string, type: VocabularyEntryType }> | null
): Promise<void> {
    if (!previewItems || previewItems.length === 0) {
        vscode.window.showErrorMessage('Code Localizer: 没有可用的翻译结果进行预览。');
        return;
    }
    
    // 创建输出通道用于显示翻译结果
    const outputChannel = vscode.window.createOutputChannel("Code Localizer 翻译预览");
    outputChannel.clear();
    
    const identifiersToPreview = previewItems.filter(item => item.type === 'identifier');

    outputChannel.appendLine("=== 标识符翻译结果预览 ===");
    outputChannel.appendLine("");
    
    if (identifiersToPreview.length > 0) {
        outputChannel.appendLine(`共 ${identifiersToPreview.length} 个标识符:`);
        identifiersToPreview.forEach(item => {
            outputChannel.appendLine(`· ${item.original} => ${item.translated}`);
        });
    } else {
        outputChannel.appendLine("无标识符翻译。");
    }
    
    outputChannel.appendLine("\n提示: 如要修改翻译，请在确认后编辑词汇表文件。");
    outputChannel.show();
}

/**
 * 显示详细统计结果
 * @param document 文本文档
 * @param existingIds 已存在的标识符
 * @param targetLang 目标语言
 */
export function showDetailedStats(
    document: vscode.TextDocument, 
    existingIds: Set<string>, 
    targetLang: string
): void {
    // 创建输出通道
    const outputChannel = vscode.window.createOutputChannel("Code Localizer");
    
    // 提取所有标识符
    const allIdentifiers = Array.from(new Set<string>(
        (document.getText().match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [])
    ));
    
    // 构建消息
    const message = `未找到新的标识符需要翻译。\n
文件信息: ${document.uri.fsPath.split('/').pop()}
语言类型: ${document.languageId}
文件总行数: ${document.lineCount}
检测到的标识符总数: ${allIdentifiers.length}`;
    
    // 输出到通道
    outputChannel.appendLine(message);
    outputChannel.appendLine("\n已在词汇表中的部分标识符:");
    
    // 显示部分已存在的标识符示例
    const sampleExistingIds = Array.from(existingIds).slice(0, 10);
    
    if (sampleExistingIds.length > 0) {
        sampleExistingIds.forEach(id => {
            outputChannel.appendLine(`- ${id} => [已翻译]`);
        });
    } else {
        outputChannel.appendLine("(无标识符在词汇表中)");
    }
    
    outputChannel.appendLine("\n提示: 如需查看完整日志，请打开「开发者工具」。");
    outputChannel.show();
} 