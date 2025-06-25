// 词汇表存储管理模块，处理词汇表保存和加载
import * as vscode from 'vscode';
import { Vocabulary, VocabularyStorageLocation } from '../types';

/**
 * 词汇表文件名规范
 * @param language 目标语言代码
 */
export function getVocabularyFilename(language: string): string {
    return `loc_core_vocabulary_${language}.json`;
}

/**
 * 受支持的语言列表
 */
export const SUPPORTED_LANGUAGES = [
    'zh-CN', // 简体中文
    'zh-TW', // 繁体中文
    'ja',    // 日语
    'ko',    // 韩语
    'ru',    // 俄语
    'fr',    // 法语
    'de',    // 德语
    'es',    // 西班牙语
    'pt-BR', // 葡萄牙语
    'it',    // 意大利语
    'tr'     // 土耳其语
];

/**
 * 用户词汇表文件名
 * @param language 目标语言
 */
export function getUserVocabularyFilename(language: string): string {
    return `user_vocabulary_${language}.json`;
}

/**
 * 项目词汇表文件名
 * @param language 目标语言
 */
export function getProjectVocabularyFilename(language: string): string {
    return `loc_core_vocabulary_${language}.json`;
}

/**
 * 确保目录存在
 * @param uri 目录URI
 */
export async function ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        try {
            await vscode.workspace.fs.createDirectory(uri);
        } catch (err) {
            console.error(`[CodeLocalizer] 创建目录失败: ${uri.fsPath}`, err);
            throw err;
        }
    }
}

/**
 * 检查文件是否存在
 * @param uri 文件URI
 */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * 获取项目词汇表路径
 * @param language 目标语言
 */
export async function getProjectVocabularyPath(language: string = 'zh-CN'): Promise<vscode.Uri | null> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        console.log('[CodeLocalizer] 无可用的工作区文件夹获取项目词汇表路径。');
        return null;
    }
    
    try {
        // 使用第一个工作区文件夹
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        
        // 在.vscode文件夹中存储词汇表
        const vscodeFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
        
        // 确保.vscode文件夹存在
        await ensureDirectory(vscodeFolderUri);
        const vocabPath = vscode.Uri.joinPath(vscodeFolderUri, getProjectVocabularyFilename(language));
        console.log(`[CodeLocalizer] DEBUG: getProjectVocabularyPath 生成路径: ${vocabPath.fsPath}`);
        return vocabPath;
    } catch (error) {
        console.error(`[CodeLocalizer] 访问项目.vscode目录失败: ${error}`);
        return null;
    }
}

/**
 * 从文件加载词汇表
 * @param uri 词汇表文件URI
 */
export async function loadVocabularyFromFile(uri: vscode.Uri): Promise<Vocabulary | null> {
    try {
        const exists = await fileExists(uri);
        if (!exists) {
            console.log(`[CodeLocalizer] 词汇表文件不存在: ${uri.fsPath}`);
            return null;
        }

        console.log(`[CodeLocalizer] 正在加载词汇表文件: ${uri.fsPath}`);
        const fileContents = await vscode.workspace.fs.readFile(uri);
        const rawText = Buffer.from(fileContents).toString('utf8');
        const vocabulary = JSON.parse(rawText) as Vocabulary;
        console.log(`[CodeLocalizer] 成功加载词汇表: ${uri.fsPath}`);
        return vocabulary;
    } catch (error) {
        console.error(`[CodeLocalizer] 加载词汇表文件失败: ${uri.fsPath}`, error);
        return null;
    }
}

/**
 * 保存词汇表到文件
 * @param uri 目标文件URI
 * @param vocabulary 词汇表数据
 */
export async function saveVocabularyToFile(uri: vscode.Uri, vocabulary: Vocabulary): Promise<boolean> {
    try {
        // 确保父目录存在
        const parentUri = vscode.Uri.joinPath(uri, '..');
        await ensureDirectory(parentUri);
        
        // 自定义JSON序列化，使entries数组中的每个对象都在单独的一行
        let jsonString = '{\n';
        jsonString += `  "target_language": "${vocabulary.target_language}",\n`;
        jsonString += `  "meta": ${JSON.stringify(vocabulary.meta)},
`; // meta对象保持标准JSON格式
        jsonString += '  "entries": [\n';
        
        if (vocabulary.entries && vocabulary.entries.length > 0) {
            jsonString += vocabulary.entries.map(entry => `    ${JSON.stringify(entry)}`).join(',\n');
            jsonString += '\n';
        }
        
        jsonString += '  ]\n';
        jsonString += '}';
            
        await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonString, 'utf8'));
        console.log(`[CodeLocalizer] 成功保存词汇表到: ${uri.fsPath}`);
        return true;
    } catch (error) {
        console.error(`[CodeLocalizer] 保存词汇表失败: ${uri.fsPath}`, error);
        return false;
    }
}

/**
 * 获取词汇表路径
 * @param context VS Code扩展上下文
 * @param location 词汇表存储位置
 * @param language 目标语言
 */
export async function getVocabularyPath(
    context: vscode.ExtensionContext, 
    location: VocabularyStorageLocation,
    language: string = 'zh-CN'
): Promise<vscode.Uri | null> {
    switch (location) {
        case VocabularyStorageLocation.EXTENSION:
            // 尝试获取扩展安装目录中的词汇表路径
            let extensionPath = vscode.Uri.joinPath(context.extensionUri, getVocabularyFilename(language));
            let exists = await fileExists(extensionPath);
            
            // 如果指定语言的词汇表不存在，尝试回退到中文
            if (!exists && language !== 'zh-CN') {
                console.log(`[CodeLocalizer] ${language}语言词汇表不存在，尝试使用zh-CN`);
                extensionPath = vscode.Uri.joinPath(context.extensionUri, getVocabularyFilename('zh-CN'));
                exists = await fileExists(extensionPath);
            }
            
            // 如果在扩展目录不存在，尝试当前工作目录（在开发环境中更常见）
            if (!exists) {
                try {
                    // 获取当前工作目录 (process.cwd())
                    const cwdPath = process.cwd();
                    console.log(`[CodeLocalizer] 在当前工作目录查找词汇表: ${cwdPath}`);
                    
                    // 检查当前工作目录中的词汇表文件
                    const cwdUri = vscode.Uri.file(cwdPath);
                    extensionPath = vscode.Uri.joinPath(cwdUri, getVocabularyFilename(language));
                    exists = await fileExists(extensionPath);
                    
                    if (exists) {
                        console.log(`[CodeLocalizer] 在当前工作目录中找到词汇表: ${extensionPath.fsPath}`);
                        return extensionPath;
                    } else {
                        console.log(`[CodeLocalizer] 在当前工作目录中未找到词汇表: ${extensionPath.fsPath}`);
                    }
                } catch (cwdError) {
                    console.error(`[CodeLocalizer] 访问当前工作目录失败:`, cwdError);
                }
            }
            
            // 如果不存在，尝试父目录（开发环境下可能的情况）
            if (!exists) {
                const parentPath = vscode.Uri.joinPath(context.extensionUri, '..');
                extensionPath = vscode.Uri.joinPath(parentPath, getVocabularyFilename(language));
                
                // 再次尝试回退到中文
                exists = await fileExists(extensionPath);
                if (!exists && language !== 'zh-CN') {
                    extensionPath = vscode.Uri.joinPath(parentPath, getVocabularyFilename('zh-CN'));
                }
            }
            
            return extensionPath;
            
        case VocabularyStorageLocation.GLOBAL:
            // 确保全局存储目录存在
            if (!context.globalStorageUri) {
                console.error('[CodeLocalizer] 全局存储URI不可用');
                return null;
            }
            
            await ensureDirectory(context.globalStorageUri);
            return vscode.Uri.joinPath(context.globalStorageUri, getUserVocabularyFilename(language));
            
        case VocabularyStorageLocation.PROJECT:
            return getProjectVocabularyPath(language);
            
        default:
            console.error(`[CodeLocalizer] 未知的词汇表存储位置: ${location}`);
            return null;
    }
} 