// 词汇表管理器，处理词汇表的加载、保存和合并等核心功能
import * as vscode from 'vscode';
import { Vocabulary, TempVocabulary, VocabularyStorageLocation, ContributionItem, VocabularyEntry, VocabularyEntryType } from '../types';
import { 
    loadVocabularyFromFile, 
    saveVocabularyToFile, 
    getVocabularyPath, 
    fileExists 
} from './vocabulary-storage';
import { queueTranslationContribution } from '../contribution/contribution-manager';
import { getStem, isSameWordRoot } from '../extraction/word-utils';

/**
 * 查找词汇表中的条目，只根据 original 字段匹配，忽略 type
 * @param vocabulary 词汇表对象
 * @param originalText 要查找的原文
 * @param ignoreCase 是否忽略大小写
 * @returns 找到的条目索引，未找到返回-1
 */
export function findVocabularyEntryIndex(
    vocabulary: Vocabulary, 
    originalText: string, 
    ignoreCase: boolean = true
): number {
    if (!vocabulary || !vocabulary.entries || !originalText) {
        return -1;
    }
    
    const containsSpace = originalText.includes(' '); // 判断是否包含空格，视为词组
    
    // 1. 首先尝试精确匹配（区分大小写）
    let entryIndex = vocabulary.entries.findIndex(entry => entry.original === originalText);
    
    // 2. 如果精确匹配失败且允许忽略大小写，则尝试不区分大小写匹配
    if (entryIndex === -1 && ignoreCase) {
        const lowerCaseText = originalText.toLowerCase();
        entryIndex = vocabulary.entries.findIndex(entry => entry.original.toLowerCase() === lowerCaseText);
        if (entryIndex !== -1) {
            console.log(`[CodeLocalizer] 忽略大小写匹配成功: "${originalText}" 匹配到词汇表中的 "${vocabulary.entries[entryIndex].original}"`);
        }
    }
    // 3. 如果仍然没有匹配，且不是词组，尝试简化内容匹配（去除非字母字符）
    if (entryIndex === -1 && ignoreCase && !containsSpace) {
        const simplifiedSearchText = originalText.replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (simplifiedSearchText.length >= 3) {
            entryIndex = vocabulary.entries.findIndex(entry => entry.original.replace(/[^a-zA-Z]/g, '').toLowerCase() === simplifiedSearchText);
            if (entryIndex !== -1) {
                console.log(`[CodeLocalizer] 简化内容匹配成功: "${originalText}" 匹配到词汇表中的 "${vocabulary.entries[entryIndex].original}"`);
            }
        }
    }
    // 4. 最后尝试词根匹配，如果先前的匹配都失败，且不是词组
    if (entryIndex === -1 && ignoreCase && !containsSpace) {
        const stemText = getStem(originalText.toLowerCase());
        if (stemText.length >= 3) {
            entryIndex = vocabulary.entries.findIndex(entry => getStem(entry.original.toLowerCase()) === stemText);
            if (entryIndex !== -1) {
                console.log(`[CodeLocalizer] 词根匹配成功: "${originalText}" (词根:"${stemText}") 匹配到词汇表中的 "${vocabulary.entries[entryIndex].original}" (词根:"${getStem(vocabulary.entries[entryIndex].original.toLowerCase())}")`);
            }
        }
    }
    return entryIndex;
}

/**
 * 创建大小写不敏感的查找映射
 * @param vocabulary 词汇表对象
 * @param itemType 可选，条目类型
 * @returns 小写原文到条目索引的映射
 */
export function createCaseInsensitiveEntryMap(
    vocabulary: Vocabulary,
    itemType?: VocabularyEntryType
): Map<string, number> {
    const lowerCaseEntryMap = new Map<string, number>();
    
    if (!vocabulary || !vocabulary.entries) {
        return lowerCaseEntryMap;
    }
    
    vocabulary.entries.forEach((entry, index) => {
        if (!itemType || entry.type === itemType) {
            const lowerCaseKey = entry.original.toLowerCase();
            lowerCaseEntryMap.set(lowerCaseKey, index);
        }
    });
    
    return lowerCaseEntryMap;
}

/**
 * 初始化临时词汇表
 * @returns 新的临时词汇表
 */
export function initTempVocabulary(): TempVocabulary {
    return {
        new_identifiers: []
    };
}

/**
 * 加载词汇表
 * @param context VS Code扩展上下文
 * @param targetLanguage 目标语言
 */
export async function loadVocabulary(
    context: vscode.ExtensionContext,
    targetLanguage: string = 'zh-CN'
): Promise<{ vocabulary: Vocabulary; path: vscode.Uri | null } | null> {
    const hasWorkspaceFolders = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
    console.log(`[CodeLocalizer] 开始加载词汇表 - 目标语言: ${targetLanguage}, 工作区状态: ${hasWorkspaceFolders ? '有工作区' : '无工作区'}`);

    let finalVocabulary: Vocabulary | null = null;
    let finalPath: vscode.Uri | null = null;

    // 只尝试从项目级别加载目标语言的词汇表
    if (hasWorkspaceFolders) {
        const projectVocabPath = await getVocabularyPath(context, VocabularyStorageLocation.PROJECT, targetLanguage);
        if (projectVocabPath) {
            finalPath = projectVocabPath; // 优先使用项目路径
            console.log(`[CodeLocalizer] 尝试从项目路径加载词汇表: ${projectVocabPath.fsPath}`);
            finalVocabulary = await loadVocabularyFromFile(projectVocabPath);
            if (finalVocabulary) {
                console.log(`[CodeLocalizer] 成功从项目加载 ${targetLanguage} 词汇表。`);
                if (finalVocabulary.target_language !== targetLanguage) {
                    console.warn(`[CodeLocalizer] 项目词汇表 (${projectVocabPath.fsPath}) 的目标语言 (${finalVocabulary.target_language}) 与请求语言 (${targetLanguage}) 不符。`);
                    finalVocabulary.target_language = targetLanguage;
                }
            } else {
                // 如果 .vscode 下没有主表，尝试加载项目根目录下的 loc_core_vocabulary_zh-CN.json
                const vscode = await import('vscode');
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    const workspaceFolder = vscode.workspace.workspaceFolders[0];
                    const rootVocabPath = vscode.Uri.joinPath(workspaceFolder.uri, `loc_core_vocabulary_${targetLanguage}.json`);
                    console.log(`[CodeLocalizer] 尝试从项目根目录加载词汇表: ${rootVocabPath.fsPath}`);
                    finalVocabulary = await loadVocabularyFromFile(rootVocabPath);
                    if (finalVocabulary) {
                        console.log(`[CodeLocalizer] 成功从项目根目录加载 ${targetLanguage} 词汇表。`);
                        // 自动写入到 .vscode 目录
                        await saveVocabularyToFile(projectVocabPath, finalVocabulary);
                        console.log(`[CodeLocalizer] 已将主词汇表写入 .vscode 目录: ${projectVocabPath.fsPath}`);
                    } else {
                        // 如果根目录也没有，再尝试加载插件内置表
                        const path = await import('path');
                        const fs = await import('fs');
                        console.log(`[CodeLocalizer] DEBUG: __dirname in loadVocabulary: ${__dirname}`); // 添加调试日志
                        const coreVocabPath = path.join(__dirname, 'core', `loc_core_vocabulary_${targetLanguage}.json`);
                        if (fs.existsSync(coreVocabPath)) {
                            const raw = fs.readFileSync(coreVocabPath, 'utf-8');
                            const vocabObj = JSON.parse(raw);
                            finalVocabulary = vocabObj;
                            console.log(`[CodeLocalizer] 成功从插件内置目录加载 ${targetLanguage} 词汇表。`);
                            // 自动写入到 .vscode 目录
                            if (finalVocabulary) {
                                await saveVocabularyToFile(projectVocabPath, finalVocabulary);
                                console.log(`[CodeLocalizer] 已将主词汇表写入 .vscode 目录: ${projectVocabPath.fsPath}`);
                            }
                        }
                    }
                }
            }
        }
    }

    if (!finalVocabulary) {
        console.error(`[CodeLocalizer] 未能从项目加载 ${targetLanguage} 词汇表，且未找到根目录主表。`);
        return null;
    }

    return { vocabulary: finalVocabulary, path: finalPath };
}

/**
 * 合并词汇表
 * @param target 主词汇表 (以此为基础)
 * @param source 要合并的源词汇表
 * @param expectedTargetLanguage 期望的目标语言
 * @param mergeAsSeed 是否作为种子数据合并（只合并系统词条）
 * @returns 合并后的词汇表
 */
function mergeVocabularies(
    target: Vocabulary,
    source: Vocabulary | null,
    expectedTargetLanguage: string,
    mergeAsSeed: boolean = false
): Vocabulary {
    if (!source || source.target_language !== expectedTargetLanguage) {
        if (source) {
            console.warn(`[CodeLocalizer] 源词汇表语言 (${source.target_language}) 与期望语言 (${expectedTargetLanguage}) 不符，跳过合并。`);
        }
        return target;
    }

    // 初始化目标词汇表的entries（如果不存在）
    if (!target.entries) {
        target.entries = [];
    }

    const targetOriginals = new Set(target.entries.map(e => e.original.toLowerCase()));
    let mergedCount = 0;

    for (const sourceEntry of source.entries) {
        // 如果作为种子合并，则只合并 'system' 来源的
        if (mergeAsSeed && sourceEntry.source !== 'system') {
            continue;
        }
        
        // 只有当目标词汇表中不存在该词条时才添加
        if (!targetOriginals.has(sourceEntry.original.toLowerCase())) {
            target.entries.push(sourceEntry);
            targetOriginals.add(sourceEntry.original.toLowerCase());
            mergedCount++;
        }
    }

    if (mergedCount > 0) {
        console.log(`[CodeLocalizer] 成功合并 ${mergedCount} 个词条到目标词汇表。`);
    }

    return target;
}

/**
 * 保存词汇表到所有位置
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表对象
 * @param language 目标语言
 */
export async function saveVocabulary(
    context: vscode.ExtensionContext, 
    vocabulary: Vocabulary, 
    language?: string // language 参数可选，优先使用 vocabulary.target_language
): Promise<void> {
    const targetLanguage = language || vocabulary.target_language;
    if (!targetLanguage) {
        console.error("[CodeLocalizer] 保存词汇表失败：目标语言未知。");
        return;
    }

    const location = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) 
        ? VocabularyStorageLocation.PROJECT 
        : VocabularyStorageLocation.GLOBAL;

    const filePath = await getVocabularyPath(context, location, targetLanguage);

    if (filePath) {
        const vocabularyToSave: Partial<Vocabulary> = {
            target_language: vocabulary.target_language,
            meta: vocabulary.meta,
            entries: vocabulary.entries
        };
        // 不应包含 system_vocabulary, user_defined_identifiers, user_defined_comments 等废弃字段

        await saveVocabularyToFile(filePath, vocabularyToSave as Vocabulary); // 类型断言
        console.log(`[CodeLocalizer] 词汇表已保存到 ${filePath}`);
    } else {
        console.error(`[CodeLocalizer] 无法获取词汇表保存路径，位置: ${location}, 语言: ${targetLanguage}`);
    }
}

/**
 * 清除词汇表
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表对象
 */
export async function clearVocabulary(context: vscode.ExtensionContext, vocabulary: Vocabulary): Promise<void> {
    // 清空 entries 数组
    vocabulary.entries = [];
    
    await saveVocabulary(context, vocabulary, vocabulary.target_language);
    vscode.window.showInformationMessage('Code Localizer: 词汇表已清除 (Entries 已重置为系统默认)。');
}

/**
 * 合并临时词汇表到主词汇表
 * @param context VS Code扩展上下文
 * @param vocabulary 主词汇表
 * @param tempVocabulary 临时词汇表
 */
export async function mergeTranslatedItemsToVocabulary(
    vocabulary: Vocabulary, 
    translatedItems: Record<string, string>, 
    itemType: VocabularyEntryType,
    source: string = 'llm' // 默认来源为llm
): Promise<void> {
    if (!vocabulary || !translatedItems) {
        console.error("[CodeLocalizer] 合并翻译失败：词汇表或翻译项为空。");
        return;
    }

    let mergedCount = 0;
    let newCount = 0;

    for (const originalText in translatedItems) {
        // eslint-disable-next-line no-prototype-builtins
        if (translatedItems.hasOwnProperty(originalText)) {
            const translatedTextValue = translatedItems[originalText];
            if (!translatedTextValue || translatedTextValue.trim() === '') { // 跳过空翻译
                console.warn(`[CodeLocalizer] 跳过原文 "${originalText}" 的空翻译。`);
                continue;
            }

            // 使用改进后的辅助函数查找匹配的条目 - 支持大小写不敏感、简化内容和词根匹配
            const matchedIndex = findVocabularyEntryIndex(vocabulary, originalText, true);

            if (matchedIndex !== -1) {
                // 条目已存在，更新翻译和来源
                const existingEntry = vocabulary.entries[matchedIndex];
                
                // 记录匹配的类型，如果不是完全匹配
                if (existingEntry.original !== originalText) {
                    console.log(`[CodeLocalizer] 合并翻译时发现不同形式的相同单词: "${originalText}" 匹配到 "${existingEntry.original}"`);
                }
                
                if (existingEntry.translated !== translatedTextValue) {
                    existingEntry.translated = translatedTextValue;
                    existingEntry.source = source; // 更新来源
                    mergedCount++;
                }
            } else {
                // 条目不存在，添加新条目
                vocabulary.entries.push({
                    original: originalText,
                    translated: translatedTextValue,
                    type: itemType,
                    source: source
                });
                newCount++;
            }
        }
    }
    if (mergedCount > 0 || newCount > 0) {
        console.log(`[CodeLocalizer] 翻译合并完成：更新 ${mergedCount} 条，新增 ${newCount} 条。总 entries: ${vocabulary.entries.length}`);
    }
}

/**
 * 从词汇表中获取翻译 (核心查询逻辑)
 * @param vocabulary 词汇表对象
 * @param originalText 待翻译的原文
 * @param itemType 可选，词条类型，用于更精确匹配
 * @returns 翻译后的文本，如果未找到则返回 undefined
 */
export function getTranslation(
    vocabulary: Vocabulary, 
    originalText: string, 
    itemType?: VocabularyEntryType
): string | undefined {
    if (!vocabulary || !vocabulary.entries) {
        return undefined;
    }

    // 使用改进后的辅助函数查找条目 - 它会尝试多种匹配策略，包括大小写不敏感、简化内容和词根匹配
    const matchedIndex = findVocabularyEntryIndex(vocabulary, originalText, true);
    
    if (matchedIndex !== -1) {
        // 找到匹配的翻译
        const translation = vocabulary.entries[matchedIndex].translated;
        
        // 非完全匹配的情况，记录一下用于调试
        if (vocabulary.entries[matchedIndex].original !== originalText) {
            console.log(`[CodeLocalizer] 获取翻译: 使用"${vocabulary.entries[matchedIndex].original}"的翻译"${translation}"用于"${originalText}"`);
        }
        
        return translation;
    }
    
    return undefined;
}

/**
 * 向词汇表添加或更新单个翻译条目
 * @param vocabulary 词汇表对象
 * @param entry 要添加或更新的词汇条目
 */
export function addOrUpdateTranslation(
    vocabulary: Vocabulary,
    entry: VocabularyEntry
): void {
    if (!vocabulary || !entry || !entry.original) {
        console.error("[CodeLocalizer] 添加或更新翻译失败：参数无效。");
        return;
    }
    if (!entry.source) { // 确保有source
        entry.source = 'user'; // 默认为用户添加
    }
    if (!entry.type) { // 确保有type
        // 尝试根据内容猜测，或默认为 identifier
        entry.type = entry.original.startsWith('//') || entry.original.startsWith('/*') ? 'comment' : 'identifier';
    }

    // 使用改进后的辅助函数查找条目
    const existingEntryIndex = findVocabularyEntryIndex(vocabulary, entry.original, true);

    if (existingEntryIndex !== -1) {
        // 更新现有条目
        const existingEntry = vocabulary.entries[existingEntryIndex];
        
        // 检查是否匹配不同形式的相同单词
        if (existingEntry.original !== entry.original) {
            console.log(`[CodeLocalizer] 检测到不同形式的相同单词: "${entry.original}" 匹配到 "${existingEntry.original}"`);
            
            // 可选：保留更规范的形式（如果需要）
            // 这里可以添加保留哪种形式的逻辑，例如首字母大写的版本或最短版本
        }
        
        // 更新翻译和来源
        existingEntry.translated = entry.translated;
        existingEntry.source = entry.source;
        console.log(`[CodeLocalizer] 更新词条: "${existingEntry.original}" -> "${entry.translated}" (source: ${entry.source})`);
    } else {
        // 添加新条目
        vocabulary.entries.push(entry);
        console.log(`[CodeLocalizer] 添加新词条: "${entry.original}" -> "${entry.translated}" (source: ${entry.source})`);
    }
} 