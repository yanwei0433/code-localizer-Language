// 翻译器模块，处理LLM翻译逻辑
import * as vscode from 'vscode';
import { TranslationRequest, TranslationResponse, VocabularyEntryType, TranslationQuality } from '../types';
import * as util from 'util';
import * as child_process from 'child_process';
import * as http from 'http'; // 用于Ollama API
import * as https from 'https'; // 支持HTTPS
import {
  splitCamelCase,
  processUnderscoreIdentifier,
  processCamelCaseIdentifier,
  processCppIdentifier,
  defaultIsLikelyMeaningfulIdentifier,
  isTechnicalTerm,
  isTechnicalValue,
  normalizeWord,
  isPathOrUrl,
  getStem,
  isSameWordRoot,
  validateTranslationMatch,
  findTranslationIgnoreCase,
  handleCompoundIdentifier
} from '../extraction/word-utils';

const exec = util.promisify(child_process.exec);

// 翻译缓存，用于减少重复调用LLM的次数
const translationCache: Map<string, string> = new Map();

// --- Simulation Functions (defined first) ---
function simulateTranslateItem(item: string, isIdentifier: boolean): string {
    if (isIdentifier) {
        // 创建一个映射，只在全词匹配时进行替换
        const wordMap: Record<string, string> = {
            'file': '文件',
            'path': '路径',
            'content': '内容',
            'analyze': '分析',
            'data': '数据',
            'name': '名称',
            'value': '值',
            'type': '类型',
            'use': '使用'
        };
        
        // 检查是否进行全词匹配（使用正则表达式的\b边界匹配）
        for (const [eng, chn] of Object.entries(wordMap)) {
            // 创建一个正则表达式用于全词匹配
            const regex = new RegExp(`\\b${eng}\\b`, 'i');
            if (regex.test(item)) {
                return item.replace(new RegExp(`\\b${eng}\\b`, 'g'), chn);
            }
        }
        
        // 如果没有匹配项，返回原始标识符
        return `${item}`;
    } else {
        return `${item} (已翻译)`;
    }
}

function simulateTranslationBatch(items: string[], isIdentifier: boolean): { original: string, translated: string }[] {
    console.log(`[CodeLocalizer] 使用模拟翻译处理 ${items.length} 个项目。`);
    return items.map(item => ({
        original: item,
        translated: simulateTranslateItem(item, isIdentifier)
    }));
}

export function simulateTranslation(request: TranslationRequest): TranslationResponse {
    const isIdentifier = request.type === 'identifier';
    const translations = request.items.map(item => {
        return {
            original: item,
            translated: simulateTranslateItem(item, isIdentifier)
        };
    });
        return { translations };
}

// --- New Helper Function for Cache Handling ---
function prepareItemsForTranslationBatch(
    items: string[],
    isIdentifier: boolean,
    targetLanguage?: string // 为Ollama API添加targetLanguage到缓存键
): { itemsNeedTranslation: string[], cachedTranslations: { original: string, translated: string }[] } {
    const itemsNeedTranslation: string[] = [];
    const cachedTranslations: { original: string, translated: string }[] = [];

    for (const item of items) {
        const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${item}${targetLanguage ? `-${targetLanguage}` : ''}`;
        if (translationCache.has(cacheKey)) {
            cachedTranslations.push({
                original: item,
                translated: translationCache.get(cacheKey)!
            });
            console.log(`[CodeLocalizer] 缓存命中: ${item} -> ${translationCache.get(cacheKey)}`);
        } else {
            itemsNeedTranslation.push(item);
        }
    }

    return { itemsNeedTranslation, cachedTranslations };
}

// --- Translation Batch Functions ---
async function translateBatchWithCli(
    items: string[], 
    isIdentifier: boolean, 
    llmPath: string, 
    llmParams?: string,
    targetLanguage: string = 'zh-CN'
): Promise<{original: string, translated: string}[]> {
    // 使用新的辅助函数处理缓存
    const { itemsNeedTranslation, cachedTranslations } = prepareItemsForTranslationBatch(items, isIdentifier);

    // 如果所有项目都在缓存中找到，则直接返回缓存结果
    if (itemsNeedTranslation.length === 0) {
        console.log(`[CodeLocalizer] 所有项目(${items.length}个)均从缓存中获取翻译`);
        return cachedTranslations;
    }
    
    console.log(`[CodeLocalizer CLI] 翻译批次，项数: ${itemsNeedTranslation.length}，缓存命中: ${cachedTranslations.length}`);

    const languageName = getLanguageName(targetLanguage);

    // Unified prompt structure
    let prompt = isIdentifier 
        ? `Please translate the following programming identifiers into ${languageName}, keeping them professional and concise. Consider the industry context for accurate translations. If an identifier is not suitable for translation (e.g., technical abbreviations, already meaningful in ${languageName}), set its translated field to be the same as the original. Do not include non-word items. Here are the identifiers to translate:\n` + 
          itemsNeedTranslation.map(item => `- "${item.replace(/"/g, '\\"')}"`).join('\n') + 
          `\n\nPlease return the translation results directly in JSON format, without any other content, in the format: {"original": "translation"}.`
        : `Please translate the following programming comments into ${languageName}, keeping them professional and accurate. Consider the industry context for accurate translations. If a comment contains elements not suitable for translation (e.g., technical terms, code snippets), preserve them in the original form. Here are the comments to translate:\n` + 
          itemsNeedTranslation.map(item => `- "${item.replace(/"/g, '\\"')}"`).join('\n') + 
          `\n\nPlease return the translation results directly in JSON format, without any other content, in the format: {"original": "translation"}.`;
    
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"'); 
        const cmd = `"${llmPath}" ${llmParams || ''} "${escapedPrompt}"`;

        console.log(`[CodeLocalizer CLI] 执行LLM命令 (first 100 chars): ${cmd.substring(0, 100)}...`);
        const { stdout, stderr } = await exec(cmd, { timeout: 30000 });
        
        if (stderr) {
            console.error(`[CodeLocalizer CLI] LLM stderr: \n--- STDERR START ---\n${stderr}\n--- STDERR END ---`);
        }
        
        if (stdout) {
            console.log(`[CodeLocalizer CLI] LLM原始输出 (stdout) (first 200 chars): \n--- STDOUT START ---\n${stdout.substring(0,200)}\n--- STDOUT END ---`);
            const jsonMatch = stdout.match(/({[\s\S]*})/);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    const llmRawOutput = JSON.parse(jsonMatch[1]);
                    const translationsFromLLM: { [key: string]: string } = llmRawOutput; // Expecting flat JSON: {"original": "translated"}
                    
                    const newTranslations: { original: string, translated: string }[] = [];
                    let genuinelyTranslatedCount = 0;

                    itemsNeedTranslation.forEach(original => {
                        const translatedText = translationsFromLLM[original];
                        if (typeof translatedText === 'string' && translatedText.trim() !== '') {
                            newTranslations.push({ original, translated: translatedText });
                            if (original !== translatedText) {
                                genuinelyTranslatedCount++;
                            }
                            const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${original}-${targetLanguage}`;
                            translationCache.set(cacheKey, translatedText);
                        } else {
                            newTranslations.push({ original, translated: original }); // Fallback to original
                            console.warn(`[CodeLocalizer CLI] 模型未对 "${original}" 提供有效翻译，使用原文。`);
                        }
                    });

                    console.log(`[CodeLocalizer CLI] 从LLM获得 ${Object.keys(translationsFromLLM).length} 个键值对，有效翻译 ${genuinelyTranslatedCount} / ${itemsNeedTranslation.length} 个新项目。`);
                    
                    // 合并缓存结果和新翻译结果
                    return [...cachedTranslations, ...newTranslations];
                } catch (parseError) {
                    console.error(`[CodeLocalizer CLI] 解析LLM CLI 输出JSON出错:`, parseError);
                    return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
                }
            } else {
                console.error(`[CodeLocalizer CLI] 无法从LLM CLI 输出中提取JSON`);
                return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
            }
        } else {
            console.error(`[CodeLocalizer CLI] LLM CLI 没有输出`);
            return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
        }
    } catch (execError) {
        console.error(`[CodeLocalizer CLI] 执行LLM CLI 命令出错:`, execError);
        return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
    }
}

// 从Ollama获取可用模型列表
export async function getOllamaModels(ollamaApiUrl: string = 'http://localhost:11434'): Promise<string[]> {
    try {
        const apiUrlObj = new URL(ollamaApiUrl);
        const protocol = apiUrlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: apiUrlObj.hostname,
            port: apiUrlObj.port || (apiUrlObj.protocol === 'https:' ? 443 : 80),
            path: '/api/tags',
            method: 'GET'
        };

        return new Promise((resolve) => {
            const req = protocol.request(options, (res) => {
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(data);
                            if (response.models && Array.isArray(response.models)) {
                                const modelNames = response.models.map((model: any) => model.name);
                                console.log(`[CodeLocalizer] 从Ollama获取到${modelNames.length}个模型: ${modelNames.join(', ')}`);
                                resolve(modelNames);
                                return;
                            }
                        } catch (parseError) {
                            console.error('[CodeLocalizer] 解析Ollama模型列表出错:', parseError);
                        }
                    } else {
                        console.error(`[CodeLocalizer] 获取Ollama模型列表失败，状态码: ${res.statusCode}`);
                    }
                    resolve([]); // 出错时返回空数组
                });
            });
            
            req.on('error', (e) => {
                console.error(`[CodeLocalizer] 请求Ollama模型列表出错:`, e);
                resolve([]);
            });
            
            req.end();
        });
    } catch (error) {
        console.error(`[CodeLocalizer] 获取Ollama模型列表时发生错误:`, error);
        return [];
    }
}

// 计算最优批量大小，根据条目类型和长度进行自适应调整
function calculateOptimalBatchSize(items: string[], type: VocabularyEntryType): number {
    if (items.length <= 5) {
        return items.length; // 对于少量条目，直接处理全部
    }

    // 计算平均长度
    const avgLength = items.reduce((sum, item) => sum + item.length, 0) / items.length;
    
    // 根据条目类型和长度特征决定批量大小
    if (type === 'identifier') {
        // 标识符通常较短，可以批量处理更多
        if (avgLength < 10) {
            return Math.min(40, items.length); // 短标识符
        } else if (avgLength < 20) {
            return Math.min(30, items.length); // 中等长度标识符
        } else {
            return Math.min(20, items.length); // 长标识符
        }
    } else {
        // 注释通常较长，需要更小的批量
        if (avgLength < 50) {
            return Math.min(15, items.length); // 短注释
        } else if (avgLength < 100) {
            return Math.min(8, items.length); // 中等长度注释
        } else {
            return Math.min(5, items.length); // 长注释
        }
    }
}

// 串行处理翻译批次，每个批次完成后可回调
async function processInSequence<T, R>(
    items: T[],
    getBatchSize: (remainingItems: T[]) => number,
    processFn: (batch: T[]) => Promise<R[]>,
    progressCallback?: (completed: number, total: number, batchResults: R[]) => void
): Promise<R[]> {
    const results: R[] = [];
    let completed = 0;
    const total = items.length;
    
    // 串行处理批次，动态调整批次大小
    let remainingItems = [...items];
    
    while (remainingItems.length > 0) {
        // 动态计算下一批次的大小
        const batchSize = getBatchSize(remainingItems);
        const batch = remainingItems.slice(0, batchSize);
        remainingItems = remainingItems.slice(batchSize);
        
        try {
            // 处理当前批次
            const batchResults = await processFn(batch);
            results.push(...batchResults);
            completed += batch.length;
            
            // 进度回调
            if (progressCallback) {
                progressCallback(completed, total, batchResults);
            }
        } catch (error) {
            console.error('[CodeLocalizer] 批次处理失败:', error);
            // 出错时，可能需要减小批次大小重试，这里简化处理
            if (batch.length > 1) {
                // 将失败的批次重新放回队列，但用更小的批次尝试
                remainingItems = [...batch.slice(1), ...remainingItems];
                
                // 当前批次的第一个元素单独处理
                try {
                    const singleResult = await processFn([batch[0]]);
                    results.push(...singleResult);
                    completed += 1;
                    
                    if (progressCallback) {
                        progressCallback(completed, total, singleResult);
                    }
                } catch (innerError) {
                    console.error('[CodeLocalizer] 单条目处理失败:', innerError);
                    // 即使单个条目也失败了，增加计数以避免无限循环
                    completed += 1;
                }
            } else {
                // 单条目处理失败，计数增加避免无限循环
                completed += batch.length;
            }
        }
    }
    
    return results;
}

// 评估翻译质量
function evaluateTranslationQuality(originals: string[], translations: {original: string, translated: string}[]): {
    genuinelyTranslatedCount: number,
    qualityScore: number,
    issues: {original: string, translated: string, issue: string}[]
} {
    let genuinelyTranslatedCount = 0;
    const issues: {original: string, translated: string, issue: string}[] = [];
    
    // 翻译集合映射，便于查找
    const translationMap = new Map<string, string>();
    translations.forEach(t => translationMap.set(t.original, t.translated));
    
    // 检查每个原始条目
    for (const original of originals) {
        const translated = translationMap.get(original);
        
        // 检查是否缺失
        if (!translated) {
            issues.push({
                original,
                translated: original, // 默认使用原文
                issue: '未被翻译'
            });
            continue;
        }
        
        // 检查是否有效翻译（不同于原文）
        if (translated !== original) {
            genuinelyTranslatedCount++;
            
            // 进行简单的质量检查
            if (translated.length < original.length * 0.5 && original.length > 10) {
                issues.push({
                    original,
                    translated,
                    issue: '疑似翻译不完整'
                });
            } else if (/^[a-zA-Z0-9_\s]+$/.test(translated) && original.length > 5) {
                issues.push({
                    original,
                    translated,
                    issue: '疑似未翻译成目标语言'
                });
            }
        } else {
            // 与原文相同，不算有效翻译
            issues.push({
                original,
                translated,
                issue: '译文与原文相同'
            });
        }
    }
    
    // 计算整体质量分数 (0-1)
    const qualityScore = genuinelyTranslatedCount / originals.length;
    
    return {
        genuinelyTranslatedCount,
        qualityScore,
        issues
    };
}

// 简化的提示词模板
function getSimplePromptForOllama(
    items: string[],
    isIdentifier: boolean,
    targetLanguage: string
): { system: string, userPrompt: string } {
    const languageName = getLanguageName(targetLanguage);
    
    // 简化的系统提示
    const systemPrompt = isIdentifier 
        ? `Please translate programming identifiers into ${languageName}, maintaining professionalism and conciseness. Consider the industry context for accurate translations. 

If an identifier is not suitable for translation (e.g., technical abbreviations, already meaningful in ${languageName}), set its translated field to be the same as the original. 

Please filter out meaningless identifiers such as:
- Single letters or very short abbreviations without context
- Common programming language keywords that don't need translation
- File extensions and technical abbreviations
- Grammatical suffixes and prefixes that don't stand alone
- Non-words or random character combinations

Do not include non-word items or items with no meaningful translation value. Return the JSON format where the key is the original identifier and the value is the translation.`
        : `Please translate programming comments into ${languageName}, maintaining professionalism and accuracy. Consider the industry context for accurate translations. If a comment contains elements not suitable for translation (e.g., technical terms, code snippets), preserve them in the original form. Return the JSON format where the key is the original comment and the value is the translation.`;
    
    // Simplified user prompt
    const userPrompt = `Here are the ${isIdentifier ? 'identifiers' : 'comments'} to translate:\n` + 
                      items.map(item => `- "${item.replace(/"/g, '\\"')}"`).join('\n') + 
                      `\n\nPlease return the translation results directly in JSON format, without any other content.`;
    
    return { system: systemPrompt, userPrompt };
}

// --- Main Exported Function ---
export async function translateWithLocalLLM(request: TranslationRequest): Promise<TranslationResponse> {
    // 获取 LLM 配置
    const config = vscode.workspace.getConfiguration('codeLocalizer');
    const provider = config.get<string>('translationService.provider', 'ollamaApi');
    const ollamaApiUrl = config.get<string>('translationService.ollamaApiUrl', 'http://localhost:11434');
    const ollamaModelName = config.get<string>('translationService.ollamaModelName', 'gemma3:4b');
    const llmPath = config.get<string>('translationService.llmPath', '');
    const llmParams = config.get<string>('translationService.llmParams', '');

    let translations: { original: string, translated: string }[] = [];
    let genuinelyTranslatedCount = 0;
    let totalCount = request.items.length;
    let issues: { original: string, translated: string, issue: string }[] = [];

    try {
        if (provider === 'ollamaApi') {
            translations = await translateBatchWithOllamaApi(
                request.items,
                request.type === 'identifier',
                ollamaApiUrl,
                ollamaModelName,
                request.targetLanguage || 'zh-CN'
            );
        } else {
            translations = await translateBatchWithCli(
                request.items,
                request.type === 'identifier',
                llmPath,
                llmParams,
                request.targetLanguage || 'zh-CN'
            );
        }

        genuinelyTranslatedCount = translations.filter(t => t.original !== t.translated).length;
    } catch (error) {
        issues.push({ original: '', translated: '', issue: '本地LLM调用失败: ' + (error instanceof Error ? error.message : String(error)) });
        // 回退为原文
        translations = request.items.map(item => ({ original: item, translated: item }));
    }

    return {
        translations,
        quality: {
            score: genuinelyTranslatedCount / (totalCount || 1),
            genuinelyTranslatedCount,
            totalCount,
            issues
        }
    };
}

// Ollama批次翻译函数
async function translateBatchWithOllamaApi(
    items: string[],
    isIdentifier: boolean,
    ollamaApiUrl: string,
    ollamaModelName: string,
    targetLanguage: string = 'zh-CN'
): Promise<{original: string, translated: string}[]> {
    const { itemsNeedTranslation, cachedTranslations } = prepareItemsForTranslationBatch(items, isIdentifier, targetLanguage);

    if (itemsNeedTranslation.length === 0) {
        return cachedTranslations;
    }
    
    console.log(`[CodeLocalizer Ollama] 翻译批次，待翻译项数: ${itemsNeedTranslation.length}，缓存命中项数: ${cachedTranslations.length}`);

    const { system: systemPrompt, userPrompt } = getSimplePromptForOllama(
        itemsNeedTranslation,
        isIdentifier,
        targetLanguage
    );

    if (!ollamaModelName || ollamaModelName.trim() === '') {
        console.error(`[CodeLocalizer Ollama] 未设置Ollama模型名称`);
        const untranslatedItems = itemsNeedTranslation.map(original => ({ original, translated: original }));
        return [...cachedTranslations, ...untranslatedItems];
    }
    
    console.log(`[CodeLocalizer Ollama] 使用模型: ${ollamaModelName} 翻译 ${itemsNeedTranslation.length} 个新项目到 ${getLanguageName(targetLanguage)}`);

    const payload = {
        model: ollamaModelName,
        prompt: userPrompt,
        system: systemPrompt,
        format: "json", 
        stream: false,
        options: {
            temperature: 0.1, // 降低温度以提高一致性和准确性
            num_ctx: 4096     // 增加上下文窗口，允许更大的批量处理
        }
    };
    const payloadString = JSON.stringify(payload);

    let finalResults: {original: string, translated: string}[] = [...cachedTranslations];

    try {
        const apiUrlObj = new URL(ollamaApiUrl);
        const protocol = apiUrlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: apiUrlObj.hostname,
            port: apiUrlObj.port || (apiUrlObj.protocol === 'https:' ? 443 : 80),
            path: '/api/generate', //  Ollama API endpoint
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadString)
            },
            timeout: 120000 // 增加超时时间到2分钟，适应较大批量
        };

        const responseBody = await new Promise<string>((resolve, reject) => {
            const req = protocol.request(options, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`Ollama API请求失败，状态码: ${res.statusCode}, 响应: ${data.substring(0,500)}`));
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                vscode.window.showErrorMessage(vscode.l10n.t('Ollama API请求超时。请尝试减小翻译批量或检查Ollama服务状态。'));
                reject(new Error(`Ollama API请求超时 (${options.timeout}ms)`));
            });

            req.on('error', (e) => {
                reject(new Error(`Ollama API请求错误: ${e.message}`));
            });

            req.write(payloadString);
            req.end();
        });

        console.log(`[CodeLocalizer Ollama] API响应状态码: 200 (假定成功)`); // 实际状态码已在Promise中处理
        const ollamaResponse = JSON.parse(responseBody);
        const llmJsonOutputString = ollamaResponse.response || responseBody; 

        if (llmJsonOutputString) {
            try {
                const translationsFromLLM = JSON.parse(llmJsonOutputString);
                let genuinelyTranslatedCount = 0;

                itemsNeedTranslation.forEach(original => {
                    const translatedText = translationsFromLLM[original];
                    if (typeof translatedText === 'string' && translatedText.trim() !== '') {
                        finalResults.push({ original, translated: translatedText });
                        if (original !== translatedText) {
                            genuinelyTranslatedCount++;
                        }
                        const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${original}-${targetLanguage}`;
                        translationCache.set(cacheKey, translatedText);
                    } else {
                        finalResults.push({ original, translated: original });
                        console.warn(`[CodeLocalizer Ollama] 模型未对 "${original}" 提供有效翻译，使用原文。`);
                    }
                });

                console.log(`[CodeLocalizer Ollama] 从LLM获得 ${Object.keys(translationsFromLLM).length} 个键值对，有效翻译 ${genuinelyTranslatedCount} / ${itemsNeedTranslation.length} 个新项目。`);

                const translationThreshold = itemsNeedTranslation.length <= 5 ? 0.3 : 
                                             itemsNeedTranslation.length <= 15 ? 0.4 : 0.5;
                const minimumItemsForThreshold = 5;

                if (itemsNeedTranslation.length >= minimumItemsForThreshold &&
                    (genuinelyTranslatedCount / itemsNeedTranslation.length) < translationThreshold) {
                    
                    const msg = vscode.l10n.t(
                        "LLM仅翻译了 {0} / {1} 个新条目 ({2}%). 翻译质量不佳。",
                        genuinelyTranslatedCount,
                        itemsNeedTranslation.length,
                        Math.round((genuinelyTranslatedCount / itemsNeedTranslation.length) * 100)
                    );
                    console.warn(`[CodeLocalizer Ollama] ${msg}`);
                }

            } catch (innerParseError) {
                console.error('[CodeLocalizer Ollama] 解析LLM返回的JSON内容失败:', innerParseError, '\\nLLM JSON输出字符串:', llmJsonOutputString.substring(0, 500));
                // 解析失败，回退为原文
                itemsNeedTranslation.forEach(original => {
                    if (!finalResults.find(fr => fr.original === original)) {
                       finalResults.push({ original, translated: original });
                    }
                });
            }
        } else {
            console.error('[CodeLocalizer Ollama] Ollama响应中缺少 "response" 字段或响应体为空。');
            // 响应体为空，回退为原文
            itemsNeedTranslation.forEach(original => {
                if (!finalResults.find(fr => fr.original === original)) {
                   finalResults.push({ original, translated: original });
                }
            });
        }
    } catch (error) { 
        console.error(`[CodeLocalizer Ollama] 调用Ollama API时发生顶层错误:`, error);
        // 顶层错误（如网络问题，非200状态码等），回退为原文
        itemsNeedTranslation.forEach(original => {
            if (!finalResults.find(fr => fr.original === original)) {
               finalResults.push({ original, translated: original });
            }
        });
    }
    return finalResults;
}

// 获取语言的显示名称
export function getLanguageName(targetLanguage: string): string {
    switch (targetLanguage) {
        case 'zh-CN': return '简体中文';
        case 'zh-TW': return '繁体中文';
        case 'en': return '英语';
        case 'ja': return '日语';
        case 'ko': return '韩语';
        case 'fr': return '法语';
        case 'de': return '德语';
        case 'es': return '西班牙语';
        case 'pt-BR': return '葡萄牙语（巴西）';
        case 'ru': return '俄语';
        case 'it': return '意大利语';
        case 'tr': return '土耳其语';
        default: return targetLanguage;
    }
} 