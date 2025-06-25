import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { ContributionItem, ContributionRequest, ContributionResponse, ContributionStats, ContributionPrivacyLevel } from '../types';

// 存储键
const CONTRIBUTION_QUEUE_KEY = 'contributionQueue';
const CONTRIBUTION_STATS_KEY = 'contributionStats';

/**
 * 获取贡献配置
 */
export function getContributionConfig() {
    const config = vscode.workspace.getConfiguration('codeLocalizer');
    return {
        enabled: config.get<boolean>('enableAutomaticContribution') || true,
        contributor: config.get<string>('contributorName') || '匿名用户',
        privacyLevel: config.get<string>('contributionPrivacyLevel') || ContributionPrivacyLevel.GENERAL_ONLY,
        batchSize: config.get<number>('contributionBatchSize') || 50,
        endpoint: config.get<string>('contributionEndpoint') || 'https://api.code-localizer.example.com/contributions'
    };
}

/**
 * 将翻译项加入提交队列
 * @param context VS Code扩展上下文
 * @param items 贡献项列表
 */
export async function queueTranslationContribution(
    context: vscode.ExtensionContext,
    items: ContributionItem[]
): Promise<void> {
    try {
        // 检查是否启用自动提交
        const config = getContributionConfig();
        if (!config.enabled) {
            console.log('[CodeLocalizer] 自动贡献功能已禁用，跳过队列添加');
            return;
        }
        
        // 根据隐私级别过滤项目
        const filteredItems = filterByPrivacyLevel(items, config.privacyLevel);
        if (filteredItems.length === 0) {
            console.log('[CodeLocalizer] 过滤后没有符合隐私要求的项目，跳过队列添加');
            return;
        }
        
        // 获取现有队列
        const contributionQueue = context.globalState.get<ContributionItem[]>(CONTRIBUTION_QUEUE_KEY) || [];
        
        // 合并新项目到队列，注意去重
        const existingOriginals = new Set(contributionQueue.map(item => `${item.type}:${item.original}`));
        const newItems = filteredItems.filter(item => 
            !existingOriginals.has(`${item.type}:${item.original}`)
        );
        
        if (newItems.length === 0) {
            console.log('[CodeLocalizer] 所有项目都已在队列中，跳过队列添加');
            return;
        }
        
        // 更新队列
        const updatedQueue = [...contributionQueue, ...newItems];
        await context.globalState.update(CONTRIBUTION_QUEUE_KEY, updatedQueue);
        
        console.log(`[CodeLocalizer] 成功添加 ${newItems.length} 个项目到贡献队列，当前队列大小: ${updatedQueue.length}`);
        
        // 更新统计信息
        updateContributionStats(context, { queue_size: updatedQueue.length });
        
        // 检查队列大小决定是否立即提交
        if (updatedQueue.length >= config.batchSize) {
            console.log(`[CodeLocalizer] 队列达到批量大小 ${config.batchSize}，尝试提交`);
            await processContributionQueue(context);
        }
    } catch (error) {
        console.error('[CodeLocalizer] 将项目加入贡献队列时出错:', error);
    }
}

/**
 * 根据隐私级别过滤项目
 * @param items 原始项目
 * @param privacyLevel 隐私级别
 */
function filterByPrivacyLevel(
    items: ContributionItem[], 
    privacyLevel: string
): ContributionItem[] {
    // 基本项目直接返回，不需要过滤
    if (privacyLevel === ContributionPrivacyLevel.ALL) {
        return items;
    }
    
    // 通用过滤，排除特定于项目的标识符（通常较长或具有特定前缀）
    if (privacyLevel === ContributionPrivacyLevel.GENERAL_ONLY) {
        return items.filter(item => {
            // 对于标识符，过滤掉过长或明显是项目特定的
            if (item.type === 'identifier') {
                const isLikelyGeneral = 
                    item.original.length < 30 && // 不太长
                    !item.original.includes('_') && // 不包含下划线（通常是项目特定的）
                    !/^[a-z][A-Z]/.test(item.original) && // 不是项目特定的驼峰命名
                    !/_[a-z]{2,}_/.test(item.original); // 不包含特定格式
                return isLikelyGeneral;
            }
            // 对于注释，只允许简短的单行注释
            if (item.type === 'comment') {
                return item.original.length < 100 && !item.original.includes('\n');
            }
            return false;
        });
    }
    
    // 最小化提交，只包含最基本的编程术语
    if (privacyLevel === ContributionPrivacyLevel.MINIMAL) {
        return items.filter(item => {
            // 只提交简短的标识符，过滤所有注释
            if (item.type === 'identifier') {
                return item.original.length < 15 && 
                       !item.original.includes('_') &&
                       !/[A-Z]{2,}/.test(item.original); // 不是全大写的缩写
            }
            return false; // 过滤所有注释
        });
    }
    
    return items;
}

/**
 * 更新贡献统计信息
 * @param context VS Code扩展上下文
 * @param statsUpdate 要更新的统计信息
 */
async function updateContributionStats(
    context: vscode.ExtensionContext,
    statsUpdate: Partial<ContributionStats>
): Promise<void> {
    const currentStats = context.globalState.get<ContributionStats>(CONTRIBUTION_STATS_KEY) || {
        queue_size: 0,
        submitted_count: 0
    };
    
    const updatedStats = { ...currentStats, ...statsUpdate };
    await context.globalState.update(CONTRIBUTION_STATS_KEY, updatedStats);
}

/**
 * 获取贡献统计信息
 * @param context VS Code扩展上下文
 */
export function getContributionStats(
    context: vscode.ExtensionContext
): ContributionStats {
    return context.globalState.get<ContributionStats>(CONTRIBUTION_STATS_KEY) || {
        queue_size: 0,
        submitted_count: 0
    };
}

/**
 * 显示贡献统计信息
 * @param context VS Code扩展上下文
 */
export async function showContributionStats(
    context: vscode.ExtensionContext
): Promise<void> {
    const stats = getContributionStats(context);
    const config = getContributionConfig();
    
    // 创建输出通道
    const outputChannel = vscode.window.createOutputChannel("Code Localizer 贡献统计");
    outputChannel.clear();
    
    outputChannel.appendLine("=== 翻译贡献统计 ===");
    outputChannel.appendLine("");
    outputChannel.appendLine(`自动贡献功能: ${config.enabled ? '已启用' : '已禁用'}`);
    outputChannel.appendLine(`贡献者名称: ${config.contributor}`);
    outputChannel.appendLine(`隐私保护级别: ${config.privacyLevel}`);
    outputChannel.appendLine("");
    outputChannel.appendLine(`当前队列中项目数: ${stats.queue_size}`);
    outputChannel.appendLine(`已提交项目总数: ${stats.submitted_count}`);
    
    if (stats.last_submitted) {
        outputChannel.appendLine(`上次提交时间: ${stats.last_submitted}`);
    }
    
    if (stats.contributor_stats) {
        outputChannel.appendLine("");
        outputChannel.appendLine("=== 贡献者统计 ===");
        outputChannel.appendLine(`总贡献数: ${stats.contributor_stats.total_contributions}`);
        
        if (stats.contributor_stats.rank) {
            outputChannel.appendLine(`社区排名: ${stats.contributor_stats.rank}`);
        }
        
        outputChannel.appendLine(`贡献积分: ${stats.contributor_stats.contribution_score}`);
    }
    
    outputChannel.appendLine("");
    outputChannel.appendLine("提示: 您可以在设置中修改自动贡献的配置。");
    
    outputChannel.show();
}

/**
 * 处理提交队列
 * @param context VS Code扩展上下文
 */
export async function processContributionQueue(
    context: vscode.ExtensionContext
): Promise<void> {
    const queue = context.globalState.get<ContributionItem[]>(CONTRIBUTION_QUEUE_KEY) || [];
    if (queue.length === 0) {
        console.log('[CodeLocalizer] 贡献队列为空，无需处理');
        return;
    }
    
    try {
        // 获取配置
        const config = getContributionConfig();
        if (!config.enabled) {
            console.log('[CodeLocalizer] 自动贡献功能已禁用，跳过队列处理');
            return;
        }
        
        console.log(`[CodeLocalizer] 开始处理贡献队列，共 ${queue.length} 个项目`);
        
        // 准备请求数据
        const contributionRequest: ContributionRequest = {
            items: queue,
            contributor: config.contributor,
            client_version: '0.1.0',
            session_id: context.globalState.get('sessionId') || undefined
        };
        
        // 提交到服务器
        const response = await submitContributions(contributionRequest, config.endpoint);
        
        // 更新统计信息
        const currentStats = getContributionStats(context);
        await updateContributionStats(context, {
            queue_size: 0, // 队列已清空
            submitted_count: currentStats.submitted_count + response.processed_count,
            last_submitted: new Date().toISOString(),
            contributor_stats: response.contributor_stats
        });
        
        // 清空队列
        await context.globalState.update(CONTRIBUTION_QUEUE_KEY, []);
        
        console.log(`[CodeLocalizer] 成功提交 ${response.processed_count} 个翻译项`);
        
        // 显示通知（仅在超过10项时）
        if (response.processed_count >= 10) {
            vscode.window.showInformationMessage(
                `Code Localizer: 已成功贡献 ${response.processed_count} 个翻译项到社区词汇库。感谢您的贡献！`
            );
        }
    } catch (error) {
        console.error('[CodeLocalizer] 处理贡献队列时出错:', error);
        
        // 如果是网络错误或服务器问题，保留队列以便下次尝试
        if (error instanceof Error && 
            (error.message.includes('ECONNREFUSED') || 
             error.message.includes('ETIMEDOUT') || 
             error.message.includes('status code'))) {
            console.log('[CodeLocalizer] 网络或服务器错误，保留队列以便下次尝试');
        } else {
            // 其他错误清空队列避免死循环
            await context.globalState.update(CONTRIBUTION_QUEUE_KEY, []);
            console.log('[CodeLocalizer] 由于非网络错误，已清空队列');
        }
    }
}

/**
 * 提交贡献到服务器
 * @param request 贡献请求
 * @param endpoint 服务器端点
 */
async function submitContributions(
    request: ContributionRequest,
    endpoint: string
): Promise<ContributionResponse> {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL(endpoint);
            const postData = JSON.stringify(request);
            
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': postData.length,
                    'User-Agent': 'VSCode-CodeLocalizer/0.1.0'
                }
            };
            
            // 选择http或https模块
            const requestLib = url.protocol === 'https:' ? https : http;
            
            // 10秒超时
            const req = requestLib.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const response = JSON.parse(data) as ContributionResponse;
                            resolve(response);
                        } catch (parseError: any) {
                            reject(new Error(`解析响应失败: ${parseError.message}`));
                        }
                    } else {
                        reject(new Error(`服务器返回错误状态码: ${res.statusCode}`));
                    }
                });
            });
            
            req.on('error', (e) => {
                reject(new Error(`请求失败: ${e.message}`));
            });
            
            // 设置超时
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('请求超时'));
            });
            
            // 写入数据
            req.write(postData);
            req.end();
        } catch (error) {
            reject(error);
        }
    });
} 