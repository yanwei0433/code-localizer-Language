// 装饰器管理模块，负责将翻译应用到编辑器显示
import * as vscode from 'vscode';
import { Vocabulary } from '../types';
import { getTranslation } from '../vocabulary/vocabulary-manager';
import { getSyntaxColor } from './syntax-highlighter';
import {
  splitCamelCase,
  processUnderscoreIdentifier,
  processCamelCaseIdentifier,
  processCppIdentifier,
  defaultIsLikelyMeaningfulIdentifier,
  isTechnicalTerm,
  isTechnicalValue,
  getStem,
  isSameWordRoot,
  splitIdentifierToParts,
  normalizeWord,
  validateTranslationMatch,
  findTranslationIgnoreCase,
  isPathOrUrl,
  escapeRegExp,
  formatTranslatedIdentifier,
  handleCompoundIdentifier
} from '../extraction/word-utils';
import { loadBlacklist, getTermsSet, getIgnoreSet, getMeaningfulShortWordsSet, getPythonKeywordsSet } from '../config/blacklist-manager';
import { ExtensionContext } from 'vscode';
import { extractIdentifiers, prioritizeIdentifiers } from '../extraction/extractor';

// 存储所有活跃的装饰类型
let activeDecorations: vscode.TextEditorDecorationType[] = [];
// 存储当前装饰的标识符范围信息
const decorationRanges = new Map<string, vscode.DecorationOptions[]>();

// 新增：装饰映射缓存，避免重复映射
const decorationMappingCache = new Map<string, {
    decorations: vscode.DecorationOptions[],
    vocabularyHash: string,
    documentVersion: number,
    visibleRangesHash: string
}>();

// 监听视口变化事件，自动刷新母语装饰
let visibleRangeDisposables: vscode.Disposable[] = [];

// 在文件顶部添加防抖定时器变量
let visibleRangeDebounceTimer: NodeJS.Timeout | null = null;

// 新增：标识符装饰缓存，key为文档uri+标识符起止位置+文档版本
const identifierDecorationCache = new Map<string, vscode.DecorationOptions>(); // 中文注释：标识符级缓存

// 新增：记录上一次的可见区域hash，避免重复渲染
const lastVisibleRangesHashMap = new Map<string, string>(); // key: 文档uri，value: 上一次的可见区域hash

// 记录上一次可见区域的所有标识符key
const lastVisibleIdentifierKeysMap = new Map<string, Set<string>>(); // key: 文档uri，value: Set<标识符key>

// 新增：持久化装饰状态管理 - 记录每个文档已装饰的标识符范围
const persistentDecorationState = new Map<string, Set<string>>(); // key: 文档uri，value: Set<已装饰的标识符key>

// 新增：全局装饰状态 - 记录每个编辑器当前的装饰状态
const editorDecorationState = new Map<string, vscode.DecorationOptions[]>(); // key: 编辑器uri，value: 当前装饰列表

// 新增：全局 provider 变量，便于切换时注销
let hoverProviderDisposable: vscode.Disposable | null = null; // hover模式的悬停提示
let inlayHintProviderDisposable: vscode.Disposable | null = null; // inlineHint模式的内联提示
let lastDecorationStyle: string | null = null; // 新增：记录上一次的装饰样式

/**
 * 生成词汇表的哈希值，用于缓存键
 */
function generateVocabularyHash(vocabulary: Vocabulary): string {
    // 使用词汇表条目数量和目标语言生成简单哈希
    return `${vocabulary.entries.length}-${vocabulary.target_language}`;
}

/**
 * 生成可见区域的哈希值，用于缓存键
 */
function generateVisibleRangesHash(visibleRanges: readonly vscode.Range[]): string {
    // 使用可见区域的起始和结束位置生成哈希
    return visibleRanges.map(range => 
        `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`
    ).join('|');
}

/**
 * 生成缓存键
 */
function generateCacheKey(documentUri: string, vocabularyHash: string, visibleRangesHash: string): string {
    return `${documentUri}-${vocabularyHash}-${visibleRangesHash}`;
}

// 生成标识符缓存key
function getIdentifierCacheKey(uri: string, start: vscode.Position, end: vscode.Position, version: number) {
    return `${uri}:${start.line}:${start.character}-${end.line}:${end.character}@${version}`;
}

/**
 * 清除所有现有的装饰
 */
export function clearAllDecorations() {
    // 清除所有现有的装饰类型
    activeDecorations.forEach(decoration => decoration.dispose());
    activeDecorations = [];
    decorationRanges.clear();
    
    // 清除所有与 overlay 模式相关的缓存
    decorationMappingCache.clear();
    persistentDecorationState.clear();
    editorDecorationState.clear();
    identifierDecorationCache.clear();
    lastVisibleRangesHashMap.clear();
    lastVisibleIdentifierKeysMap.clear();

    console.log(`[CodeLocalizer] 已清除所有母语装饰和映射缓存`);
}

/**
 * 检查给定位置是否在代码注释中
 * @param document 文档对象
 * @param position 要检查的位置
 * @returns 是否在注释中
 */
function isInComment(document: vscode.TextDocument, position: vscode.Position): boolean {
    // 获取当前行的文本
    const line = document.lineAt(position.line).text;
    
    // 检查当前位置是否在单行注释之后
    
    // 处理常见编程语言的单行注释符号
    const singleLineComments = [
        '//', // C, C++, Java, JavaScript, TypeScript
        '#',  // Python, Ruby, Shell, Perl
        '--', // SQL, Lua
        '%',  // MATLAB, LaTeX
        ';',  // Assembly, Lisp
        "'",  // VB
        '<!--', // HTML, XML
        '/*'  // CSS开始标记
    ];
    
    // 检查是否在单行注释中
    for (const commentStart of singleLineComments) {
        const commentIndex = line.indexOf(commentStart);
        // 如果找到注释符号，且当前位置在注释符号之后
        if (commentIndex !== -1 && position.character > commentIndex) {
            return true;
        }
    }
    
    // 处理多行注释，需要查找整个文本
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    // 常见多行注释的开始和结束标记
    const multilineCommentPairs = [
        { start: '/*', end: '*/' },     // C, C++, Java, JavaScript, CSS
        { start: '<!--', end: '-->' },  // HTML, XML
        { start: '=begin', end: '=end' }, // Ruby
        { start: '"""', end: '"""' },   // Python 文档字符串
        { start: "'''", end: "'''" },   // Python 文档字符串
        { start: '{-', end: '-}' },     // Haskell
        { start: '(*', end: '*)' }      // OCaml
    ];
    
    // 检查是否在多行注释中
    for (const { start, end } of multilineCommentPairs) {
        let searchStartPos = 0;
        let commentStartIndex = -1;
        let commentEndIndex = -1;
        
        // 搜索所有多行注释块
        while (true) {
            commentStartIndex = text.indexOf(start, searchStartPos);
            if (commentStartIndex === -1) break;
            
            commentEndIndex = text.indexOf(end, commentStartIndex + start.length);
            // 如果找不到结束标记，则假设注释一直延伸到文件末尾
            if (commentEndIndex === -1) commentEndIndex = text.length;
            
            // 检查当前位置是否在注释块内
            if (offset > commentStartIndex && offset < commentEndIndex + end.length) {
                return true;
            }
            
            // 移动搜索位置到当前注释块之后
            searchStartPos = commentEndIndex + end.length;
        }
    }
    
    return false;
}

/**
 * 主装饰应用函数，支持 overlay/hover/inlineHint 三种模式
 * @param editor 编辑器实例
 * @param vocabulary 词汇表
 * @param context VS Code扩展上下文（用于加载黑名单）
 * @param _retry 内部重试标记
 */
export async function applyMotherTongueDecorations(
    editor: vscode.TextEditor,
    vocabulary: Vocabulary,
    context?: ExtensionContext,
    _retry?: boolean
) {
    const config = vscode.workspace.getConfiguration('codeLocalizer');
    const enableDisplay = config.get<boolean>('enableMotherTongueDisplay', true);
    const style = config.get<string>('motherTongueDisplayStyle', 'overlay');

    const styleChanged = style !== lastDecorationStyle;

    // 1. 如果禁用了显示或样式发生变化，则清理所有旧的装饰和providers
    if (!enableDisplay || styleChanged) {
        console.log(`[CodeLocalizer] Cleaning decorations. Reason: ${!enableDisplay ? 'Display disabled' : `Style changed from ${lastDecorationStyle} to ${style}`}`);
        clearAllDecorations();
        if (hoverProviderDisposable) {
            hoverProviderDisposable.dispose();
            hoverProviderDisposable = null;
        }
        if (inlayHintProviderDisposable) {
            inlayHintProviderDisposable.dispose();
            inlayHintProviderDisposable = null;
        }
    }

    // 如果禁用了，到此为止
    if (!enableDisplay) {
        lastDecorationStyle = null; // 设为null，以便下次启用时能正确触发刷新
        return;
    }

    // 2. 根据新样式应用装饰或注册 providers
    switch (style) {
        case 'overlay':
            // 只有在样式切换时或在已经是overlay模式下刷新时才需要重新应用
            await applyOverlayDecorations(editor, vocabulary, context, _retry);
            break;
        
        case 'hover':
            // 仅在样式切换时注册一次
            if (styleChanged) {
                console.log('[CodeLocalizer] Registering HoverProvider.');
                hoverProviderDisposable = vscode.languages.registerHoverProvider(
                    { scheme: 'file' },
                    {
                        provideHover(document, position) {
                            const wordRange = document.getWordRangeAtPosition(position);
                            if (!wordRange) return;
                            const word = document.getText(wordRange);
                            const translation = getTranslation(vocabulary, word);
                            if (translation && translation !== word) {
                                return new vscode.Hover(`**${word}**\n\n母语翻译: ${translation}`);
                            }
                        }
                    }
                );
            }
            break;

        case 'inlineHint':
            // 仅在样式切换时注册一次
            if (styleChanged) {
                console.log('[CodeLocalizer] Registering InlayHintsProvider for compound words.');
                inlayHintProviderDisposable = vscode.languages.registerInlayHintsProvider(
                    { scheme: 'file' },
                    {
                        provideInlayHints(document, range) {
                            const hints: vscode.InlayHint[] = [];
                            // 使用与 overlay 模式相同的标识符提取逻辑
                            const identifiers = extractIdentifiersInRanges(document, [range]);

                            for (const id of identifiers) {
                                // 使用 handleCompoundIdentifier 获取复合词的翻译，并传入 getTranslation
                                const translation = handleCompoundIdentifier(id.text, vocabulary, getTranslation);
                                if (translation && translation !== id.text) {
                                    // 在标识符末尾创建提示
                                    const hint = new vscode.InlayHint(id.range.end, ` ${translation}`, vscode.InlayHintKind.Type);
                                    hints.push(hint);
                                }
                            }
                            
                            return hints;
                        }
                    }
                );
            }
            break;
    }

    // 3. 更新最后使用的样式
    lastDecorationStyle = style;
}

// 修正：overlay 逻辑单独封装，递归和 context/_retry 参数全部在内部处理
async function applyOverlayDecorations(
    editor: vscode.TextEditor,
    vocabulary: Vocabulary,
    context?: ExtensionContext,
    _retry?: boolean
) {
    if (!editor || !vocabulary || !vocabulary.entries) {
        console.log(`[CodeLocalizer] 无法应用装饰: 编辑器或词汇表无效`);
        return;
    }
    const document = editor.document;
    const documentUri = document.uri.toString();
    const visibleRanges = editor.visibleRanges;
    if ((!visibleRanges || visibleRanges.length === 0) && !_retry) {
        setTimeout(() => {
            applyOverlayDecorations(editor, vocabulary, context, true); // 递归时补全参数
        }, 120);
        return;
    }
    if (!visibleRanges || visibleRanges.length === 0) {
        console.log('[CodeLocalizer] 当前无可见区域，跳过装饰');
        return;
    }
    
    // 清理旧缓存
    clearIdentifierCacheForDocument(documentUri, document.version);
    
    // 获取已持久化的装饰状态
    const persistentDecorations = persistentDecorationState.get(documentUri) || new Set<string>();
    
    // 提取可见区域所有标识符
    const identifiers: {text: string, range: vscode.Range}[] = extractIdentifiersInRanges(document, visibleRanges);
    const identifierKeys = new Set<string>();
    const newDecorations: vscode.DecorationOptions[] = [];
    const allDecorations: vscode.DecorationOptions[] = [];
    
    // 先添加已持久化的装饰
    for (const persistentKey of persistentDecorations) {
        if (identifierDecorationCache.has(persistentKey)) {
            const cachedDecoration = identifierDecorationCache.get(persistentKey)!;
            allDecorations.push(cachedDecoration);
        }
    }
    
    // 处理新出现的标识符
    for (const id of identifiers) {
        const key = getIdentifierCacheKey(documentUri, id.range.start, id.range.end, document.version);
        identifierKeys.add(key);
        
        if (identifierDecorationCache.has(key)) {
            // 命中缓存
            const cachedDecoration = identifierDecorationCache.get(key)!;
            allDecorations.push(cachedDecoration);
            console.log(`[CodeLocalizer][缓存命中] ${id.text} @ ${key}`);
        } else {
            // 未命中缓存，需翻译并生成装饰
            const deco = await createDecorationForIdentifier(id, vocabulary);
            identifierDecorationCache.set(key, deco);
            newDecorations.push(deco);
            allDecorations.push(deco);
            // 添加到持久化状态
            persistentDecorations.add(key);
            console.log(`[CodeLocalizer][缓存未命中] ${id.text} @ ${key}`);
        }
    }
    
    // 更新持久化状态
    persistentDecorationState.set(documentUri, persistentDecorations);
    
    // --- 新增：对 allDecorations 按 range 去重，避免重影 ---
    const uniqueDecorationsMap = new Map<string, vscode.DecorationOptions>();
    for (const deco of allDecorations) {
        const rangeKey = `${deco.range.start.line}:${deco.range.start.character}-${deco.range.end.line}:${deco.range.end.character}`;
        if (!uniqueDecorationsMap.has(rangeKey)) {
            uniqueDecorationsMap.set(rangeKey, deco);
        }
    }
    const uniqueDecorations = Array.from(uniqueDecorationsMap.values());

    // 检查是否有新的装饰需要应用
    const currentDecorations = editorDecorationState.get(documentUri) || [];
    const hasNewDecorations = newDecorations.length > 0 || 
        currentDecorations.length !== uniqueDecorations.length ||
        !arraysEqual(currentDecorations, uniqueDecorations);

    if (hasNewDecorations) {
        // 应用所有装饰（包括已持久化的和新生成的），并去重
        editor.setDecorations(getDecorationType(), uniqueDecorations);
        editorDecorationState.set(documentUri, uniqueDecorations);
        console.log(`[CodeLocalizer] 应用了 ${uniqueDecorations.length} 个母语装饰（新增 ${newDecorations.length} 个），处理了 ${identifierKeys.size} 个标识符`);
    } else {
        console.log(`[CodeLocalizer] 装饰状态未变化，跳过重新渲染`);
    }
    
    // 更新可见区域记录
    lastVisibleIdentifierKeysMap.set(documentUri, identifierKeys);
}

/**
 * 比较两个装饰数组是否相等
 */
function arraysEqual(arr1: vscode.DecorationOptions[], arr2: vscode.DecorationOptions[]): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i].range.start.line !== arr2[i].range.start.line ||
            arr1[i].range.start.character !== arr2[i].range.start.character ||
            arr1[i].range.end.line !== arr2[i].range.end.line ||
            arr1[i].range.end.character !== arr2[i].range.end.character) {
            return false;
        }
    }
    return true;
}

/**
 * 清除特定文档的装饰
 */
function clearDocumentDecorations(documentUri: string) {
    // 清除特定文档的现有装饰
    const decorations = decorationRanges.get(documentUri);
    if (decorations) {
        vscode.window.visibleTextEditors.forEach(editor => {
            if (editor.document.uri.toString() === documentUri) {
                activeDecorations.forEach(decoration => {
                    editor.setDecorations(decoration, []);
                });
            }
        });
    }
}

/**
 * 清理过期的装饰映射缓存
 * @param documentUri 文档URI
 * @param documentVersion 文档版本
 */
function clearExpiredCache(documentUri: string, documentVersion: number) {
    // 清理指定文档的过期缓存
    for (const [cacheKey, cacheValue] of decorationMappingCache.entries()) {
        if (cacheKey.startsWith(documentUri) && cacheValue.documentVersion !== documentVersion) {
            decorationMappingCache.delete(cacheKey);
            console.log(`[CodeLocalizer] 清理过期缓存: ${cacheKey}`);
        }
    }
}

/**
 * 清理特定文档的所有缓存
 * @param documentUri 文档URI
 */
export function clearDocumentCache(documentUri: string) {
    for (const [cacheKey] of decorationMappingCache.entries()) {
        if (cacheKey.startsWith(documentUri)) {
            decorationMappingCache.delete(cacheKey);
            console.log(`[CodeLocalizer] 清理文档缓存: ${cacheKey}`);
        }
    }
    // 清除文档的持久化装饰状态
    persistentDecorationState.delete(documentUri);
    editorDecorationState.delete(documentUri);
    console.log(`[CodeLocalizer] 清理文档持久化装饰状态: ${documentUri}`);
}

/**
 * 刷新所有编辑器的装饰，确保不更新临时词汇表
 * 此函数只负责刷新装饰，不会触发提取逻辑
 */
export function refreshAllDecorations(vocabulary: Vocabulary) {
    console.log(`[CodeLocalizer] 开始刷新所有编辑器的母语装饰，词汇表有 ${vocabulary.entries.length} 条条目`);
    
    // 先检查装饰是否启用
    const config = vscode.workspace.getConfiguration('codeLocalizer');
    const enableDisplay = config.get<boolean>('enableMotherTongueDisplay', true);
    
    if (!enableDisplay) {
        console.log(`[CodeLocalizer] 母语显示当前已禁用，不刷新装饰`);
        return;
    }
    
    // 然后才应用到所有编辑器
    vscode.window.visibleTextEditors.forEach(editor => {
        applyMotherTongueDecorations(editor, vocabulary);
    });
}

// 添加新的计算margin偏移量的函数
/**
 * 计算装饰器的margin偏移量，考虑字符宽度差异
 * @param originalWord 原始单词
 * @param translatedWord 翻译后的单词
 * @returns 适合的margin值
 */
function calculateMarginOffset(originalWord: string, translatedWord: string | undefined): string {
    // 如果翻译为空，使用原始单词
    if (!translatedWord) {
        translatedWord = originalWord;
    }
    
    // 基础偏移量，使翻译文本覆盖原始文本
    const baseOffset = originalWord.length;
    
    // 处理特殊情况：中文字符和非ASCII字符可能需要特殊处理
    const containsWideChars = /[\u4e00-\u9fa5\uff01-\uff5e]/.test(translatedWord);
    const containsSpecialChars = /[^\x00-\x7F]/.test(translatedWord);
    
    // 优化：为多字节字符提供更精确的宽度计算
    if (containsWideChars || containsSpecialChars) {
        // 对于包含中文等双宽度字符的情况，计算实际视觉宽度
        const visualWidth = calculateVisualWidth(translatedWord);
        
        // 确保偏移量足够覆盖原始文本
        const effectiveOffset = Math.max(baseOffset, visualWidth);
        return `0 0 0 -${baseOffset}ch`;
    }
    
    // 标准情况
    return `0 0 0 -${baseOffset}ch`;
}

/**
 * 计算字符串的视觉宽度，考虑到中文和其他宽字符
 * @param text 要计算宽度的文本
 * @returns 估计的视觉宽度
 */
function calculateVisualWidth(text: string): number {
    let width = 0;
    
    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        // 中文字符、全角符号等通常占用两个字符宽度
        if (/[\u4e00-\u9fa5\uff01-\uff5e]/.test(char)) {
            width += 2;
        } else {
            width += 1;
        }
    }
    
    return width;
}

// 新增：优先用缓存渲染装饰，保证切换/点击页面时装饰秒显
function renderCachedDecorations(editor: vscode.TextEditor) {
    // 判断是否启用母语显示
    const config = vscode.workspace.getConfiguration('codeLocalizer');
    const enableDisplay = config.get<boolean>('enableMotherTongueDisplay', true);
    if (!enableDisplay) {
        // 如果关闭了装饰功能，清空装饰
        editor.setDecorations(getDecorationType(), []);
        return;
    }
    const documentUri = editor.document.uri.toString();
    const documentVersion = editor.document.version;
    const visibleRanges = editor.visibleRanges;
    const decorations: vscode.DecorationOptions[] = [];
    for (const range of visibleRanges) {
        // 提取当前可见区域的所有标识符key
        const text = editor.document.getText(range);
        const regex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
        let match;
        let offset = editor.document.offsetAt(range.start);
        while ((match = regex.exec(text)) !== null) {
            const identifier = match[0];
            const start = editor.document.positionAt(offset + match.index);
            const end = editor.document.positionAt(offset + match.index + identifier.length);
            const key = `${documentUri}:${start.line}:${start.character}-${end.line}:${end.character}@${documentVersion}`;
            if (identifierDecorationCache.has(key)) {
                decorations.push(identifierDecorationCache.get(key)!);
            }
        }
    }
    // 去重
    const uniqueMap = new Map<string, vscode.DecorationOptions>();
    for (const deco of decorations) {
        const rangeKey = `${deco.range.start.line}:${deco.range.start.character}-${deco.range.end.line}:${deco.range.end.character}`;
        if (!uniqueMap.has(rangeKey)) uniqueMap.set(rangeKey, deco);
    }
    editor.setDecorations(getDecorationType(), Array.from(uniqueMap.values()));
}

export function registerVisibleRangeListener(context: vscode.ExtensionContext, vocabulary: Vocabulary) {
    // 清理旧的监听
    visibleRangeDisposables.forEach(d => d.dispose());
    visibleRangeDisposables = [];
    const disposable = vscode.window.onDidChangeTextEditorVisibleRanges(editor => {
        if (editor && editor.textEditor && vocabulary) {
            renderCachedDecorations(editor.textEditor); // 先用缓存渲染
            // 滚动时加2秒防抖延迟
            if (visibleRangeDebounceTimer) clearTimeout(visibleRangeDebounceTimer);
            visibleRangeDebounceTimer = setTimeout(() => {
                applyMotherTongueDecorations(editor.textEditor, vocabulary);
            }, 1000);
        }
    });
    visibleRangeDisposables.push(disposable);

    // 监听编辑器切换事件，切换tab时自动刷新装饰（加延迟）
    const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && vocabulary) {
            renderCachedDecorations(editor); // 先用缓存渲染
            setTimeout(() => {
                applyMotherTongueDecorations(editor, vocabulary);
            }, 200);
        }
    });
    visibleRangeDisposables.push(activeEditorDisposable);

    // 监听可见编辑器变化，切换/关闭/新开tab时自动刷新装饰
    const visibleEditorsDisposable = vscode.window.onDidChangeVisibleTextEditors(editors => {
        editors.forEach(editor => {
            if (editor && vocabulary) {
                renderCachedDecorations(editor); // 先用缓存渲染
                setTimeout(() => {
                    applyMotherTongueDecorations(editor, vocabulary);
                }, 200);
            }
        });
    });
    visibleRangeDisposables.push(visibleEditorsDisposable);

    // 监听光标变化，点击页面时也刷新装饰
    const selectionDisposable = vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor && vocabulary) {
            renderCachedDecorations(event.textEditor); // 先用缓存渲染
            setTimeout(() => {
                applyMotherTongueDecorations(event.textEditor, vocabulary);
            }, 200);
        }
    });
    visibleRangeDisposables.push(selectionDisposable);
}

// 清理指定文档的所有旧版本标识符缓存
function clearIdentifierCacheForDocument(uri: string, version: number) {
    for (const key of identifierDecorationCache.keys()) {
        if (key.startsWith(uri) && !key.endsWith(`@${version}`)) {
            identifierDecorationCache.delete(key); // 中文注释：只保留当前版本
            console.log(`[CodeLocalizer][缓存清理] 删除旧版本缓存: ${key}`);
        }
    }
}

/**
 * 提取可见区域所有标识符（返回带range的对象数组）
 */
function extractIdentifiersInRanges(document: vscode.TextDocument, visibleRanges: readonly vscode.Range[]): {text: string, range: vscode.Range}[] {
    const results: {text: string, range: vscode.Range}[] = [];
    for (const range of visibleRanges) {
        const text = document.getText(range);
        const regex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
        let match;
        let offset = document.offsetAt(range.start);
        while ((match = regex.exec(text)) !== null) {
            const identifier = match[0];
            const start = document.positionAt(offset + match.index);
            const end = document.positionAt(offset + match.index + identifier.length);
            results.push({ text: identifier, range: new vscode.Range(start, end) });
        }
    }
    return results;
}

/**
 * 为单个标识符生成装饰对象
 */
async function createDecorationForIdentifier(id: {text: string, range: vscode.Range}, vocabulary: Vocabulary): Promise<vscode.DecorationOptions> {
    // 复用已有的翻译和高亮逻辑
    let translated = handleCompoundIdentifier(id.text, vocabulary, getTranslation);
    if (!translated) translated = id.text;
    return {
        range: id.range,
        renderOptions: {
            after: {
                contentText: formatTranslatedIdentifier(translated, id.text),
                color: getSyntaxColor(id.text, vscode.window.activeTextEditor?.document ?? null, id.range.start),
                margin: calculateMarginOffset(id.text, translated),
                textDecoration: 'none; position: relative; z-index: 10; white-space: pre;'
            }
        },
        hoverMessage: new vscode.MarkdownString(`**原始标识符**: \`${id.text}\`\n\n**母语翻译**: ${formatTranslatedIdentifier(translated, id.text)}`)
    };
}

/**
 * 获取全局唯一的装饰类型
 */
function getDecorationType(): vscode.TextEditorDecorationType {
    if (!activeDecorations[0]) {
        activeDecorations[0] = vscode.window.createTextEditorDecorationType({
            color: 'transparent',
            textDecoration: 'none; position: relative; z-index: 1;',
            letterSpacing: '0px',
            opacity: '0',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
    }
    return activeDecorations[0];
}