// 通用单词/标识符处理工具
// 统一提供分词、归一化、技术词判断、路径判断、词根、翻译校验等方法
// 供提取、装饰、翻译等各环节复用

import { findVocabularyEntryIndex } from '../vocabulary/vocabulary-manager';

/**
 * 驼峰命名法拆分为单词数组
 * 例如：userName -> ["user", "Name"]
 * 兼容连续大写、数字、下划线等多种情况
 */
export function splitCamelCase(identifier: string): string[] {
    if (!identifier) return [];
    let result = identifier.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
    result = result.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    result = result.replace(/([a-zA-Z])(\d+)/g, '$1_$2');
    result = result.replace(/(\d+)([a-zA-Z])/g, '$1_$2');
    return result.split('_').filter(p => p.length > 0);
}

/**
 * 下划线分割处理（含Python特殊方法、C++风格等）
 * 需传入ignoreList/meaningfulShortWords等辅助参数
 */
export function processUnderscoreIdentifier(
    identifier: string,
    identifiersMap: Map<string, any>,
    ignoreList: Set<string>,
    meaningfulShortWords: Set<string>,
    isLikelyMeaningfulIdentifier: (id: string) => boolean,
    processCppIdentifier: (id: string, map: Map<string, any>) => boolean,
    processCamelCaseIdentifier: (id: string, map: Map<string, any>, ignore: Set<string>) => void
): void {
    if (/^__[a-zA-Z0-9]+__$/.test(identifier)) {
        const coreName = identifier.slice(2, -2);
        if (coreName.length > 1 && !identifiersMap.has(coreName) && isLikelyMeaningfulIdentifier(coreName)) {
            identifiersMap.set(coreName, 'split');
        }
        if (["__init__", "__str__", "__repr__"].includes(identifier)) {
            identifiersMap.set(identifier, 'original');
        }
        return;
    }
    processCppIdentifier(identifier, identifiersMap);
    const normalizedId = identifier.replace(/_{2,}/g, '_');
    const parts = normalizedId.split('_').filter(p => p.length > 0);
    for (const part of parts) {
        if ((part.length >= 3 || meaningfulShortWords.has(part.toLowerCase())) &&
            !ignoreList.has(part.toLowerCase()) &&
            isLikelyMeaningfulIdentifier(part)) {
            if (!identifiersMap.has(part)) {
                identifiersMap.set(part, 'split');
            }
        }
    }
}

/**
 * C++风格标识符特殊处理
 */
export function processCppIdentifier(identifier: string, identifiersMap: Map<string, any>): boolean {
    if (/^[a-z]+_t$/.test(identifier)) {
        const basePart = identifier.substring(0, identifier.length - 2);
        if (basePart.length >= 3 && !identifiersMap.has(basePart)) {
            identifiersMap.set(basePart, 'split');
        }
        return true;
    }
    if (/^(Get|Set)[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
        const prefix = identifier.substring(0, 3).toLowerCase();
        const body = identifier.substring(3);
        if (!identifiersMap.has(prefix)) {
            identifiersMap.set(prefix, 'split');
        }
        processCamelCaseIdentifier(body, identifiersMap, new Set());
        return true;
    }
    if (/^m_[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
        const body = identifier.substring(2);
        processCamelCaseIdentifier(body, identifiersMap, new Set());
        return true;
    }
    return false;
}

/**
 * 驼峰式标识符分割处理
 */
export function processCamelCaseIdentifier(
    identifier: string,
    identifiersMap: Map<string, any>,
    ignoreList: Set<string>,
    isLikelyMeaningfulIdentifier: (id: string) => boolean = defaultIsLikelyMeaningfulIdentifier
): void {
    if (/^[a-z]+[A-Z][a-z]+$/.test(identifier)) {
        const prefix = identifier.match(/^[a-z]+/)?.[0] || '';
        if (prefix.length >= 3 && !ignoreList.has(prefix.toLowerCase()) && isLikelyMeaningfulIdentifier(prefix)) {
            if (!identifiersMap.has(prefix)) {
                identifiersMap.set(prefix, 'split');
            }
        }
        const suffix = identifier.match(/[A-Z][a-z]+$/)?.[0] || '';
        if (suffix.length >= 3 && !ignoreList.has(suffix.toLowerCase()) && isLikelyMeaningfulIdentifier(suffix)) {
            if (!identifiersMap.has(suffix)) {
                identifiersMap.set(suffix, 'split');
            }
        }
    }
    const parts = splitCamelCase(identifier);
    for (const part of parts) {
        if (part.length >= 3 && !ignoreList.has(part.toLowerCase()) && isLikelyMeaningfulIdentifier(part)) {
            if (!identifiersMap.has(part)) {
                identifiersMap.set(part, 'split');
            }
        }
    }
}

/**
 * 判断是否为有意义的标识符
 */
export function defaultIsLikelyMeaningfulIdentifier(identifier: string): boolean {
    const nonMeaningfulPatterns = [
        /^[aeiou]+$/i, /^[bcdfghjklmnpqrstvwxyz]+$/i, /^[a-z][0-9]+$/i, /^tmp[0-9]*$/i, /^temp[0-9]*$/i,
        /^var[0-9]*$/i, /^[a-z]tmp$/i, /^test[0-9]*$/i, /^[a-z]{1,2}[0-9]{1,3}$/i, /^[_\-0-9]*$/
    ];
    for (const pattern of nonMeaningfulPatterns) {
        if (pattern.test(identifier)) return false;
    }
    return true;
}

/**
 * 判断是否为技术术语（黑名单+正则+前后缀+缩写）
 * @param identifier 标识符
 * @param blacklistSet 技术术语黑名单集合（全小写）
 */
export function isTechnicalTerm(identifier: string, blacklistSet?: Set<string>, techSuffixesSet?: Set<string>, commonAbbrSet?: Set<string>): boolean {
    // 黑名单判断
    if (blacklistSet && blacklistSet.has(identifier.toLowerCase())) return true;
    // 正则模式判断
    const techPatterns = [
        /^[A-Z][a-z]*[0-9]+$/,              // 大写开头后跟数字
        /^v?[0-9]+(\.[0-9]+)+(-[a-z]+)?$/,  // 版本号，如 v1.2.3, 1.0.0-beta
        /^([a-zA-Z]+[_-])*[a-zA-Z]+[_-][vV]?[0-9]+([._-][0-9a-zA-Z]+)*$/, // 匹配 BL_V2_1, Module_v1_0, Component-V3, 兼容多层下划线
        /^[vV][0-9]+$/,                     // 版本标志，如 v1, V2
        /^[vV][0-9]+\.[0-9]+$/,             // 详细版本标志，如 v1.0, V2.1
        /^.*[_-][vV][0-9]+$/                // 名称后跟版本标志，如 name_v1, name-V2
    ];
    for (const pattern of techPatterns) {
        if (pattern.test(identifier)) return true;
    }
    // 统一用Set判断缩写和后缀
    if (commonAbbrSet && identifier.length <= 3 && /^[a-zA-Z]{2,3}$/.test(identifier) && commonAbbrSet.has(identifier.toLowerCase())) {
        return true;
    }
    if (techSuffixesSet) {
        for (const suffix of techSuffixesSet) {
            if (identifier.toLowerCase().endsWith(suffix) && 
                identifier.length > suffix.length &&
                identifier.length <= suffix.length + 4) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 判断是否为CSS颜色/单位/数字等无需翻译的技术值
 */
export function isTechnicalValue(word: string): boolean {
    const cssSpecificValues = [
        'disabled', 'readonly', 'checked', 'selected', 'active', 'focus', 'hover',
        'enabled', 'hidden', 'visible', 'collapsed', 'expanded'
    ];
    if (cssSpecificValues.includes(word.toLowerCase())) return true;

    // 整合 isHexColor 的逻辑
    const hexColorPatterns = [
        /^#([0-9a-fA-F]{3})$/,             // 3位十六进制颜色 (如 #fff)
        /^#([0-9a-fA-F]{6})$/,             // 6位十六进制颜色 (如 #f0f0f0)
        /^#([0-9a-fA-F]{8})$/,             // 8位十六进制颜色 (带透明度, 如 #f0f0f0ff)
        /^([0-9a-fA-F]){3}$/,             // 3位十六进制值 (如 fff, f0f)
        /^([0-9a-fA-F]){6}$/,             // 6位十六进制值 (如 f0f0f0)
        /^([0-9a-fA-F]){8}$/,             // 8位十六进制值 (如 f0f0f0ff)
        /^0x[0-9a-fA-F]+$/,             // 以 0x 开头的十六进制 (如 0xffff, 0xABC)
        /^X[0-9a-fA-F]+$/i,             // 以 X 开头的十六进制 (如 Xffff, XABC) - 不区分大小写
        /^([0-9a-fA-F])\1+$/,           // 重复字符的十六进制 (如 fff, aaa)
        /^([0-9a-fA-F]{2})\1+$/         // 重复双字符的十六进制 (如 ababab)
    ];
    const isBasicHexColor = hexColorPatterns.some((pattern) => pattern.test(word));
    if (isBasicHexColor) return true;
    if (word.length >= 3 && word.length <= 8) {
        if (/^[0-9a-fA-F]+$/.test(word) && /[a-fA-F]/.test(word)) {
            return true; 
        }
    }

    const commonEnglishWords = ['take', 'add', 'code', 'data', 'face', 'seed', 'deed',
        'fade', 'made', 'bed', 'feed', 'beef'];
    if (commonEnglishWords.includes(word.toLowerCase())) return false;
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:,\s*[\d.]+\s*)?\)$/.test(word)) return true;
    if (/^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%(?:,\s*[\d.]+\s*)?\)$/.test(word)) return true;
    if (/^-?\d+(\.\d+)?(px|em|rem|vh|vw|%|pt|pc|in|cm|mm|ex|ch|vmin|vmax|fr|deg|rad|turn|s|ms)$/.test(word)) return true;
    if (/^-?\d+(\.\d+)?$/.test(word)) return true;
    return false;
}

/**
 * 标准化单词，移除所有非字母字符并转为小写
 */
export function normalizeWord(word: string): string {
    return word.replace(/[^a-zA-Z]/g, '').toLowerCase();
}

/**
 * 校验翻译是否符合字母数量等规则
 */
export function validateTranslationMatch(original: string, translated: string | undefined): string | undefined {
    if (!translated) return undefined;
    const normalizedOriginal = normalizeWord(original);
    const normalizedTranslated = normalizeWord(translated);
    if (normalizedOriginal.length < 2) return undefined;
    if (normalizedOriginal.toLowerCase() === normalizedTranslated.toLowerCase()) return translated;
    if (/^[a-zA-Z]+$/.test(original) && /^[a-zA-Z]+$/.test(translated)) {
        if (normalizedOriginal.length !== normalizedTranslated.length) return undefined;
    }
    return translated;
}

/**
 * 忽略大小写查找翻译
 */
export function findTranslationIgnoreCase(vocabulary: any, word: string): string | undefined {
    if (!vocabulary || !vocabulary.entries || !word) return undefined;
    const normalizedWord = normalizeWord(word);
    if (normalizedWord.length < 2) return undefined;
    for (const entry of vocabulary.entries) {
        if (entry.type === 'identifier' && entry.original && entry.translated) {
            const normalizedEntry = normalizeWord(entry.original);
            if (normalizedEntry.length !== normalizedWord.length) continue;
            if (normalizedEntry === normalizedWord) return entry.translated;
        }
    }
    return undefined;
}

/**
 * 判断是否为路径或URL
 */
export function isPathOrUrl(text: string): boolean {
    if (!text) return false;
    const pathPatterns = [
        /^\/[\w\-\.\/]+$/,
        /^\.\.?\/[\w\-\.\/]+$/,
        /^[a-zA-Z]:\\[\w\-\.\\]+$/,
        /\.(?:png|jpe?g|gif|svg|webp|ico|js|jsx|ts|tsx|css|scss|less|html|htm|xml|json|ya?ml|md|pdf|zip|rar|gz|tar)$/i,
        /^(?:\/|\.\/|\.\.\/)(?:static|assets|img|images|media|resources)\/[\w\-\.\/]+$/i,
        /\/[\w\-\.]+\/$/
    ];
    const urlPatterns = [
        /^(?:https?|ftp|file):\/\/[\w\-\.\/]+$/i,
        /^www\.[\w\-\.\/]+$/i,
        /\.(?:com|org|net|edu|gov|io|app|co|me)(?:\/|$)/i
    ];
    for (const pattern of pathPatterns) if (pattern.test(text)) return true;
    for (const pattern of urlPatterns) if (pattern.test(text)) return true;
    return false;
}

/**
 * 转义正则表达式特殊字符
 */
export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 转义HTML特殊字符的辅助函数
 */
export function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 格式化翻译后的标识符，保持原始大小写风格
 */
export function formatTranslatedIdentifier(translatedWord: string | undefined, originalWord: string): string {
    if (!translatedWord) return originalWord;
    let formatted = translatedWord.trim();
    formatted = formatted.replace(/([^\x00-\x7F])\s+([^\x00-\x7F])/g, '$1$2');
    if (originalWord === originalWord.toUpperCase()) {
        formatted = formatted.toUpperCase();
    } else if (originalWord[0] === originalWord[0].toUpperCase()) {
        formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    }
    return formatted;
}

/**
 * 词干提取
 */
export function getStem(word: string): string {
    let stem = word.toLowerCase();
    const suffixes = [
        'ing', 'ed', 'es', 's', 'er', 'ers', 'or', 'ors', 'ion', 'ions',
        'tion', 'tions', 'ment', 'ments', 'ness', 'ity', 'ty', 'ies', 'able',
        'ible', 'al', 'ial', 'ical', 'ful', 'ous', 'ious', 'ive', 'ative', 'itive'
    ];
    for (const suffix of suffixes) {
        if (stem.endsWith(suffix) && stem.length > suffix.length + 2) {
            stem = stem.substring(0, stem.length - suffix.length);
            break;
        }
    }
    if (stem.endsWith('ie')) {
        stem = stem.substring(0, stem.length - 2) + 'y';
    }
    if (stem.endsWith('y') && stem.length > 2) {
        const beforeY = stem.charAt(stem.length - 2);
        if (!['a', 'e', 'i', 'o', 'u'].includes(beforeY)) {
            stem = stem.substring(0, stem.length - 1) + 'i';
        }
    }
    return stem;
}

/**
 * 判断两个单词是否为同一词根
 */
export function isSameWordRoot(word1: string, word2: string): boolean {
    if (word1.toLowerCase() === word2.toLowerCase()) return true;
    const stem1 = getStem(word1);
    const stem2 = getStem(word2);
    return stem1 === stem2;
}

/**
 * 处理复合标识符的翻译（支持下划线、驼峰、前后缀等）
 * 如果整体没有翻译，尝试拆分并分别翻译各部分
 * @param original 原始复合标识符
 * @param vocabulary 词汇表
 * @param getTranslation 可选，翻译查找函数
 * @returns 翻译结果
 */
export function handleCompoundIdentifier(original: string, vocabulary: any, getTranslation?: (vocab: any, word: string, type: string) => string | undefined): string | undefined {
    // === 优先级最高：如果整个原始标识符在词汇表中存在，则直接返回其翻译 ===
    let wholeTranslationFromVocab = findTranslationIgnoreCase(vocabulary, original);
    if (wholeTranslationFromVocab) {
        return wholeTranslationFromVocab;
    }

    // 以下是针对整个标识符的过滤，如果上面没有命中词汇表，才进行这些过滤
    if (isPathOrUrl(original)) return undefined;
    if (typeof isTechnicalTerm === 'function' && isTechnicalTerm(original)) return undefined;
    if (typeof isTechnicalValue === 'function' && isTechnicalValue(original)) return undefined;

    if (original.includes('_')) {
        const parts = original.split('_');
        const translatedPartsForUnderscore: string[] = [];
        let anyPartActuallyTranslatedInUnderscore = false;
        for (const part of parts) {
            if (part === '') { translatedPartsForUnderscore.push(''); continue; }
            if (isPathOrUrl(part)) { translatedPartsForUnderscore.push(part); continue; }

            const dictResult = findTranslationIgnoreCase(vocabulary, part);
            if (dictResult) { // 只要词汇表有翻译，优先用
                translatedPartsForUnderscore.push(dictResult);
                anyPartActuallyTranslatedInUnderscore = true;
                continue;
            }

            const isTech = typeof isTechnicalTerm === 'function' && isTechnicalTerm(part);
            if (isTech) { translatedPartsForUnderscore.push(part); continue; }
            
            let partTranslation = (getTranslation ? getTranslation(vocabulary, part, 'identifier') : undefined);
            partTranslation = validateTranslationMatch(part, partTranslation);
            // 日志输出
            console.log('[CodeLocalizer][分词兜底-下划线]', {
                original,
                part,
                isTech,
                normalized: normalizeWord(part),
                dictResult,
                partTranslation
            });
            if (partTranslation && partTranslation !== part) {
                translatedPartsForUnderscore.push(partTranslation);
                anyPartActuallyTranslatedInUnderscore = true;
            } else {
                translatedPartsForUnderscore.push(part);
            }
        }
        if (anyPartActuallyTranslatedInUnderscore) return translatedPartsForUnderscore.join('_');
        return undefined;
    }
    // 移除原始的整体翻译查找，因为它已被移到函数开头
    // let wholeTranslation = findTranslationIgnoreCase(vocabulary, original);
    // console.log('[CodeLocalizer][分词兜底-整体]', {
    //     original,
    //     wholeTranslation
    // });
    // if (wholeTranslation) return wholeTranslation;

    if (getTranslation) {
        wholeTranslationFromVocab = getTranslation(vocabulary, original, 'identifier');
        wholeTranslationFromVocab = validateTranslationMatch(original, wholeTranslationFromVocab);
        // 日志输出
        console.log('[CodeLocalizer][分词兜底-getTranslation]', {
            original,
            wholeTranslation: wholeTranslationFromVocab
        });
        if (wholeTranslationFromVocab) return wholeTranslationFromVocab;
    }
    if (!original.includes('_') && original.length < 3) return undefined;
    const prefixMatch = original.match(/^(get|set|is|has|add|remove|create|update|delete|find|fetch|load|save|init|on|handle)([A-Z][a-zA-Z0-9_]*$)/i);
    if (prefixMatch && !original.includes('_')) {
        const prefix = prefixMatch[1];
        const rest = prefixMatch[2];
        // 在这里也需要优先检查词汇表，而不是直接检查isTechnicalTerm
        let prefixTranslation = findTranslationIgnoreCase(vocabulary, prefix) ||
                                (typeof isTechnicalTerm === 'function' && isTechnicalTerm(prefix) ? undefined : undefined) || // 如果词汇表没有，再考虑技术术语
                                (getTranslation ? getTranslation(vocabulary, prefix, 'identifier') : undefined);

        prefixTranslation = validateTranslationMatch(prefix, prefixTranslation);
        const restTranslation = handleCompoundIdentifier(rest, vocabulary, getTranslation);
        // 日志输出
        console.log('[CodeLocalizer][分词兜底-前缀]', {
            original,
            prefix,
            rest,
            prefixTranslation,
            restTranslation
        });
        if ((prefixTranslation || prefix) && (restTranslation || rest)) {
            const hasTranslation = (prefixTranslation !== undefined && prefixTranslation !== prefix) ||
                (restTranslation !== undefined && restTranslation !== rest);
            const result = `${prefixTranslation || prefix}${restTranslation || rest}`;
            if (hasTranslation) return result;
        }
    }
    if (/[a-z][A-Z]/.test(original) || /^[a-z]+[A-Z][a-z]/.test(original)) {
        const parts = splitCamelCase(original);
        let translatedParts: string[] = [];
        let anyCamelPartTranslated = false;
        for (const part of parts) {
            if (part.length < 2 && !(/[A-Z]/.test(part) && original.startsWith(part))) continue;
            if (isPathOrUrl(part)) { translatedParts.push(part); continue; }

            const dictResult = findTranslationIgnoreCase(vocabulary, part);
            if (dictResult) {
                translatedParts.push(dictResult);
                anyCamelPartTranslated = true;
                continue;
            }

            const isTech = typeof isTechnicalTerm === 'function' && isTechnicalTerm(part);
            if (isTech) { translatedParts.push(part); continue; }

            let partTranslation = (getTranslation ? getTranslation(vocabulary, part, 'identifier') : undefined);
            partTranslation = validateTranslationMatch(part, partTranslation);
            // 日志输出
            console.log('[CodeLocalizer][分词兜底-驼峰]', {
                original,
                part,
                isTech,
                normalized: normalizeWord(part),
                dictResult,
                partTranslation
            });
            if (partTranslation && partTranslation !== part) {
                translatedParts.push(partTranslation);
                anyCamelPartTranslated = true;
            } else {
                translatedParts.push(part);
            }
        }
        if (anyCamelPartTranslated) return translatedParts.join('');
    }
    return undefined;
}

/**
 * 通用标识符分词方法，支持下划线、驼峰、全大写等复合风格
 * 例如：MYCAN_ERROR_NOT_INITIALIZED -> ["MYCAN", "ERROR", "NOT", "INITIALIZED"]
 *        userName -> ["user", "Name"]
 *        data -> ["data"]
 * @param identifier 标识符字符串
 * @returns 分割后的单词数组
 */
export function splitIdentifierToParts(identifier: string): string[] {
    if (!identifier) return [];
    // 先按下划线分割
    let parts = identifier.split('_').filter(Boolean);
    if (parts.length === 1) {
        // 没有下划线，再按驼峰分割
        parts = splitCamelCase(identifier);
    }
    // 对每个部分再做一次大写分割，兼容如ABCError等
    const finalParts: string[] = [];
    for (const part of parts) {
        // 按大写分割
        const subParts = part.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
                             .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                             .split(' ');
        for (const sub of subParts) {
            // 新增：再按字母和数字分割
            const finerParts = sub.split(/(?<=\D)(?=\d)|(?<=\d)(?=\D)/);
            for (const finer of finerParts) {
                if (finer.length > 0) finalParts.push(finer);
            }
        }
    }
    return finalParts;
}

/**
 * 过滤已在词汇表中的标识符，增强查重功能
 * @param identifiers 标识符列表
 * @param vocabulary 词汇表
 */
export function filterExistingIdentifiers(identifiers: string[], vocabulary: any): { 
    existingIds: Set<string>, 
    newIdentifiers: string[] 
} {
    const existingIds = new Set<string>();
    const newIdentifiers: string[] = [];

    if (!vocabulary || !vocabulary.entries) {
        console.warn("[CodeLocalizer] 词汇表或entries未初始化，无法过滤现有标识符。");
        return { existingIds, newIdentifiers: identifiers }; // 返回所有标识符为新
    }

    // 使用 findVocabularyEntryIndex 进行查重，只关注 original 字段
    for (const id of identifiers) {
        if (findVocabularyEntryIndex(vocabulary, id, true) !== -1) { // 只查 original
            existingIds.add(id); // 已存在
        } else {
            newIdentifiers.push(id); // 新标识符
        }
    }

    return { existingIds, newIdentifiers };
} 