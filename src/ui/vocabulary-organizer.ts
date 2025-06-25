import * as vscode from 'vscode';
import * as path from 'path';
import { Vocabulary, VocabularyEntry } from '../types';
import { saveVocabularyToFile } from '../vocabulary/vocabulary-storage';
import { clearGlobalVocabularyCache } from '../extension';

/**
 * 词汇表整理工具管理器
 */
export class VocabularyOrganizerManager {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private vocabulary: Vocabulary | null = null;
    private vocabularyPath: vscode.Uri;

    constructor(context: vscode.ExtensionContext, vocabularyPath: vscode.Uri) {
        this.context = context;
        this.vocabularyPath = vocabularyPath;
    }

    /**
     * 打开词汇表整理工具
     * @param vocabulary 要整理的词汇表
     */
    public async openVocabularyOrganizer(vocabulary: Vocabulary): Promise<void> {
        this.vocabulary = vocabulary;

        // 创建webview面板
        this.panel = vscode.window.createWebviewPanel(
            'vocabularyOrganizer',
            '词汇表整理',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'ui'))
                ]
            }
        );

        // 设置HTML内容
        this.panel.webview.html = this.getWebviewContent();

        // 设置消息处理器
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleWebviewMessage(message);
            }
        );

        // 面板关闭时的处理
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        // 发送词汇表数据到webview
        this.panel.webview.postMessage({
            command: 'setVocabularyEntries',
            entries: vocabulary.entries || []
        });
    }

    /**
     * 获取webview的HTML内容
     */
    private getWebviewContent(): string {
        const htmlPath = path.join(this.context.extensionPath, 'src', 'ui', 'vocabulary-organizer.html');
        const fs = require('fs');
        
        console.log(`[CodeLocalizer] getWebviewContent: 尝试加载HTML文件，路径: ${htmlPath}`);

        if (fs.existsSync(htmlPath)) {
            console.log(`[CodeLocalizer] getWebviewContent: HTML文件存在: ${htmlPath}`);
            try {
                const content = fs.readFileSync(htmlPath, 'utf8');
                console.log(`[CodeLocalizer] getWebviewContent: 成功读取HTML文件内容，长度: ${content.length}`);
                return content;
            } catch (readError: unknown) {
                console.error(`[CodeLocalizer] getWebviewContent: 读取HTML文件失败: ${htmlPath}`, readError);
                const errorMessage = readError instanceof Error ? readError.message : String(readError);
                return `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>错误</title>
                    </head>
                    <body>
                        <h1>错误</h1>
                        <p>无法读取词汇表整理页面文件: ${errorMessage}</p>
                    </body>
                    </html>
                `;
            }
        } else {
            console.error(`[CodeLocalizer] getWebviewContent: HTML文件不存在: ${htmlPath}`);
            // 如果文件不存在，返回一个简单的错误页面
            return `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>词汇表整理</title>
                </head>
                <body>
                    <h1>错误</h1>
                    <p>词汇表整理页面文件未找到</p>
                </body>
                </html>
            `;
        }
    }

    /**
     * 处理来自webview的消息
     */
    private async handleWebviewMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'saveVocabulary':
                await this.saveVocabulary(message.entries, message.deletedItems);
                break;
            case 'exportAll':
                await this.exportVocabulary(message.entries, '全部词汇表');
                break;
            case 'exportSelected':
                await this.exportVocabulary(message.items, '选中词汇表');
                break;
            case 'close':
                if (this.panel) {
                    this.panel.dispose();
                }
                break;
        }
    }

    /**
     * 保存词汇表
     */
    private async saveVocabulary(entries: VocabularyEntry[], deletedItems: string[]): Promise<void> {
        console.log('[CodeLocalizer] saveVocabulary: 保存词汇表请求已接收。');
        
        if (!this.vocabulary) {
            vscode.window.showErrorMessage('词汇表未加载');
            console.error('[CodeLocalizer] saveVocabulary: 词汇表未加载，无法保存。');
            return;
        }

        if (!this.vocabularyPath) {
            vscode.window.showErrorMessage('词汇表文件路径未设置，无法保存。');
            console.error('[CodeLocalizer] saveVocabulary: 词汇表文件路径未设置，无法保存。');
            return;
        }

        try {
            // 更新词汇表条目
            this.vocabulary.entries = entries;
            console.log(`[CodeLocalizer] saveVocabulary: 正在尝试保存词汇表到路径: ${this.vocabularyPath.fsPath}`);

            // 使用正确的路径保存到文件
            const saveSuccess = await saveVocabularyToFile(this.vocabularyPath, this.vocabulary);

            if (saveSuccess) {
                // 显示成功消息
                const message = `词汇表已保存到 ${path.basename(this.vocabularyPath.fsPath)}！\n总条目: ${entries.length}\n删除条目: ${deletedItems.length}`;
                vscode.window.showInformationMessage(message);
                console.log(`[CodeLocalizer] saveVocabulary: 词汇表成功保存到 ${this.vocabularyPath.fsPath}`);
                
                // 清除全局词汇表缓存，以便下次重新加载
                clearGlobalVocabularyCache();

                // 发送成功消息到webview
                if (this.panel) {
                    this.panel.webview.postMessage({
                        command: 'showMessage',
                        message: '词汇表保存成功！',
                        type: 'success'
                    });
                }
            } else {
                // saveVocabularyToFile 返回 false 表示保存失败，但没有抛出异常
                vscode.window.showErrorMessage(`保存词汇表失败: 未知错误或权限问题。`);
                console.error(`[CodeLocalizer] saveVocabulary: 保存词汇表失败，saveVocabularyToFile 返回 false。路径: ${this.vocabularyPath.fsPath}`);
                 if (this.panel) {
                    this.panel.webview.postMessage({
                        command: 'showMessage',
                        message: `保存失败: 未知错误或权限问题。`,
                        type: 'error'
                    });
                }
            }

        } catch (error) {
            console.error(`[CodeLocalizer] saveVocabulary: 保存词汇表失败，捕获到异常:`, error);
            vscode.window.showErrorMessage(`保存词汇表失败: ${error instanceof Error ? error.message : String(error)}`);
            
            // 发送错误消息到webview
            if (this.panel) {
                this.panel.webview.postMessage({
                    command: 'showMessage',
                    message: `保存失败: ${error instanceof Error ? error.message : String(error)}`,
                    type: 'error'
                });
            }
        }
    }

    /**
     * 导出词汇表
     */
    private async exportVocabulary(entries: VocabularyEntry[], title: string): Promise<void> {
        try {
            // 创建导出文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const fileName = `vocabulary_export_${timestamp}.json`;

            // 构造导出数据
            const exportData = {
                target_language: this.vocabulary?.target_language || 'zh-CN',
                meta: {
                    exported_at: new Date().toISOString(),
                    exported_by: 'vocabulary-organizer',
                    title: title,
                    total_entries: entries.length
                },
                entries: entries
            };

            // 选择保存位置
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(fileName),
                filters: {
                    'JSON Files': ['json']
                }
            });

            if (uri) {
                // 写入文件
                const fs = require('fs').promises;
                await fs.writeFile(uri.fsPath, JSON.stringify(exportData, null, 2), 'utf8');
                
                vscode.window.showInformationMessage(`词汇表已导出到: ${uri.fsPath}`);
            }

        } catch (error) {
            console.error('导出词汇表失败:', error);
            vscode.window.showErrorMessage(`导出词汇表失败: ${error}`);
        }
    }
} 