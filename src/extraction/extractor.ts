// 提取器模块，负责从代码文件中提取标识符
import * as vscode from 'vscode';
import { Vocabulary, ExtractionResult, IdentifierType } from '../types';
import { 
    BlacklistData,
    loadBlacklist,
    getTermsSet,
    getIgnoreSet,
    getMeaningfulShortWordsSet,
    getPythonKeywordsSet,
    getTechSuffixesSet,
    getCommonAbbrSet
} from '../config/blacklist-manager';
import {
  splitCamelCase,
  processUnderscoreIdentifier,
  processCamelCaseIdentifier,
  processCppIdentifier,
  defaultIsLikelyMeaningfulIdentifier,
  isTechnicalValue,
  normalizeWord,
  isPathOrUrl,
  getStem,
  isSameWordRoot,
  validateTranslationMatch,
  findTranslationIgnoreCase,
  handleCompoundIdentifier,
  filterExistingIdentifiers,
  isTechnicalTerm
} from './word-utils';

// 定义一些常见的类型前缀，用于过滤带数字的类型词汇
const TYPE_LIKE_PREFIXES = new Set([
    'uint', 'int', 'float', 'double', 'long', 'short', 'byte', 'char', 'bool',
    'size', 'len', 'vec', 'arr', 'str', 'ptr', 'addr', 'crc', 'offset', 'idx',
    'u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32', 'i64' // 添加更多常见的类型前缀
]);

/**
 * 从文档中收集并准备可翻译项
 * @param document 文本文档
 * @param vocabulary 词汇表
 * @param context VS Code扩展上下文
 */
export async function collectAndPrepareTranslatableItems(
    document: vscode.TextDocument, 
    vocabulary: Vocabulary | null,
    context?: vscode.ExtensionContext
): Promise<ExtractionResult> {
    if (!vocabulary) {
        console.warn("[CodeLocalizer] 词汇表未加载。无法收集项目。");
        vscode.window.showWarningMessage("Code Localizer: 词汇表不可用，无法处理文件。");
        return { newIdentifiers: [] };
    }

    // 如果提供了上下文，从JSON文件加载黑名单
    let blacklist: BlacklistData | null = null;
    if (context) {
        blacklist = await loadBlacklist(context);
    }
    
    const text = document.getText();
    console.log(`[CodeLocalizer] 开始分析文件: ${document.uri.fsPath}, 语言类型: ${document.languageId}, 文件大小: ${text.length}字节`);
    
    // 1. 提取标识符 - 注意extractIdentifiers内部已经有基本的去重(使用Map)
    const { identifiers, statistics, pythonKeywords, meaningfulShortWords } = await extractIdentifiers(text, blacklist, vocabulary);
    console.log(`[CodeLocalizer] 原始标识符匹配: 找到${statistics.totalCount}个匹配，处理后${identifiers.size}个唯一标识符`);
    
    // 2. 过滤和优先级排序
    const prioritizedIdentifiers = await prioritizeIdentifiers(identifiers, pythonKeywords, meaningfulShortWords, blacklist);
    
    // 3. 内部查重 - 使用Set确保数组元素唯一
    const uniqueIdentifiers = Array.from(new Set(prioritizedIdentifiers));
    
    // 记录内部查重结果
    if (uniqueIdentifiers.length < prioritizedIdentifiers.length) {
        console.log(`[CodeLocalizer] 内部查重: 从${prioritizedIdentifiers.length}个标识符中去除了${prioritizedIdentifiers.length - uniqueIdentifiers.length}个重复项`);
    }
    
    // 4. 与词汇表进行查重
    const { newIdentifiers, existingIds } = filterExistingIdentifiers(uniqueIdentifiers, vocabulary);
    
    // 5. 日志记录
    console.log(`[CodeLocalizer] 查重结果: 提取了${uniqueIdentifiers.length}个唯一标识符，其中${existingIds.size}个已存在于词汇表中，新增${newIdentifiers.length}个`);
    
    if (newIdentifiers.length === 0) {
        console.log(`[CodeLocalizer] 未发现新的可翻译项：所有标识符都已在词汇表中`);
    } else {
        if (newIdentifiers.length > 0) {
            console.log("[CodeLocalizer] 部分新标识符示例:", newIdentifiers.slice(0, 5));
        }
    }

    return { newIdentifiers };
}

/**
 * 从文本中提取标识符
 * @param text 源代码文本
 * @param blacklist 黑名单数据
 * @param vocabulary 词汇表 (新增参数)
 */
export async function extractIdentifiers(text: string, blacklist: BlacklistData | null, vocabulary: Vocabulary | null): Promise<{ 
    identifiers: Map<string, IdentifierType>, 
    statistics: { totalCount: number },
    pythonKeywords: Set<string>,
    meaningfulShortWords: Set<string>
}> {
    const identifiersMap = new Map<string, IdentifierType>();
    const identifierRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
    let match;
    let totalCount = 0;
    
    // 从黑名单中获取过滤集合
    const technicalTermsBlacklist = blacklist ? getTermsSet(blacklist) : new Set<string>();
    const ignoreList = blacklist ? getIgnoreSet(blacklist) : new Set<string>();
    const meaningfulShortWords = blacklist ? getMeaningfulShortWordsSet(blacklist) : new Set<string>();
    const pythonKeywords = blacklist ? getPythonKeywordsSet(blacklist) : new Set<string>();
    
    // 添加URL检测，排除URL格式的标识符
    const urlRegex = /(https?:\/\/[^\s"']+)|([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|org|net|edu|gov|io|dev)(\.[a-zA-Z]{2})?)/g;
    let urlMatches: string[] = [];
    let urlMatch;
    
    // 先识别所有URL，将它们存储在数组中
    while ((urlMatch = urlRegex.exec(text)) !== null) {
        urlMatches.push(urlMatch[0]);
    }
    
    // 首先提取所有原始标识符
    while ((match = identifierRegex.exec(text)) !== null) {
        const identifier = match[0];
        console.log(`[CodeLocalizer DEBUG: Extractor] 匹配到原始标识符: '${identifier}'`); // DEBUG: 匹配到的标识符
        totalCount++; // 即使被过滤也要计数

        // 忽略单字母标识符、纯数字标识符或在忽略列表中的标识符
        if (
            identifier.length <= 1 || 
            /^\d+$/.test(identifier) || 
            ignoreList.has(identifier.toLowerCase())
        ) {
            console.log(`[CodeLocalizer DEBUG: Extractor] 跳过: '${identifier}' - 原因: 单字母/纯数字/忽略列表`); // DEBUG: 跳过原因
            continue;
        }
        
        // 跳过技术术语黑名单中的词（不区分大小写）
        if (technicalTermsBlacklist.has(identifier.toLowerCase())) {
            console.log(`[CodeLocalizer DEBUG: Extractor] 跳过: '${identifier}' - 原因: 技术术语黑名单`); // DEBUG: 跳过原因
            continue;
        }
        
        // 检查该标识符是否是URL的一部分，如果是则跳过 (优先级提高)
        let isPartOfUrl = false;
        for (const url of urlMatches) {
            if (url.includes(identifier)) {
                isPartOfUrl = true;
                break;
            }
        }
        if (isPartOfUrl) {
            console.log(`[CodeLocalizer DEBUG: Extractor] 跳过: '${identifier}' - 原因: 是URL的一部分`);
            continue;
        }
        
        // 检测并跳过十六进制颜色代码和其它技术值 (优先级提高)
        if (isTechnicalValue(identifier)) {
            console.log(`[CodeLocalizer DEBUG: Extractor] 跳过: '${identifier}' - 原因: 是技术值/颜色代码`);
            continue;
        }

        // === 新增逻辑: 优先检查词汇表 ===
        // 如果标识符在词汇表中存在，即使被黑名单过滤也应提取
        if (vocabulary && findTranslationIgnoreCase(vocabulary, identifier)) {
            if (!identifiersMap.has(identifier)) { // 避免重复添加
                identifiersMap.set(identifier, 'vocabulary_match'); // 标记为词汇表匹配
                console.log(`[CodeLocalizer DEBUG: Extractor] 优先添加来自词汇表的标识符: '${identifier}'`);
            }
            continue; // 跳过所有后续过滤
        }
        // === 新增逻辑结束 ===

        // 特殊处理Python关键词
        if (pythonKeywords.has(identifier)) {
            // 将Python关键词标记为'original'，确保被提取
            identifiersMap.set(identifier, 'original');
            console.log(`[CodeLocalizer DEBUG: Extractor] 添加Python关键词: '${identifier}'`); // DEBUG: 添加Python关键词
            // totalCount++; // 已在循环开始时计数
            continue; // 不需要进一步拆分Python关键词
        }
        
        // --- 新增逻辑：处理带数字的类型词汇 ---
        const lowerIdentifier = identifier.toLowerCase();
        // 尝试匹配"字母部分+数字部分"或纯数字的部分
        const typeMatch = lowerIdentifier.match(/^([a-z]+)(\d+)$/);
        const numericMatch = lowerIdentifier.match(/^\d+([a-z]+)$/); // 匹配数字开头，字母结尾 (例如: 8bit)
        
        let shouldSkipOriginal = false;
        if (typeMatch && TYPE_LIKE_PREFIXES.has(typeMatch[1])) {
            const prefix = typeMatch[1]; // 提取类型前缀，如 'uint'
            // 如果前缀本身不是技术术语黑名单中的词，则将其添加到标识符映射中
            if (!technicalTermsBlacklist.has(prefix)) {
                identifiersMap.set(prefix, 'original'); // 添加不带数字的前缀
                console.log(`[CodeLocalizer DEBUG: Extractor] 添加类型前缀: '${prefix}' (从 '${identifier}' 提取)`); // DEBUG: 添加类型前缀
            }
            shouldSkipOriginal = true;
        } else if (numericMatch && TYPE_LIKE_PREFIXES.has(numericMatch[1])) {
            const suffix = numericMatch[1]; // 提取类型后缀，如 'bit'
             if (!technicalTermsBlacklist.has(suffix)) {
                identifiersMap.set(suffix, 'original'); // 添加不带数字的前缀
                console.log(`[CodeLocalizer DEBUG: Extractor] 添加类型后缀: '${suffix}' (从 '${identifier}' 提取)`); // DEBUG: 添加类型后缀
            }
            shouldSkipOriginal = true;
        }

        if (shouldSkipOriginal) {
            console.log(`[CodeLocalizer DEBUG: Extractor] 跳过: '${identifier}' - 原因: 包含数字的类型词汇`); // DEBUG: 跳过原因
            continue; // 跳过原始的带数字的标识符（如 'uint8' 或 '8bit'）
        }
        // --- 新增逻辑结束 ---
        
        // 将原始标识符标记为'original'
        identifiersMap.set(identifier, 'original');
        // totalCount++; // 已在循环开始时计数
        console.log(`[CodeLocalizer DEBUG: Extractor] 添加原始标识符: '${identifier}'`); // DEBUG: 添加原始标识符
        
        // 处理下划线分隔的标识符
        if (identifier.includes('_')) {
            processUnderscoreIdentifier(
                identifier,
                identifiersMap,
                ignoreList,
                meaningfulShortWords,
                defaultIsLikelyMeaningfulIdentifier,
                processCppIdentifier,
                processCamelCaseIdentifier
            );
        }
        
        // 处理驼峰命名法标识符
        if (/[a-z][A-Z]/.test(identifier) || /[A-Z]{2,}[a-z]/.test(identifier)) {
            processCamelCaseIdentifier(identifier, identifiersMap, ignoreList);
        }
    }
    
    console.log(`[CodeLocalizer DEBUG: Extractor] 最终提取到的唯一标识符数量: ${identifiersMap.size}`); // DEBUG: 最终数量
    return { identifiers: identifiersMap, statistics: { totalCount }, pythonKeywords, meaningfulShortWords };
}

/**
 * 从标识符映射中优先选择哪些标识符
 * @param identifiersMap 标识符映射
 * @param pythonKeywords Python关键词集合
 * @param meaningfulShortWords 有意义的短词列表
 * @param blacklist 黑名单数据
 */
export async function prioritizeIdentifiers(
    identifiersMap: Map<string, IdentifierType>,
    pythonKeywords: Set<string>,
    meaningfulShortWords: Set<string>,
    blacklist: BlacklistData | null
): Promise<string[]> {
    const finalIdentifiers = new Set<string>();   // 用于存储最终选择的标识符，保留其原始大小写
    
    // 获取黑名单集合
    const technicalTermsBlacklist = blacklist ? getTermsSet(blacklist) : new Set<string>();
    
    // === 新增逻辑: 优先处理词汇表匹配的标识符 ===
    for (const [id, type] of identifiersMap.entries()) {
        if (type === 'vocabulary_match') {
            finalIdentifiers.add(id);
        }
    }
    // === 新增逻辑结束 ===

    // 优先添加Python关键词和特殊方法
    for (const [id, type] of identifiersMap.entries()) {
        // 跳过已由词汇表匹配添加的标识符
        if (type === 'vocabulary_match') {
            continue;
        }
        // 添加Python关键词
        if (pythonKeywords.has(id)) {
            finalIdentifiers.add(id);
        }
        
        // 提取Python特殊方法的核心部分（去掉双下划线）
        if (/^__[a-zA-Z0-9]+__$/.test(id)) {
            const coreName = id.slice(2, -2);
            if (coreName.length > 1 && defaultIsLikelyMeaningfulIdentifier(coreName)) {
                finalIdentifiers.add(coreName);
                // 某些特定的特殊方法，添加原始形式（带双下划线）
                if (id === '__init__' || id === '__str__' || id === '__repr__') {
                    finalIdentifiers.add(id);
                }
            }
        }
    }
    
    // 用于辅助添加标识符的函数
    const techSuffixesSet = blacklist ? getTechSuffixesSet(blacklist) : undefined; // 获取技术后缀集合
    const commonAbbrSet = blacklist ? getCommonAbbrSet(blacklist) : undefined; // 获取常见技术缩写集合
    const tryAddIdentifier = (id: string): boolean => {
        // 跳过技术术语黑名单中的词（不区分大小写）
        if (technicalTermsBlacklist.has(id.toLowerCase())) {
            return false;
        }
        // 新增：用isTechnicalTerm正则兜底过滤技术词（如BL_V2_1等）
        if (isTechnicalTerm(id, technicalTermsBlacklist, techSuffixesSet, commonAbbrSet)) {
            return false; // 命中技术词正则，直接过滤
        }
        // 跳过无效标识符，如单个字母加数字的组合(v2, x1)
        if (/^[a-zA-Z][0-9]+$/.test(id)) {
            return false;
        }
        // 如果标识符长度>=3才考虑添加，除非是有意义的短词列表中的词
        if (id.length >= 3 || meaningfulShortWords.has(id.toLowerCase())) {
            finalIdentifiers.add(id);
            return true;
        }
        return false;
    };

    // 第一阶段：仅处理拆分出的基本单词，这是核心部分
    for (const [id, type] of identifiersMap.entries()) {
        // 跳过已由词汇表匹配添加的标识符
        if (type === 'vocabulary_match') {
            continue;
        }
        if (type === 'split') {
            tryAddIdentifier(id); 
        }
    }
    
    // 第二阶段：处理原始标识符，包括那些无法完全拆分的(如包含数字的标识符)
    for (const [id, type] of identifiersMap.entries()) {
        // 跳过已由词汇表匹配添加的标识符
        if (type === 'vocabulary_match') {
            continue;
        }
        if (type === 'original') {
            // 处理Python dunder方法特例
            if (/^__[a-zA-Z0-9]+__$/.test(id)) {
                // 核心部分应该已在上面的循环中作为'split'类型处理过
                continue;
            }
            
            // 处理包含数字的复合标识符 (如user1, table3Column4, item2Info)
            if (/\d/.test(id)) {
                // 首先检查是否为无意义的版本标记，如v1, v2等
                if (/^[a-zA-Z][0-9]+$/.test(id)) {
                    continue; // 跳过类似v1, v2这样的标识符
                }
                
                // 改进：处理复杂的数字混合标识符
                const parts = splitCamelCase(id);
                let hasAddedAny = false;
                
                for (const part of parts) {
                    // 跳过纯数字部分
                    if (/^\d+$/.test(part)) {
                        continue;
                    }
                    
                    if (tryAddIdentifier(part)) {
                        hasAddedAny = true;
                    }
                }
                
                // 如果没有添加任何部分，或者整体有意义，则添加整体
                if (!hasAddedAny && defaultIsLikelyMeaningfulIdentifier(id) && id.length >= 3) {
                    tryAddIdentifier(id);
                }
                continue;
            }
            
            // 尝试拆分标识符
            const parts = id.includes('_') 
                ? id.split('_').filter(p => p.length > 0) 
                : splitCamelCase(id);
            
            // 只有当标识符无法拆分成有效部分时，才添加原始标识符
            // 例如像"user32"这种无法有效拆分的情况
            if (parts.length <= 1 || parts.every(part => part.length < 3 || !defaultIsLikelyMeaningfulIdentifier(part))) {
                tryAddIdentifier(id);
            }
        }
    }

    // 归一化去重，只保留每组唯一的单词，优先保留第一次出现的原始形式
    const normalizedSet = new Set<string>();
    const uniqueIdentifiers: string[] = [];
    for (const id of finalIdentifiers) {
        const normalized = normalizeWord(id);
        if (!normalizedSet.has(normalized)) {
            normalizedSet.add(normalized);
            uniqueIdentifiers.push(id);
        }
    }
    return uniqueIdentifiers; // 返回去重后的数组
} 