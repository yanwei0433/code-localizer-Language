// 黑名单管理模块，处理JSON格式的黑名单配置
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 黑名单数据接口
export interface BlacklistData {
    technicalTerms: string[];
    ignoreList: string[];
    meaningfulShortWords: string[];
    pythonKeywords: string[];
    customBlacklist: string[];
    techSuffixes?: string[];
    commonAbbr?: string[];
}

// 默认黑名单文件名
const DEFAULT_BLACKLIST_FILENAME = 'blacklist.json';

/**
 * 获取黑名单文件路径
 * @param context VS Code扩展上下文
 * @returns 黑名单文件的完整路径
 */
function getBlacklistPath(context: vscode.ExtensionContext): string {
    // 使用全局存储目录保存黑名单文件
    return path.join(context.globalStorageUri.fsPath, DEFAULT_BLACKLIST_FILENAME);
}

/**
 * 从JSON文件加载黑名单数据
 * @param context VS Code扩展上下文
 * @returns 黑名单数据
 */
export async function loadBlacklist(context: vscode.ExtensionContext): Promise<BlacklistData> {
    try {
        // 获取黑名单文件路径
        const blacklistPath = getBlacklistPath(context);
        
        // 确保全局存储目录存在
        await ensureDirectoryExists(path.dirname(blacklistPath));
        
        // 检查黑名单文件是否存在
        if (!fs.existsSync(blacklistPath)) {
            // 如果不存在，复制默认黑名单
            await copyDefaultBlacklist(context);
        }
        
        // 读取黑名单文件
        const data = fs.readFileSync(blacklistPath, 'utf-8');
        const blacklist = JSON.parse(data) as BlacklistData;
        
        console.log(`[CodeLocalizer] 已加载黑名单，包含 ${blacklist.technicalTerms.length} 个技术术语和 ${blacklist.customBlacklist.length} 个自定义黑名单项`);
        
        return blacklist;
    } catch (error) {
        console.error(`[CodeLocalizer] 加载黑名单失败:`, error);
        
        // 出错时返回一个空的黑名单数据，不再依赖 getDefaultBlacklist()
        return {
            technicalTerms: [],
            ignoreList: [],
            meaningfulShortWords: [],
            pythonKeywords: [],
            customBlacklist: []
        };
    }
}

/**
 * 确保目录存在，如果不存在则创建
 * @param directory 目录路径
 */
async function ensureDirectoryExists(directory: string): Promise<void> {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
}

/**
 * 将默认黑名单复制到全局存储目录
 * @param context VS Code扩展上下文
 */
async function copyDefaultBlacklist(context: vscode.ExtensionContext): Promise<void> {
    try {
        // 获取默认黑名单路径（扩展目录下的blacklist.json）
        const defaultBlacklistPath = path.join(context.extensionPath, DEFAULT_BLACKLIST_FILENAME);
        const targetPath = getBlacklistPath(context);
        
        // 如果默认黑名单文件存在，则复制
        if (fs.existsSync(defaultBlacklistPath)) {
            const data = fs.readFileSync(defaultBlacklistPath, 'utf-8');
            fs.writeFileSync(targetPath, data);
            console.log(`[CodeLocalizer] 已复制默认黑名单到 ${targetPath}`);
        } else {
            // 如果默认黑名单文件不存在，则不再创建一个新的，只记录警告。
            console.warn(`[CodeLocalizer] 插件内置默认黑名单文件不存在: ${defaultBlacklistPath}。将不会创建新的默认黑名单文件。`);
        }
    } catch (error) {
        console.error(`[CodeLocalizer] 复制默认黑名单失败:`, error);
        throw error;
    }
}

/**
 * 保存黑名单数据到JSON文件
 * @param context VS Code扩展上下文
 * @param blacklist 黑名单数据
 */
export async function saveBlacklist(context: vscode.ExtensionContext, blacklist: BlacklistData): Promise<void> {
    try {
        const blacklistPath = getBlacklistPath(context);
        await ensureDirectoryExists(path.dirname(blacklistPath));
        
        // 格式化JSON数据，使用2个空格缩进
        const data = JSON.stringify(blacklist, null, 2);
        fs.writeFileSync(blacklistPath, data);
        
        console.log(`[CodeLocalizer] 已保存黑名单到 ${blacklistPath}`);
    } catch (error) {
        console.error(`[CodeLocalizer] 保存黑名单失败:`, error);
        throw error;
    }
}

/**
 * 获取使用给定黑名单的Set对象
 * @param blacklist 黑名单数据
 * @returns 技术术语黑名单集合
 */
export function getTermsSet(blacklist: BlacklistData): Set<string> {
    return new Set([...blacklist.technicalTerms, ...blacklist.customBlacklist]);
}

/**
 * 从黑名单中获取忽略列表集合
 * @param blacklist 黑名单数据
 * @returns 忽略列表集合
 */
export function getIgnoreSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.ignoreList);
}

/**
 * 从黑名单中获取有意义的短词集合
 * @param blacklist 黑名单数据
 * @returns 有意义短词集合
 */
export function getMeaningfulShortWordsSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.meaningfulShortWords);
}

/**
 * 从黑名单中获取Python关键词集合
 * @param blacklist 黑名单数据
 * @returns Python关键词集合
 */
export function getPythonKeywordsSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.pythonKeywords);
}

/**
 * 添加术语到自定义黑名单
 * @param context VS Code扩展上下文
 * @param term 要添加的术语
 */
export async function addTermToCustomBlacklist(context: vscode.ExtensionContext, term: string): Promise<void> {
    try {
        // 加载当前黑名单
        const blacklist = await loadBlacklist(context);
        
        // 检查是否已存在
        if (blacklist.customBlacklist.includes(term)) {
            console.log(`[CodeLocalizer] 术语 "${term}" 已存在于自定义黑名单中`);
            return;
        }
        
        // 添加新术语
        blacklist.customBlacklist.push(term);
        
        // 保存更新后的黑名单
        await saveBlacklist(context, blacklist);
        
        console.log(`[CodeLocalizer] 术语 "${term}" 已添加到自定义黑名单`);
    } catch (error) {
        console.error(`[CodeLocalizer] 添加术语到自定义黑名单失败:`, error);
        throw error;
    }
}

/**
 * 从自定义黑名单中移除术语
 * @param context VS Code扩展上下文
 * @param term 要移除的术语
 */
export async function removeTermFromCustomBlacklist(context: vscode.ExtensionContext, term: string): Promise<void> {
    try {
        // 加载当前黑名单
        const blacklist = await loadBlacklist(context);
        
        // 查找术语索引
        const index = blacklist.customBlacklist.indexOf(term);
        
        // 如果找不到，直接返回
        if (index === -1) {
            console.log(`[CodeLocalizer] 术语 "${term}" 不在自定义黑名单中`);
            return;
        }
        
        // 移除术语
        blacklist.customBlacklist.splice(index, 1);
        
        // 保存更新后的黑名单
        await saveBlacklist(context, blacklist);
        
        console.log(`[CodeLocalizer] 术语 "${term}" 已从自定义黑名单中移除`);
    } catch (error) {
        console.error(`[CodeLocalizer] 从自定义黑名单移除术语失败:`, error);
        throw error;
    }
}

/**
 * 打开黑名单文件进行编辑
 * @param context VS Code扩展上下文
 */
export async function openBlacklistForEditing(context: vscode.ExtensionContext): Promise<void> {
    try {
        // 确保黑名单文件存在
        const blacklistPath = getBlacklistPath(context);
        
        if (!fs.existsSync(blacklistPath)) {
            await copyDefaultBlacklist(context);
        }
        
        // 打开文件
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(blacklistPath));
        await vscode.window.showTextDocument(document);
        
        // 提示用户
        vscode.window.showInformationMessage('黑名单文件已打开，编辑后保存即可生效');
    } catch (error) {
        console.error(`[CodeLocalizer] 打开黑名单文件失败:`, error);
        vscode.window.showErrorMessage(`打开黑名单文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 获取技术后缀集合
 * @param blacklist 黑名单数据
 * @returns 技术后缀Set
 */
export function getTechSuffixesSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.techSuffixes || []);
}

/**
 * 获取常见技术缩写集合
 * @param blacklist 黑名单数据
 * @returns 常见技术缩写Set
 */
export function getCommonAbbrSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.commonAbbr || []);
} 